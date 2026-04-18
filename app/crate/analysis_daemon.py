"""Background analysis daemons for audio analysis and bliss vectors.

Two independent loops that run forever inside the worker container,
processing ONE track at a time. They don't use the task system,
don't appear in the UI, and don't block any other operations.

- analysis_daemon: Rust CLI (signal metrics) + Essentia/PANNs (advanced metrics)
- bliss_daemon: Rust CLI bliss vectors (20-float song DNA)

State is tracked per-track via `analysis_state` and `bliss_state` columns
in `library_tracks` with atomic claim queries (FOR UPDATE SKIP LOCKED).
"""

import logging
import time

from crate.db.jobs.analysis import (
    claim_track as _db_claim_track,
    get_analysis_status as _db_get_analysis_status,
    get_pending_count as _db_get_pending_count,
    mark_done as _db_mark_done,
    mark_failed as _db_mark_failed,
    reset_stale_claims as _db_reset_stale_claims,
    store_bliss_vector as _db_store_bliss_vector,
)

log = logging.getLogger(__name__)

# How long to sleep when no pending tracks are found
IDLE_SLEEP = 30
# How long to sleep between tracks (avoid hammering CPU)
TRACK_SLEEP = 1
# Max consecutive failures before backing off
MAX_CONSECUTIVE_FAILURES = 10
FAILURE_BACKOFF = 60


def _claim_track(state_column: str):
    return _db_claim_track(state_column)


def _mark_done(track_id: int, state_column: str):
    _db_mark_done(track_id, state_column)


def _mark_failed(track_id: int, state_column: str):
    _db_mark_failed(track_id, state_column)


def _reset_stale_claims(state_column: str):
    count = _db_reset_stale_claims(state_column)
    if count:
        log.info("Reset %d stale '%s' claims to pending", count, state_column)


def _get_pending_count(state_column: str) -> int:
    return _db_get_pending_count(state_column)


# ── Audio Analysis Daemon ────────────────────────────────────────

def analysis_daemon(config: dict):
    """Single-threaded daemon that analyzes one track at a time.
    Loads PANNs model once and keeps it in memory."""
    log.info("Audio analysis daemon starting...")

    _reset_stale_claims("analysis_state")
    pending = _get_pending_count("analysis_state")
    log.info("Audio analysis daemon: %d tracks pending", pending)

    # Import analysis functions (loads Essentia/PANNs on first use)
    from crate.audio_analysis import analyze_track
    from crate.db.library import update_track_analysis

    consecutive_failures = 0

    while True:
        try:
            track = _claim_track("analysis_state")
            if not track:
                time.sleep(IDLE_SLEEP)
                continue

            track_id = track["id"]
            path = track["path"]

            try:
                result = analyze_track(path)

                if result and result.get("bpm") is not None:
                    update_track_analysis(
                        path,
                        bpm=result["bpm"],
                        key=result.get("key"),
                        scale=result.get("scale"),
                        energy=result.get("energy"),
                        mood=result.get("mood"),
                        danceability=result.get("danceability"),
                        valence=result.get("valence"),
                        acousticness=result.get("acousticness"),
                        instrumentalness=result.get("instrumentalness"),
                        loudness=result.get("loudness"),
                        dynamic_range=result.get("dynamic_range"),
                        spectral_complexity=result.get("spectral_complexity"),
                    )
                    _mark_done(track_id, "analysis_state")
                    log.debug(
                        "Analyzed: %s — BPM %.1f, key %s",
                        track.get("title", path),
                        result["bpm"],
                        result.get("key", "?"),
                    )
                    consecutive_failures = 0
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

    _reset_stale_claims("bliss_state")
    pending = _get_pending_count("bliss_state")
    log.info("Bliss daemon: %d tracks pending", pending)

    from crate.bliss import analyze_file

    consecutive_failures = 0

    while True:
        try:
            track = _claim_track("bliss_state")
            if not track:
                time.sleep(IDLE_SLEEP)
                continue

            track_id = track["id"]
            path = track["path"]

            try:
                vector = analyze_file(path)

                if vector and len(vector) == 20:
                    _db_store_bliss_vector(track_id, vector)
                    log.debug("Bliss computed: %s", track.get("title", path))
                    consecutive_failures = 0
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

            time.sleep(TRACK_SLEEP)

        except Exception:
            log.exception("Bliss daemon: unexpected error in main loop")
            time.sleep(FAILURE_BACKOFF)


# ── Status ───────────────────────────────────────────────────────

def get_analysis_status() -> dict:
    """Return current analysis progress for both daemons."""
    return _db_get_analysis_status()
