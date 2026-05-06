"""Background analysis daemons for audio analysis and bliss vectors.

Two independent loops run inside the worker container and progressively
move pipeline state into dedicated shadow tables while we keep the
legacy `library_tracks` columns compatible during the cutover.

- analysis_daemon: Rust CLI (signal metrics) + Essentia/PANNs (advanced metrics)
- bliss_daemon: Rust CLI bliss vectors (20-float song DNA)
"""

import logging
import time
from pathlib import Path

from crate.db.jobs.analysis import (
    claim_tracks as _db_claim_tracks,
    get_analysis_status as _db_get_analysis_status,
    get_pending_count as _db_get_pending_count,
    mark_failed as _db_mark_failed,
    release_claims as _db_release_claims,
    reset_stale_claims as _db_reset_stale_claims,
    store_analysis_results as _db_store_analysis_results,
    store_bliss_vectors as _db_store_bliss_vectors,
)

log = logging.getLogger(__name__)

# How long to sleep when no pending tracks are found
IDLE_SLEEP = 30
# How long to sleep between tracks (avoid hammering CPU)
TRACK_SLEEP = 1
# Max consecutive failures before backing off
MAX_CONSECUTIVE_FAILURES = 10
FAILURE_BACKOFF = 60
# How long to pause when server is under load
LOAD_PAUSE = 60
ANALYSIS_BATCH_SIZE = 8
BLISS_BATCH_SIZE = 32


def _should_pause_for_load() -> bool:
    """Check if daemons should pause to let active users have resources.

    Pauses when users are actively streaming. Uses recent
    ``user_play_events`` (actual playback), not session heartbeats
    (idle tabs don't count).
    Also pauses when system load is high relative to CPU count.
    """
    try:
        from crate.resource_governor import evaluate_resources, record_decision

        decision = evaluate_resources(label="analysis daemon", listener_sensitive=True)
        record_decision(decision, task_type="analysis_daemon", source="daemon")
        return not decision.allowed
    except Exception:
        return False


def _claim_tracks(state_column: str, *, limit: int):
    return _db_claim_tracks(state_column, limit=limit)

def _mark_failed(track_id: int, state_column: str):
    _db_mark_failed(track_id, state_column)


def _release_claims(track_ids: list[int], state_column: str):
    return _db_release_claims(track_ids, state_column)


def _reset_stale_claims(state_column: str):
    count = _db_reset_stale_claims(state_column)
    if count:
        log.info("Reset %d stale '%s' claims to pending", count, state_column)


def _get_pending_count(state_column: str) -> int:
    return _db_get_pending_count(state_column)

def _store_analysis_results(results: list[tuple[int, str, dict]]):
    _db_store_analysis_results(results)


def _store_bliss_vectors(vectors_by_track_id: dict[int, list[float]]):
    _db_store_bliss_vectors(vectors_by_track_id)


# ── Audio Analysis Daemon ────────────────────────────────────────

def analysis_daemon(config: dict):
    """Single-threaded daemon that analyzes one track at a time.
    Loads PANNs model once and keeps it in memory."""
    log.info("Audio analysis daemon starting...")

    try:
        _reset_stale_claims("analysis_state")
        pending = _get_pending_count("analysis_state")
        log.info("Audio analysis daemon: %d tracks pending", pending)
    except Exception:
        log.warning("Audio analysis daemon: startup state check failed; continuing", exc_info=True)

    # Import analysis functions (loads Essentia/PANNs on first use)
    from crate.audio_analysis import analyze_batch, analyze_track

    consecutive_failures = 0

    while True:
        try:
            # Pause when users are actively streaming or system is under load
            if _should_pause_for_load():
                log.debug("Analysis daemon: pausing for active users/load")
                time.sleep(LOAD_PAUSE)
                continue

            batch = _claim_tracks("analysis_state", limit=ANALYSIS_BATCH_SIZE)
            if not batch:
                time.sleep(IDLE_SLEEP)
                continue

            if _should_pause_for_load():
                _release_claims([int(item["id"]) for item in batch], "analysis_state")
                time.sleep(LOAD_PAUSE)
                continue

            successful_results: list[tuple[int, str, dict]] = []
            batch_failed = False

            try:
                batch_results = analyze_batch([track["path"] for track in batch])
                if not isinstance(batch_results, list) or len(batch_results) != len(batch):
                    raise ValueError("Batch analysis returned mismatched result count")

                for track, result in zip(batch, batch_results):
                    track_id = track["id"]
                    path = track["path"]
                    if result and result.get("bpm") is not None:
                        successful_results.append((track_id, path, result))
                    else:
                        _mark_failed(track_id, "analysis_state")
                        log.warning("Analysis returned no BPM for: %s", path)
            except Exception:
                batch_failed = True
                log.warning("Batch analysis failed, falling back to per-track analysis", exc_info=True)

            if batch_failed:
                successful_results = []
                for track in batch:
                    track_id = track["id"]
                    path = track["path"]
                    try:
                        result = analyze_track(path)
                        if result and result.get("bpm") is not None:
                            successful_results.append((track_id, path, result))
                        else:
                            _mark_failed(track_id, "analysis_state")
                            log.warning("Analysis returned no BPM for: %s", path)
                    except Exception:
                        _mark_failed(track_id, "analysis_state")
                        consecutive_failures += 1
                        log.warning("Analysis failed for: %s", path, exc_info=True)

                        if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                            log.warning(
                                "Analysis daemon: %d consecutive failures, backing off %ds",
                                consecutive_failures, FAILURE_BACKOFF,
                            )
                            time.sleep(FAILURE_BACKOFF)
                            consecutive_failures = 0

            if successful_results:
                _store_analysis_results(successful_results)
                for track_id, path, result in successful_results:
                    log.debug(
                        "Analyzed: %s — BPM %.1f, key %s",
                        path,
                        result["bpm"],
                        result.get("key", "?"),
                    )
                consecutive_failures = 0

            time.sleep(TRACK_SLEEP)

        except Exception:
            log.exception("Analysis daemon: unexpected error in main loop")
            time.sleep(FAILURE_BACKOFF)


# ── Bliss Daemon ─────────────────────────────────────────────────

def bliss_daemon(config: dict):
    """Single-threaded daemon that computes bliss vectors one track at a time."""
    from crate.bliss import is_available

    if not is_available():
        log.warning("Bliss daemon: bliss binary not available, exiting")
        return

    log.info("Bliss daemon starting...")

    try:
        _reset_stale_claims("bliss_state")
        pending = _get_pending_count("bliss_state")
        log.info("Bliss daemon: %d tracks pending", pending)
    except Exception:
        log.warning("Bliss daemon: startup state check failed; continuing", exc_info=True)

    from crate.bliss import analyze_directory, analyze_file

    consecutive_failures = 0

    while True:
        try:
            if _should_pause_for_load():
                log.debug("Bliss daemon: pausing for active users/load")
                time.sleep(LOAD_PAUSE)
                continue

            batch = _claim_tracks("bliss_state", limit=BLISS_BATCH_SIZE)
            if not batch:
                time.sleep(IDLE_SLEEP)
                continue

            if _should_pause_for_load():
                _release_claims([int(item["id"]) for item in batch], "bliss_state")
                time.sleep(LOAD_PAUSE)
                continue

            successful_vectors: dict[int, list[float]] = {}

            tracks_by_directory: dict[str, list[dict]] = {}
            for track in batch:
                directory = str(Path(track["path"]).parent)
                tracks_by_directory.setdefault(directory, []).append(track)

            for directory, directory_tracks in tracks_by_directory.items():
                batch_vectors: dict[str, list[float]] = {}
                try:
                    batch_vectors = analyze_directory(directory)
                except Exception:
                    log.warning("Bliss batch analysis failed for directory: %s", directory, exc_info=True)

                for track in directory_tracks:
                    track_id = track["id"]
                    path = track["path"]

                    try:
                        vector = batch_vectors.get(path)
                        if not vector:
                            vector = analyze_file(path)

                        if vector and len(vector) == 20:
                            successful_vectors[int(track_id)] = vector
                        else:
                            _mark_failed(track_id, "bliss_state")
                            log.warning("Bliss returned invalid vector for: %s", path)

                    except Exception:
                        _mark_failed(track_id, "bliss_state")
                        consecutive_failures += 1
                        log.warning("Bliss failed for: %s", path, exc_info=True)

                        if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                            log.warning(
                                "Bliss daemon: %d consecutive failures, backing off %ds",
                                consecutive_failures, FAILURE_BACKOFF,
                            )
                            time.sleep(FAILURE_BACKOFF)
                            consecutive_failures = 0

            if successful_vectors:
                _store_bliss_vectors(successful_vectors)
                for track in batch:
                    if int(track["id"]) in successful_vectors:
                        log.debug("Bliss computed: %s", track.get("title", track["path"]))
                consecutive_failures = 0

            time.sleep(TRACK_SLEEP)

        except Exception:
            log.exception("Bliss daemon: unexpected error in main loop")
            time.sleep(FAILURE_BACKOFF)


# ── Status ───────────────────────────────────────────────────────

def get_analysis_status() -> dict:
    """Return current analysis progress for both daemons."""
    return _db_get_analysis_status()
