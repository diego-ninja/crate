"""Background analysis daemons for audio analysis and bliss vectors.

Two independent loops that run forever inside the worker container,
processing ONE track at a time. They don't use the task system,
don't appear in the UI, and don't block any other operations.

- analysis_daemon: Rust CLI (signal metrics) + Essentia/PANNs (advanced metrics)
- bliss_daemon: Rust CLI bliss vectors (20-float song DNA)

State is tracked per-track via `analysis_state` and `bliss_state` columns
in `library_tracks` with atomic claim queries (FOR UPDATE SKIP LOCKED).
"""

import json
import logging
import time

from crate.db import get_db_ctx

log = logging.getLogger(__name__)

# How long to sleep when no pending tracks are found
IDLE_SLEEP = 30
# How long to sleep between tracks (avoid hammering CPU)
TRACK_SLEEP = 1
# Max consecutive failures before backing off
MAX_CONSECUTIVE_FAILURES = 10
FAILURE_BACKOFF = 60


def _claim_track(state_column: str):
    """Atomically claim the next pending track for processing.
    Uses FOR UPDATE SKIP LOCKED to avoid race conditions."""
    with get_db_ctx() as cur:
        cur.execute(f"""
            UPDATE library_tracks
            SET {state_column} = 'analyzing'
            WHERE id = (
                SELECT id FROM library_tracks
                WHERE {state_column} = 'pending' AND path IS NOT NULL
                ORDER BY updated_at DESC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, path, title, artist, album
        """)
        row = cur.fetchone()
        return dict(row) if row else None


def _mark_done(track_id: int, state_column: str):
    with get_db_ctx() as cur:
        cur.execute(
            f"UPDATE library_tracks SET {state_column} = 'done' WHERE id = %s",
            (track_id,),
        )


def _mark_failed(track_id: int, state_column: str):
    with get_db_ctx() as cur:
        cur.execute(
            f"UPDATE library_tracks SET {state_column} = 'failed' WHERE id = %s",
            (track_id,),
        )


def _reset_stale_claims(state_column: str):
    """On startup, reset any tracks stuck in 'analyzing' state from a previous crash."""
    with get_db_ctx() as cur:
        cur.execute(
            f"UPDATE library_tracks SET {state_column} = 'pending' WHERE {state_column} = 'analyzing'"
        )
        count = cur.rowcount
        if count:
            log.info("Reset %d stale '%s' claims to pending", count, state_column)


def _get_pending_count(state_column: str) -> int:
    with get_db_ctx() as cur:
        cur.execute(
            f"SELECT COUNT(*) as cnt FROM library_tracks WHERE {state_column} = 'pending'"
        )
        return cur.fetchone()["cnt"]


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
    from crate.db.library import update_track_audiomuse

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
                    update_track_audiomuse(
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
                    with get_db_ctx() as cur:
                        cur.execute(
                            "UPDATE library_tracks SET bliss_vector = %s, bliss_state = 'done' "
                            "WHERE id = %s",
                            (vector, track_id),
                        )
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
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE analysis_state = 'done') as analysis_done,
                COUNT(*) FILTER (WHERE analysis_state = 'pending') as analysis_pending,
                COUNT(*) FILTER (WHERE analysis_state = 'analyzing') as analysis_active,
                COUNT(*) FILTER (WHERE analysis_state = 'failed') as analysis_failed,
                COUNT(*) FILTER (WHERE bliss_state = 'done') as bliss_done,
                COUNT(*) FILTER (WHERE bliss_state = 'pending') as bliss_pending,
                COUNT(*) FILTER (WHERE bliss_state = 'analyzing') as bliss_active,
                COUNT(*) FILTER (WHERE bliss_state = 'failed') as bliss_failed
            FROM library_tracks
        """)
        row = cur.fetchone()
        return dict(row) if row else {}
