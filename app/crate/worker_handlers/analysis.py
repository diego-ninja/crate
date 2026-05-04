import logging
import time
from pathlib import Path
from typing import Callable

from crate.audio_fingerprint import compute_audio_fingerprint_with_source
from crate.db.cache_store import set_cache
from crate.db.genres import cleanup_invalid_genre_taxonomy_nodes
from crate.db.jobs.analysis import (
    get_albums_needing_popularity,
    get_artists_needing_analysis,
    get_artists_needing_bliss,
    list_tracks_missing_audio_fingerprints,
    requeue_tracks,
    store_track_audio_fingerprint,
    update_album_popularity as _db_update_album_popularity,
)
from crate.db.events import emit_task_event
from crate.db.repositories.library import (
    get_library_album,
    get_library_albums,
    get_library_artist,
    get_library_artists,
    get_library_tracks,
    update_track_analysis,
)
from crate.db.queries.tasks import get_task
from crate.db.repositories.tasks import create_task
from crate.task_progress import TaskProgress, emit_item_event, emit_progress, entity_label
from crate.worker_handlers import TaskHandler, is_cancelled

log = logging.getLogger(__name__)

CHUNK_SIZE = 10

# Registry of post-processing functions for fan-out coordinators.
# Keyed by the child task_type. Called once by the last chunk to complete.
# Lazy-populated after handler functions are defined (see bottom of module).
_PARENT_FINALIZERS: dict[str, Callable[[], dict | None]] = {}


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

    emit_task_event(task_id, "info", {"message": f"Analytics complete: {artists} artists, {albums} albums, {tracks} tracks"})
    return {"artists": artists, "albums": albums, "tracks": tracks}


def _handle_refresh_user_listening_stats(task_id: str, params: dict, config: dict) -> dict:
    from crate.db.domain_events import append_domain_event
    from crate.db.repositories.user_library import recompute_user_listening_aggregates

    user_id = int(params.get("user_id") or 0)
    if user_id <= 0:
        return {"ok": False, "error": "Missing user_id"}

    p = TaskProgress(phase="stats", phase_count=1, total=1, item=f"user:{user_id}")
    emit_progress(task_id, p, force=True)
    recompute_user_listening_aggregates(user_id)
    append_domain_event(
        "user.listening_aggregates.updated",
        {"user_id": user_id},
        scope="user",
        subject_key=str(user_id),
    )
    emit_task_event(task_id, "info", {"message": f"Listening stats refreshed for user {user_id}"})
    return {"ok": True, "user_id": user_id}


def _handle_analyze_album_full(task_id: str, params: dict, config: dict) -> dict:
    """Analyze audio + compute bliss vectors for a single album."""
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

        artist_data = get_library_artist(artist)
        folder = (artist_data.get("folder_name") if artist_data else None) or artist
        artist_dir = lib / folder
        if artist_dir.is_dir():
            vectors = analyze_directory(str(artist_dir)) if is_available() else []
            if vectors:
                store_vectors(vectors)
                bliss_count = len(vectors)

    emit_task_event(task_id, "info", {
        "message": f"Album analysis complete: {artist} — {album_name} ({analysis_result.get('analyzed', 0)} analyzed, {bliss_count} bliss vectors)",
    })
    return {
        "analyzed": analysis_result.get("analyzed", 0),
        "failed": analysis_result.get("failed", 0),
        "bliss": bliss_count,
    }


def _handle_analyze_tracks(task_id: str, params: dict, config: dict) -> dict:
    """Analyze audio tracks for BPM, key, energy, mood with batched inference."""
    from crate.audio_analysis import PANNS_BATCH_SIZE, analyze_batch, analyze_track

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
            return _chunk_coordinator(task_id, params, config, "analyze_all", _handle_analyze_tracks)

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
    chunk_handler: Callable[[str, dict, dict], dict],
    filter_fn: Callable[[dict], bool] | None = None,
) -> dict:
    """Fan-out: split artists into chunks, dispatch as parallel sub-tasks, return immediately.

    The coordinator does NOT block waiting for chunks. It dispatches them
    and returns `_delegated=True` so the actor wrapper keeps the parent task
    alive without occupying a worker slot.

    Each chunk, on completion, calls `_try_complete_parent()` to check if
    all siblings are done. The last one to finish runs the post-processing
    callback and marks the parent task as completed.

    This avoids deadlocks regardless of how many Dramatiq workers are available.
    """
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

    emit_task_event(task_id, "info", {"message": f"Dispatching {total} artists in {len(chunks)} parallel chunks"})

    for index, chunk in enumerate(chunks):
        create_task(
            chunk_task_type,
            {"artists": chunk, "chunk_index": index, "total_chunks": len(chunks)},
            parent_task_id=task_id,
        )

    p = TaskProgress(phase="dispatched", phase_count=1, total=len(chunks), done=0)
    p.item = f"0/{len(chunks)} chunks"
    emit_progress(task_id, p)

    return {"_delegated": True, "chunks": len(chunks), "artists": total}


def _try_complete_parent(parent_task_id: str, child_task_type: str = "") -> None:
    """Called by the actor wrapper after a chunk is marked completed.

    Atomically checks if all siblings are done. The last one wins the
    race (via DB-level claim) and runs any post-processing finalization.
    """
    from crate.db.repositories.tasks import check_siblings_complete, update_task

    status = check_siblings_complete(parent_task_id)
    if not status["all_done"]:
        p = TaskProgress(
            phase="processing", phase_count=1,
            total=status["total"],
            done=status["completed"] + status["failed"],
            errors=status["failed"],
        )
        p.item = f"{p.done}/{status['total']} chunks"
        emit_progress(parent_task_id, p)
        return

    # All chunks done — run type-specific finalization
    result: dict = {
        "chunks": status["total"],
        "completed": status["completed"],
        "failed": status["failed"],
    }

    finalize_fn = _PARENT_FINALIZERS.get(child_task_type)
    if finalize_fn:
        try:
            extra = finalize_fn()
            if extra:
                result.update(extra)
        except Exception:
            log.warning("Finalization failed for parent %s", parent_task_id, exc_info=True)
            result["finalization_error"] = True

    update_task(parent_task_id, status="completed", result=result)
    emit_task_event(parent_task_id, "info", {"message": f"All {status['total']} chunks complete ({status['failed']} failed)"})


def _handle_compute_bliss(task_id: str, params: dict, config: dict) -> dict:
    """Fan-out coordinator for bliss computation."""
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
        _handle_bliss_chunk,
        filter_fn=lambda artist: artist["name"] in need_bliss_names,
    )


def _handle_bliss_chunk(task_id: str, params: dict, config: dict) -> dict:
    """Process a chunk of artists for bliss vectors."""
    from crate.bliss import analyze_directory, store_vectors

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

    emit_task_event(task_id, "info", {"message": f"Bliss chunk complete: {analyzed} vectors from {len(artists)} artists"})
    return {"analyzed": analyzed, "artists": len(artists)}


def _popularity_finalize() -> dict | None:
    """Post-processing after all popularity chunks complete."""
    from crate.popularity import recompute_track_popularity_scores
    scored = recompute_track_popularity_scores()
    return {"tracks_scored": scored.get("tracks_scored", 0)}


def _handle_compute_popularity(task_id: str, params: dict, config: dict) -> dict:
    """Fan-out coordinator for popularity fetching.

    Without artists param: dispatches chunks and returns immediately.
    With artists param: processes a single chunk (fan-in handled by actor wrapper).
    """
    if params.get("artists"):
        return _handle_popularity_chunk(task_id, params, config)

    return _chunk_coordinator(task_id, params, config, "compute_popularity", _handle_popularity_chunk)


def _handle_popularity_chunk(task_id: str, params: dict, config: dict) -> dict:
    """Process a chunk of artists for popularity data using threads."""
    import re

    from crate.popularity import (
        _lastfm_get,
        _normalize_popularity,
        _parse_int,
        refresh_artist_track_popularity_signals,
    )

    artists = params.get("artists", [])
    albums_fetched = 0
    lastfm_track_matches = 0
    spotify_track_matches = 0

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

        refresh_result = refresh_artist_track_popularity_signals(artist_name)
        lastfm_track_matches += int(refresh_result.get("lastfm_matches", 0))
        spotify_track_matches += int(refresh_result.get("spotify_matches", 0))

    try:
        _normalize_popularity(artists)
    except Exception:
        log.debug("Failed to normalize popularity scores", exc_info=True)

    emit_task_event(task_id, "info", {
        "message": (
            f"Popularity chunk complete: {albums_fetched} albums, "
            f"{lastfm_track_matches} Last.fm track matches, "
            f"{spotify_track_matches} Spotify matches from {len(artists)} artists"
        ),
    })
    return {
        "albums_fetched": albums_fetched,
        "lastfm_track_matches": lastfm_track_matches,
        "spotify_track_matches": spotify_track_matches,
        "artists": len(artists),
    }


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
    emit_task_event(task_id, "info", {"message": "Requeuing tracks for re-analysis..."})
    scope = params.get("scope")
    artist = params.get("artist")
    album_name = params.get("album") or params.get("album_folder")
    album_id = params.get("album_id")
    track_id = params.get("track_id")
    what = params.get("what", "both")  # 'analysis', 'bliss', or 'both'

    cols = []
    pipelines = []
    if what in ("analysis", "both"):
        cols.append("analysis_state = 'pending'")
        pipelines.append("analysis")
    if what in ("bliss", "both"):
        cols.append("bliss_state = 'pending'")
        pipelines.append("bliss")
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
        pipelines=pipelines,
    )

    if count == 0 and not track_id and not album_id and not artist and scope != "all":
        return {"requeued": 0, "error": "No scope specified"}

    log.info("Requeued %d tracks for %s (scope: %s)", count, what,
             track_id or album_id or artist or scope)
    emit_task_event(task_id, "info", {"message": f"Requeued {count} tracks for {what}"})
    return {"requeued": count, "what": what}


def _handle_backfill_track_audio_fingerprints(task_id: str, params: dict, config: dict) -> dict:
    limit = max(1, min(int(params.get("limit") or 5000), 50_000))
    tracks = list_tracks_missing_audio_fingerprints(
        limit=limit,
        track_id=int(params["track_id"]) if params.get("track_id") else None,
        album_id=int(params["album_id"]) if params.get("album_id") else None,
        artist=params.get("artist"),
        album=params.get("album"),
    )
    total = len(tracks)
    processed = 0
    fingerprinted = 0
    failed = 0

    emit_task_event(
        task_id,
        "info",
        {
            "message": "Backfilling track audio fingerprints...",
            "limit": limit,
            "selected": total,
        },
    )
    progress = TaskProgress(phase="fingerprints", phase_count=1, total=total)
    emit_progress(task_id, progress, force=True)

    from crate.resource_governor import wait_while_pressured

    for index, track in enumerate(tracks, start=1):
        if is_cancelled(task_id):
            emit_task_event(task_id, "warning", {"message": "Fingerprint backfill cancelled"})
            break

        progress.done = index - 1
        progress.item = entity_label(
            artist=track.get("artist", ""),
            album=track.get("album", ""),
            title=track.get("title", ""),
            path=track.get("path", ""),
        )
        emit_progress(task_id, progress)

        if not wait_while_pressured(
            label="track audio fingerprint",
            task_type="backfill_track_audio_fingerprints",
            is_cancelled_fn=is_cancelled,
            task_id=task_id,
            emit_event_fn=emit_task_event,
            max_sleep_seconds=300,
        ):
            break

        fingerprint_payload = compute_audio_fingerprint_with_source(track["path"])
        processed += 1
        if fingerprint_payload is None:
            failed += 1
            continue

        fingerprint, fingerprint_source = fingerprint_payload
        store_track_audio_fingerprint(
            int(track["id"]),
            fingerprint=fingerprint,
            fingerprint_source=fingerprint_source,
        )
        fingerprinted += 1

    progress.done = processed
    emit_progress(task_id, progress, force=True)
    emit_task_event(
        task_id,
        "info",
        {
            "message": (
                f"Track fingerprint backfill complete: {fingerprinted} stored, "
                f"{failed} failed, {processed} processed"
            )
        },
    )
    return {
        "processed": processed,
        "fingerprinted": fingerprinted,
        "failed": failed,
        "remaining": max(total - processed, 0),
    }


# Populate finalizers now that handler functions are defined
_PARENT_FINALIZERS["compute_popularity"] = _popularity_finalize

ANALYSIS_TASK_HANDLERS: dict[str, TaskHandler] = {
    "compute_analytics": _handle_compute_analytics,
    "refresh_user_listening_stats": _handle_refresh_user_listening_stats,
    "index_genres": _handle_index_genres,
    "infer_genre_taxonomy": _handle_infer_genre_taxonomy,
    "enrich_genre_descriptions": _handle_enrich_genre_descriptions,
    "sync_musicbrainz_genre_graph": _handle_sync_musicbrainz_genre_graph,
    "cleanup_invalid_genre_taxonomy": _handle_cleanup_invalid_genre_taxonomy,
    "compute_popularity": _handle_compute_popularity,
    "backfill_track_audio_fingerprints": _handle_backfill_track_audio_fingerprints,
    # Re-analysis: just resets state, background daemons pick up the work
    "analyze_tracks": _handle_requeue_analysis,
    "analyze_all": _handle_requeue_analysis,
    "analyze_album_full": _handle_requeue_analysis,
    "compute_bliss": _handle_requeue_analysis,
}
