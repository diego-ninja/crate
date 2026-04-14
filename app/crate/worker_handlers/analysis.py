import json
import logging
import time
from pathlib import Path
from typing import Callable

from crate.db import create_task, emit_task_event, get_db_ctx, get_task, set_cache, update_task
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)

CHUNK_SIZE = 10


def _handle_compute_analytics(task_id: str, params: dict, config: dict) -> dict:
    from crate.analytics import compute_analytics

    lib = Path(config["library_path"])
    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a"]))

    last_progress_time = [0.0]

    def _progress(data):
        now = time.time()
        if now - last_progress_time[0] < 2:
            return
        last_progress_time[0] = now
        update_task(task_id, progress=json.dumps(data))

    update_task(
        task_id,
        progress=json.dumps(
            {
                "phase": "analytics",
                "artists_done": 0,
                "artists_total": 0,
                "tracks_processed": 0,
                "cached": 0,
                "recomputed": 0,
            }
        ),
    )
    data = compute_analytics(lib, exts, progress_callback=_progress, incremental=True)
    set_cache("analytics", data, ttl=3600)

    update_task(task_id, progress=json.dumps({"phase": "stats", "message": "Computing stats..."}))
    artists = albums = tracks = total_size = 0
    formats: dict[str, int] = {}
    for artist_dir in lib.iterdir():
        if not artist_dir.is_dir() or artist_dir.name.startswith("."):
            continue
        artists += 1
        for album_dir in artist_dir.iterdir():
            if not album_dir.is_dir() or album_dir.name.startswith("."):
                continue
            albums += 1
            for file_path in album_dir.iterdir():
                if file_path.is_file() and file_path.suffix.lower() in exts:
                    tracks += 1
                    ext = file_path.suffix.lower()
                    formats[ext] = formats.get(ext, 0) + 1
                    total_size += file_path.stat().st_size

    stats = {
        "artists": artists,
        "albums": albums,
        "tracks": tracks,
        "formats": formats,
        "total_size_gb": round(total_size / (1024**3), 2),
    }
    set_cache("stats", stats, ttl=3600)

    return {"artists": artists, "albums": albums, "tracks": tracks}


def _handle_refresh_user_listening_stats(task_id: str, params: dict, config: dict) -> dict:
    from crate.db.user_library import recompute_user_listening_aggregates

    user_id = int(params.get("user_id") or 0)
    if user_id <= 0:
        return {"ok": False, "error": "Missing user_id"}

    update_task(task_id, progress=json.dumps({"phase": "stats", "user_id": user_id}))
    recompute_user_listening_aggregates(user_id)
    return {"ok": True, "user_id": user_id}


def _handle_analyze_album_full(task_id: str, params: dict, config: dict) -> dict:
    """Analyze audio + compute bliss vectors for a single album."""
    from crate.db import get_library_album

    artist = params.get("artist", "")
    album_name = params.get("album", "")

    update_task(task_id, progress=json.dumps({"phase": "audio_analysis", "done": 0, "total": 0}))
    analysis_result = _handle_analyze_tracks(task_id, {"artist": artist, "album": album_name}, config)

    update_task(task_id, progress=json.dumps({"phase": "bliss", "done": 0, "total": 0}))
    from crate.bliss import analyze_directory, is_available, store_vectors

    bliss_count = 0
    if is_available():
        album_data = get_library_album(artist, album_name)
        if album_data:
            album_path = album_data.get("path", "")
            if album_path and Path(album_path).is_dir():
                vectors = analyze_directory(str(album_path))
                if vectors:
                    store_vectors(vectors)
                    bliss_count = len(vectors)
    else:
        lib = Path(config["library_path"])
        from crate.db import get_library_artist

        artist_data = get_library_artist(artist)
        folder = (artist_data.get("folder_name") if artist_data else None) or artist
        artist_dir = lib / folder
        if artist_dir.is_dir():
            vectors = analyze_directory(str(artist_dir)) if is_available() else []
            if vectors:
                store_vectors(vectors)
                bliss_count = len(vectors)

    return {
        "analyzed": analysis_result.get("analyzed", 0),
        "failed": analysis_result.get("failed", 0),
        "bliss": bliss_count,
    }


def _handle_analyze_tracks(task_id: str, params: dict, config: dict) -> dict:
    """Analyze audio tracks for BPM, key, energy, mood with batched inference."""
    from crate.audio_analysis import PANNS_BATCH_SIZE, analyze_batch, analyze_track
    from crate.db import get_library_album, get_library_albums, get_library_artists, get_library_tracks, update_track_analysis

    artist = params.get("artist")
    album_name = params.get("album")

    tracks_to_analyze = []
    if artist and album_name:
        album_data = get_library_album(artist, album_name)
        if album_data:
            tracks = get_library_tracks(album_data["id"])
            tracks_to_analyze = [
                (track["path"], track)
                for track in tracks
                if not track.get("bpm") or track.get("energy") is None
            ]
    elif artist:
        albums = get_library_albums(artist)
        for album in albums:
            tracks = get_library_tracks(album["id"])
            tracks_to_analyze.extend(
                (track["path"], track)
                for track in tracks
                if not track.get("bpm") or track.get("energy") is None
            )
    elif params.get("artists"):
        for artist_name in params["artists"]:
            albums = get_library_albums(artist_name)
            for album in albums:
                tracks = get_library_tracks(album["id"])
                tracks_to_analyze.extend(
                    (track["path"], track)
                    for track in tracks
                    if not track.get("bpm") or track.get("energy") is None
                )
    else:
        all_artists, _total = get_library_artists(per_page=10000)
        with get_db_ctx() as cur:
            cur.execute(
                "SELECT al.artist FROM library_tracks t "
                "JOIN library_albums al ON t.album_id = al.id "
                "WHERE t.bpm IS NULL OR t.energy IS NULL "
                "GROUP BY al.artist"
            )
            need_names = {row["artist"] for row in cur.fetchall()}
        need_analysis = [artist_row for artist_row in all_artists if artist_row["name"] in need_names]

        if len(need_analysis) > CHUNK_SIZE:
            emit_task_event(
                task_id,
                "info",
                {"message": f"Splitting {len(need_analysis)} artists into chunks..."},
            )
            return _chunk_coordinator(task_id, params, config, "analyze_all")

        for artist_row in need_analysis:
            albums = get_library_albums(artist_row["name"])
            for album in albums:
                tracks = get_library_tracks(album["id"])
                tracks_to_analyze.extend((track["path"], track) for track in tracks if not track.get("bpm"))

    total = len(tracks_to_analyze)
    analyzed = 0
    failed = 0
    batch_size = PANNS_BATCH_SIZE

    for batch_start in range(0, total, batch_size):
        if is_cancelled(task_id):
            break

        batch = tracks_to_analyze[batch_start : batch_start + batch_size]
        batch_paths = [path for path, _track in batch]

        update_task(
            task_id,
            progress=json.dumps(
                {
                    "track": batch[0][1].get("title", Path(batch[0][0]).stem),
                    "done": batch_start,
                    "total": total,
                    "analyzed": analyzed,
                }
            ),
        )

        try:
            results = analyze_batch(batch_paths)
            for (path, _track), result in zip(batch, results):
                if result.get("bpm") is not None:
                    update_track_analysis(
                        path,
                        bpm=result["bpm"],
                        key=result["key"],
                        scale=result["scale"],
                        energy=result["energy"],
                        mood=result["mood"],
                        danceability=result.get("danceability"),
                        valence=result.get("valence"),
                        acousticness=result.get("acousticness"),
                        instrumentalness=result.get("instrumentalness"),
                        loudness=result.get("loudness"),
                        dynamic_range=result.get("dynamic_range"),
                        spectral_complexity=result.get("spectral_complexity"),
                    )
                    analyzed += 1
                else:
                    failed += 1
        except Exception:
            log.warning("Batch analysis failed for %d tracks", len(batch), exc_info=True)
            for path, _track in batch:
                try:
                    result = analyze_track(path)
                    if result.get("bpm") is not None:
                        update_track_analysis(
                            path,
                            bpm=result["bpm"],
                            key=result["key"],
                            scale=result["scale"],
                            energy=result["energy"],
                            mood=result["mood"],
                            danceability=result.get("danceability"),
                            valence=result.get("valence"),
                            acousticness=result.get("acousticness"),
                            instrumentalness=result.get("instrumentalness"),
                            loudness=result.get("loudness"),
                            dynamic_range=result.get("dynamic_range"),
                            spectral_complexity=result.get("spectral_complexity"),
                        )
                        analyzed += 1
                    else:
                        failed += 1
                except Exception:
                    log.warning("Failed to analyze %s", path, exc_info=True)
                    failed += 1

    return {"analyzed": analyzed, "failed": failed, "total": total}


def _chunk_coordinator(
    task_id: str,
    params: dict,
    config: dict,
    chunk_task_type: str,
    filter_fn: Callable[[dict], bool] | None = None,
) -> dict:
    """Split artists into chunks, create sub-tasks, and monitor progress."""
    from crate.db import get_library_artists

    all_artists, total = get_library_artists(per_page=10000)

    if filter_fn:
        all_artists = [artist for artist in all_artists if filter_fn(artist)]
        total = len(all_artists)

    if total == 0:
        return {"chunks": 0, "artists": 0, "message": "Nothing to process"}

    chunks = []
    for index in range(0, total, CHUNK_SIZE):
        chunk_artists = [artist["name"] for artist in all_artists[index : index + CHUNK_SIZE]]
        chunks.append(chunk_artists)

    emit_task_event(task_id, "info", {"message": f"Split {total} artists into {len(chunks)} chunks"})

    chunk_task_ids = []
    for index, chunk in enumerate(chunks):
        sub_id = create_task(
            chunk_task_type,
            {"artists": chunk, "chunk_index": index, "total_chunks": len(chunks)},
        )
        chunk_task_ids.append(sub_id)

    completed = 0
    coordinator_start = time.time()
    coordinator_timeout = 3600 * 6
    while completed < len(chunk_task_ids):
        if is_cancelled(task_id):
            return {"status": "cancelled", "completed_chunks": completed}
        if time.time() - coordinator_start > coordinator_timeout:
            log.warning("Coordinator %s timed out after %ds", task_id, coordinator_timeout)
            return {
                "status": "timeout",
                "completed_chunks": completed,
                "total_chunks": len(chunks),
            }
        time.sleep(5)
        completed = 0
        failed = 0
        for sub_id in chunk_task_ids:
            task = get_task(sub_id)
            if task and task["status"] == "completed":
                completed += 1
            elif task and task["status"] == "failed":
                failed += 1
                completed += 1
        update_task(
            task_id,
            progress=json.dumps(
                {
                    "chunks_done": completed,
                    "chunks_total": len(chunks),
                    "chunks_failed": failed,
                    "artists_total": total,
                }
            ),
        )

    return {"chunks": len(chunks), "artists": total, "completed": completed}


def _handle_compute_bliss(task_id: str, params: dict, config: dict) -> dict:
    """Coordinator: splits into chunks for parallel bliss computation."""
    from crate.bliss import is_available

    if not is_available():
        return {"error": "grooveyard-bliss binary not found"}

    if params.get("artists"):
        return _handle_bliss_chunk(task_id, params, config)

    with get_db_ctx() as cur:
        cur.execute(
            "SELECT al.artist FROM library_tracks t "
            "JOIN library_albums al ON t.album_id = al.id "
            "WHERE t.bliss_vector IS NULL "
            "GROUP BY al.artist"
        )
        need_bliss_names = {row["artist"] for row in cur.fetchall()}

    return _chunk_coordinator(
        task_id,
        params,
        config,
        "compute_bliss",
        filter_fn=lambda artist: artist["name"] in need_bliss_names,
    )


def _handle_bliss_chunk(task_id: str, params: dict, config: dict) -> dict:
    """Process a chunk of artists for bliss vectors."""
    from crate.bliss import analyze_directory, store_vectors
    from crate.db import get_library_artist

    lib = Path(config["library_path"])
    artists = params.get("artists", [])
    analyzed = 0

    for index, name in enumerate(artists):
        if is_cancelled(task_id):
            break
        artist = get_library_artist(name)
        folder = (artist.get("folder_name") if artist else None) or name
        artist_dir = lib / folder
        if not artist_dir.is_dir():
            continue

        update_task(task_id, progress=json.dumps({"artist": name, "done": index, "total": len(artists)}))
        vectors = analyze_directory(str(artist_dir))
        if vectors:
            store_vectors(vectors)
            analyzed += len(vectors)

    return {"analyzed": analyzed, "artists": len(artists)}


def _handle_compute_popularity(task_id: str, params: dict, config: dict) -> dict:
    """Coordinator: splits into chunks for parallel popularity fetching."""
    if params.get("artists"):
        return _handle_popularity_chunk(task_id, params, config)

    return _chunk_coordinator(task_id, params, config, "compute_popularity")


def _handle_popularity_chunk(task_id: str, params: dict, config: dict) -> dict:
    """Process a chunk of artists for popularity data using threads."""
    import re
    from concurrent.futures import ThreadPoolExecutor

    from crate.popularity import _lastfm_get, _normalize_popularity, _parse_int

    artists = params.get("artists", [])
    albums_fetched = 0
    tracks_fetched = 0

    for index, artist_name in enumerate(artists):
        if is_cancelled(task_id):
            break
        update_task(task_id, progress=json.dumps({"artist": artist_name, "done": index, "total": len(artists)}))

        with get_db_ctx() as cur:
            cur.execute(
                "SELECT id, name, tag_album FROM library_albums "
                "WHERE artist = %s AND lastfm_listeners IS NULL",
                (artist_name,),
            )
            albums = [dict(row) for row in cur.fetchall()]

        for album in albums:
            album_name = album.get("tag_album") or album["name"]
            album_name = re.sub(r"^\d{4}\s*-\s*", "", album_name)
            data = _lastfm_get("album.getinfo", artist=artist_name, album=album_name, autocorrect="1")
            if data and "album" in data:
                info = data["album"]
                listeners = _parse_int(info.get("listeners", 0))
                playcount = _parse_int(info.get("playcount", 0))
                if listeners > 0:
                    with get_db_ctx() as cur:
                        cur.execute(
                            "UPDATE library_albums SET lastfm_listeners = %s, lastfm_playcount = %s "
                            "WHERE id = %s",
                            (listeners, playcount, album["id"]),
                        )
                    albums_fetched += 1
            time.sleep(0.25)

        with get_db_ctx() as cur:
            cur.execute(
                "SELECT t.id, t.title FROM library_tracks t "
                "JOIN library_albums a ON t.album_id = a.id "
                "WHERE a.artist = %s AND t.lastfm_listeners IS NULL "
                "AND t.title IS NOT NULL AND t.title != '' LIMIT 50",
                (artist_name,),
            )
            tracks = [dict(row) for row in cur.fetchall()]

        def fetch_track_pop(track):
            data = _lastfm_get("track.getinfo", artist=artist_name, track=track["title"], autocorrect="1")
            if data and "track" in data:
                info = data["track"]
                listeners = _parse_int(info.get("listeners", 0))
                playcount = _parse_int(info.get("playcount", 0))
                if listeners > 0:
                    with get_db_ctx() as cur:
                        cur.execute(
                            "UPDATE library_tracks SET lastfm_listeners = %s, lastfm_playcount = %s "
                            "WHERE id = %s",
                            (listeners, playcount, track["id"]),
                        )
                    return True
            return False

        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(fetch_track_pop, tracks))
            tracks_fetched += sum(1 for result in results if result)

    try:
        _normalize_popularity()
    except Exception:
        log.debug("Failed to normalize popularity scores", exc_info=True)

    return {"albums_fetched": albums_fetched, "tracks_fetched": tracks_fetched, "artists": len(artists)}


def _handle_index_genres(task_id: str, params: dict, config: dict) -> dict:
    from crate.genre_indexer import index_all_genres

    emit_task_event(task_id, "info", {"message": "Indexing genres..."})
    result = index_all_genres(progress_callback=lambda data: update_task(task_id, progress=json.dumps(data)))
    genre_count = result.get("total_genres", 0)
    emit_task_event(task_id, "info", {"message": f"Genres indexed: {genre_count} genres"})
    return result


def _handle_infer_genre_taxonomy(task_id: str, params: dict, config: dict) -> dict:
    from crate.genre_taxonomy_inference import infer_genre_taxonomy_batch

    limit = max(1, min(int(params.get("limit") or 200), 500))
    focus_slug = (params.get("focus_slug") or "").strip().lower() or None
    aggressive = bool(params.get("aggressive", True))
    include_external = bool(params.get("include_external", True))

    emit_task_event(
        task_id,
        "info",
        {
            "message": "Inferring taxonomy for unmapped genres...",
            "limit": limit,
            "focus_slug": focus_slug,
            "aggressive": aggressive,
            "include_external": include_external,
        },
    )
    result = infer_genre_taxonomy_batch(
        limit=limit,
        focus_slug=focus_slug,
        aggressive=aggressive,
        include_external=include_external,
        progress_callback=lambda data: update_task(task_id, progress=json.dumps(data)),
        event_callback=lambda data: emit_task_event(task_id, "info", data),
    )
    emit_task_event(
        task_id,
        "info",
        {
            "message": (
                f"Genre taxonomy inference complete: {result.get('mapped', 0)} mapped, "
                f"{result.get('remaining_unmapped', 0)} still unmapped"
            )
        },
    )
    return result


def _handle_enrich_genre_descriptions(task_id: str, params: dict, config: dict) -> dict:
    from crate.genre_descriptions import enrich_genre_descriptions_batch

    limit = max(1, min(int(params.get("limit") or 120), 500))
    focus_slug = (params.get("focus_slug") or "").strip().lower() or None
    force = bool(params.get("force", False))

    emit_task_event(
        task_id,
        "info",
        {
            "message": "Enriching genre descriptions from Wikidata...",
            "limit": limit,
            "focus_slug": focus_slug,
            "force": force,
        },
    )
    result = enrich_genre_descriptions_batch(
        limit=limit,
        focus_slug=focus_slug,
        force=force,
        progress_callback=lambda data: update_task(task_id, progress=json.dumps(data)),
        event_callback=lambda data: emit_task_event(task_id, "info", data),
    )
    emit_task_event(
        task_id,
        "info",
        {
            "message": (
                f"Genre description enrichment complete: {result.get('updated', 0)} updated, "
                f"{result.get('remaining_without_external', 0)} still without external description"
            )
        },
    )
    return result


def _handle_sync_musicbrainz_genre_graph(task_id: str, params: dict, config: dict) -> dict:
    from crate.genre_descriptions import sync_musicbrainz_genre_graph_batch

    limit = max(1, min(int(params.get("limit") or 80), 300))
    focus_slug = (params.get("focus_slug") or "").strip().lower() or None
    force = bool(params.get("force", False))

    emit_task_event(
        task_id,
        "info",
        {
            "message": "Syncing MusicBrainz genre relationships...",
            "limit": limit,
            "focus_slug": focus_slug,
            "force": force,
        },
    )
    result = sync_musicbrainz_genre_graph_batch(
        limit=limit,
        focus_slug=focus_slug,
        force=force,
        progress_callback=lambda data: update_task(task_id, progress=json.dumps(data)),
        event_callback=lambda data: emit_task_event(task_id, "info", data),
    )
    emit_task_event(
        task_id,
        "info",
        {
            "message": (
                f"MusicBrainz genre graph sync complete: {result.get('edges_synced', 0)} edges, "
                f"{result.get('matched_musicbrainz', 0)} genres matched"
            )
        },
    )
    return result


def _handle_requeue_analysis(task_id: str, params: dict, config: dict) -> dict:
    """Reset analysis/bliss state to 'pending' so background daemons re-process tracks.
    Accepts: artist, album (name), album_id, track_id, or scope='all'."""
    from crate.db import get_db_ctx

    scope = params.get("scope")
    artist = params.get("artist")
    album_name = params.get("album") or params.get("album_folder")
    album_id = params.get("album_id")
    track_id = params.get("track_id")
    what = params.get("what", "both")  # 'analysis', 'bliss', or 'both'

    cols = []
    if what in ("analysis", "both"):
        cols.append("analysis_state = 'pending'")
    if what in ("bliss", "both"):
        cols.append("bliss_state = 'pending'")
    if not cols:
        return {"requeued": 0}

    set_clause = ", ".join(cols)

    with get_db_ctx() as cur:
        if track_id:
            cur.execute(f"UPDATE library_tracks SET {set_clause} WHERE id = %s", (track_id,))
        elif album_id:
            cur.execute(f"UPDATE library_tracks SET {set_clause} WHERE album_id = %s", (album_id,))
        elif artist and album_name:
            cur.execute(
                f"UPDATE library_tracks SET {set_clause} WHERE album_id IN "
                "(SELECT id FROM library_albums WHERE artist = %s AND name = %s)",
                (artist, album_name),
            )
        elif artist:
            cur.execute(
                f"UPDATE library_tracks SET {set_clause} WHERE album_id IN "
                "(SELECT id FROM library_albums WHERE artist = %s)",
                (artist,),
            )
        elif scope == "all":
            cur.execute(f"UPDATE library_tracks SET {set_clause}")
        else:
            return {"requeued": 0, "error": "No scope specified"}

        count = cur.rowcount

    log.info("Requeued %d tracks for %s (scope: %s)", count, what,
             track_id or album_id or artist or scope)
    return {"requeued": count, "what": what}


ANALYSIS_TASK_HANDLERS: dict[str, TaskHandler] = {
    "compute_analytics": _handle_compute_analytics,
    "refresh_user_listening_stats": _handle_refresh_user_listening_stats,
    "index_genres": _handle_index_genres,
    "infer_genre_taxonomy": _handle_infer_genre_taxonomy,
    "enrich_genre_descriptions": _handle_enrich_genre_descriptions,
    "sync_musicbrainz_genre_graph": _handle_sync_musicbrainz_genre_graph,
    "compute_popularity": _handle_compute_popularity,
    # Re-analysis: just resets state, background daemons pick up the work
    "analyze_tracks": _handle_requeue_analysis,
    "analyze_all": _handle_requeue_analysis,
    "analyze_album_full": _handle_requeue_analysis,
    "compute_bliss": _handle_requeue_analysis,
}
