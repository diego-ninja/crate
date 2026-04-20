import logging
import time
from pathlib import Path
from typing import Callable

from crate.db import create_task, emit_task_event, get_task, set_cache, update_task
from crate.task_progress import TaskProgress, emit_progress, emit_item_event, entity_label
from crate.db.genres import cleanup_invalid_genre_taxonomy_nodes
from crate.db.jobs.analysis import (
    get_albums_needing_popularity,
    get_artists_needing_analysis,
    get_artists_needing_bliss,
    get_tracks_needing_popularity,
    requeue_tracks,
    update_album_popularity as _db_update_album_popularity,
    update_track_popularity as _db_update_track_popularity,
)
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)

CHUNK_SIZE = 10


def _handle_compute_analytics(task_id: str, params: dict, config: dict) -> dict:
    from crate.analytics import compute_analytics

    lib = Path(config["library_path"])
    exts = set(config.get("audio_extensions", [".flac", ".mp3", ".m4a"]))

    p = TaskProgress(phase="analytics", phase_count=2)

    def _progress(data):
        p.done = data.get("artists_done", p.done)
        p.total = data.get("artists_total", p.total)
        p.item = data.get("artist", p.item)
        emit_progress(task_id, p)

    emit_progress(task_id, p, force=True)
    data = compute_analytics(lib, exts, progress_callback=_progress, incremental=True)
    set_cache("analytics", data, ttl=3600)

    p.phase = "stats"
    p.phase_index = 1
    p.done = 0
    p.total = 0
    p.item = "Computing stats..."
    emit_progress(task_id, p, force=True)
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

    p = TaskProgress(phase="stats", phase_count=1, total=1, item=f"user:{user_id}")
    emit_progress(task_id, p, force=True)
    recompute_user_listening_aggregates(user_id)
    return {"ok": True, "user_id": user_id}


def _handle_analyze_album_full(task_id: str, params: dict, config: dict) -> dict:
    """Analyze audio + compute bliss vectors for a single album."""
    from crate.db import get_library_album

    artist = params.get("artist", "")
    album_name = params.get("album", "")

    p = TaskProgress(phase="audio_analysis", phase_count=2, item=entity_label(artist=artist, album=album_name))
    emit_progress(task_id, p, force=True)
    analysis_result = _handle_analyze_tracks(task_id, {"artist": artist, "album": album_name}, config)

    p.phase = "bliss"
    p.phase_index = 1
    p.done = 0
    p.total = 0
    emit_progress(task_id, p, force=True)
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
        need_names = get_artists_needing_analysis()
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
    p = TaskProgress(phase="audio_analysis", phase_count=1, total=total)

    for batch_start in range(0, total, batch_size):
        if is_cancelled(task_id):
            break

        batch = tracks_to_analyze[batch_start : batch_start + batch_size]
        batch_paths = [path for path, _track in batch]

        p.done = batch_start
        p.item = entity_label(title=batch[0][1].get("title", ""), path=batch[0][0])
        emit_progress(task_id, p)

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
    p = TaskProgress(phase="coordinating", phase_count=1, total=len(chunks))
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
        p.done = completed
        p.errors = failed
        p.item = f"{completed}/{len(chunks)} chunks"
        emit_progress(task_id, p)

    return {"chunks": len(chunks), "artists": total, "completed": completed}


def _handle_compute_bliss(task_id: str, params: dict, config: dict) -> dict:
    """Coordinator: splits into chunks for parallel bliss computation."""
    from crate.bliss import is_available

    if not is_available():
        return {"error": "grooveyard-bliss binary not found"}

    if params.get("artists"):
        return _handle_bliss_chunk(task_id, params, config)

    need_bliss_names = get_artists_needing_bliss()

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

    p = TaskProgress(phase="bliss", phase_count=1, total=len(artists))

    for index, name in enumerate(artists):
        if is_cancelled(task_id):
            break
        artist = get_library_artist(name)
        folder = (artist.get("folder_name") if artist else None) or name
        artist_dir = lib / folder
        if not artist_dir.is_dir():
            continue

        p.done = index
        p.item = entity_label(artist=name)
        emit_progress(task_id, p)
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

    p = TaskProgress(phase="popularity", phase_count=1, total=len(artists))

    for index, artist_name in enumerate(artists):
        if is_cancelled(task_id):
            break
        p.done = index
        p.item = entity_label(artist=artist_name)
        emit_progress(task_id, p)

        albums = get_albums_needing_popularity(artist_name)

        for album in albums:
            album_name = album.get("tag_album") or album["name"]
            album_name = re.sub(r"^\d{4}\s*-\s*", "", album_name)
            data = _lastfm_get("album.getinfo", artist=artist_name, album=album_name, autocorrect="1")
            if data and "album" in data:
                info = data["album"]
                listeners = _parse_int(info.get("listeners", 0))
                playcount = _parse_int(info.get("playcount", 0))
                if listeners > 0:
                    _db_update_album_popularity(album["id"], listeners, playcount)
                    albums_fetched += 1
            time.sleep(0.25)

        tracks = get_tracks_needing_popularity(artist_name)

        def fetch_track_pop(track):
            data = _lastfm_get("track.getinfo", artist=artist_name, track=track["title"], autocorrect="1")
            if data and "track" in data:
                info = data["track"]
                listeners = _parse_int(info.get("listeners", 0))
                playcount = _parse_int(info.get("playcount", 0))
                if listeners > 0:
                    _db_update_track_popularity(track["id"], listeners, playcount)
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

    p = TaskProgress(phase="indexing_genres", phase_count=1)

    def _genre_progress(data):
        p.done = data.get("done", p.done)
        p.total = data.get("total", p.total)
        p.item = data.get("artist", p.item)
        emit_progress(task_id, p)

    emit_task_event(task_id, "info", {"message": "Indexing genres..."})
    result = index_all_genres(progress_callback=_genre_progress)
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
    p_tax = TaskProgress(phase="infer_taxonomy", phase_count=1, total=limit)

    def _tax_progress(data):
        p_tax.done = data.get("done", p_tax.done)
        p_tax.total = data.get("total", p_tax.total)
        p_tax.item = data.get("genre", p_tax.item)
        emit_progress(task_id, p_tax)

    result = infer_genre_taxonomy_batch(
        limit=limit,
        focus_slug=focus_slug,
        aggressive=aggressive,
        include_external=include_external,
        progress_callback=_tax_progress,
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
    p_desc = TaskProgress(phase="genre_descriptions", phase_count=1, total=limit)

    def _desc_progress(data):
        p_desc.done = data.get("done", p_desc.done)
        p_desc.total = data.get("total", p_desc.total)
        p_desc.item = data.get("genre", p_desc.item)
        emit_progress(task_id, p_desc)

    result = enrich_genre_descriptions_batch(
        limit=limit,
        focus_slug=focus_slug,
        force=force,
        progress_callback=_desc_progress,
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
    p_mbg = TaskProgress(phase="mb_genre_graph", phase_count=1, total=limit)

    def _mbg_progress(data):
        p_mbg.done = data.get("done", p_mbg.done)
        p_mbg.total = data.get("total", p_mbg.total)
        p_mbg.item = data.get("genre", p_mbg.item)
        emit_progress(task_id, p_mbg)

    result = sync_musicbrainz_genre_graph_batch(
        limit=limit,
        focus_slug=focus_slug,
        force=force,
        progress_callback=_mbg_progress,
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


def _handle_cleanup_invalid_genre_taxonomy(task_id: str, params: dict, config: dict) -> dict:
    emit_task_event(task_id, "info", {"message": "Removing invalid MusicBrainz taxonomy nodes..."})
    result = cleanup_invalid_genre_taxonomy_nodes(dry_run=False)
    p = TaskProgress(
        phase="cleanup",
        phase_count=1,
        done=result.get("deleted_count", 0),
        total=result.get("invalid_count", 0),
    )
    emit_progress(task_id, p, force=True)
    emit_task_event(
        task_id,
        "info",
        {
            "message": (
                f"Genre taxonomy cleanup complete: {result.get('deleted_count', 0)} invalid nodes removed, "
                f"{result.get('edge_count', 0)} dangling edges cleared"
            )
        },
    )
    return result


def _handle_requeue_analysis(task_id: str, params: dict, config: dict) -> dict:
    """Reset analysis/bliss state to 'pending' so background daemons re-process tracks.
    Accepts: artist, album (name), album_id, track_id, or scope='all'."""
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

    count = requeue_tracks(
        set_clause,
        track_id=track_id,
        album_id=album_id,
        artist=artist,
        album_name=album_name,
        scope=scope,
    )

    if count == 0 and not track_id and not album_id and not artist and scope != "all":
        return {"requeued": 0, "error": "No scope specified"}

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
    "cleanup_invalid_genre_taxonomy": _handle_cleanup_invalid_genre_taxonomy,
    "compute_popularity": _handle_compute_popularity,
    # Re-analysis: just resets state, background daemons pick up the work
    "analyze_tracks": _handle_requeue_analysis,
    "analyze_all": _handle_requeue_analysis,
    "analyze_album_full": _handle_requeue_analysis,
    "compute_bliss": _handle_requeue_analysis,
}
