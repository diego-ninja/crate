import sys
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


class _LoopExit(BaseException):
    pass


class TestAnalysisDaemonUnit:
    def test_analysis_daemon_marks_done_for_valid_result(self, monkeypatch):
        import crate.analysis_daemon as analysis_daemon

        calls: dict[str, list] = {"updated": [], "done": [], "failed": []}
        track = {"id": 7, "path": "/music/test.flac", "title": "Test Track"}

        monkeypatch.setattr(analysis_daemon, "_reset_stale_claims", lambda state: None)
        monkeypatch.setattr(analysis_daemon, "_get_pending_count", lambda state: 1)
        monkeypatch.setattr(analysis_daemon, "_claim_track", lambda state: track)
        monkeypatch.setattr(analysis_daemon, "_mark_done", lambda track_id, state: calls["done"].append((track_id, state)))
        monkeypatch.setattr(analysis_daemon, "_mark_failed", lambda track_id, state: calls["failed"].append((track_id, state)))
        monkeypatch.setitem(
            sys.modules,
            "crate.audio_analysis",
            SimpleNamespace(
                analyze_track=lambda path: {
                    "bpm": 128.4,
                    "key": "C",
                    "scale": "major",
                    "energy": 0.91,
                    "mood": {"happy": 0.8},
                }
            ),
        )
        monkeypatch.setitem(
            sys.modules,
            "crate.db.library",
            SimpleNamespace(
                update_track_analysis=lambda path, **kwargs: calls["updated"].append((path, kwargs))
            ),
        )
        monkeypatch.setattr(analysis_daemon.time, "sleep", lambda _seconds: (_ for _ in ()).throw(_LoopExit()))

        with pytest.raises(_LoopExit):
            analysis_daemon.analysis_daemon({})

        assert calls["updated"] == [
            (
                "/music/test.flac",
                {
                    "bpm": 128.4,
                    "key": "C",
                    "scale": "major",
                    "energy": 0.91,
                    "mood": {"happy": 0.8},
                    "danceability": None,
                    "valence": None,
                    "acousticness": None,
                    "instrumentalness": None,
                    "loudness": None,
                    "dynamic_range": None,
                    "spectral_complexity": None,
                },
            )
        ]
        assert calls["done"] == [(7, "analysis_state")]
        assert calls["failed"] == []

    def test_analysis_daemon_marks_failed_when_result_has_no_bpm(self, monkeypatch):
        import crate.analysis_daemon as analysis_daemon

        calls: dict[str, list] = {"updated": [], "done": [], "failed": []}
        track = {"id": 8, "path": "/music/empty.flac", "title": "Empty Track"}

        monkeypatch.setattr(analysis_daemon, "_reset_stale_claims", lambda state: None)
        monkeypatch.setattr(analysis_daemon, "_get_pending_count", lambda state: 1)
        monkeypatch.setattr(analysis_daemon, "_claim_track", lambda state: track)
        monkeypatch.setattr(analysis_daemon, "_mark_done", lambda track_id, state: calls["done"].append((track_id, state)))
        monkeypatch.setattr(analysis_daemon, "_mark_failed", lambda track_id, state: calls["failed"].append((track_id, state)))
        monkeypatch.setitem(sys.modules, "crate.audio_analysis", SimpleNamespace(analyze_track=lambda path: {"key": "D"}))
        monkeypatch.setitem(
            sys.modules,
            "crate.db.library",
            SimpleNamespace(update_track_analysis=lambda path, **kwargs: calls["updated"].append((path, kwargs))),
        )
        monkeypatch.setattr(analysis_daemon.time, "sleep", lambda _seconds: (_ for _ in ()).throw(_LoopExit()))

        with pytest.raises(_LoopExit):
            analysis_daemon.analysis_daemon({})

        assert calls["updated"] == []
        assert calls["done"] == []
        assert calls["failed"] == [(8, "analysis_state")]

    def test_bliss_daemon_stores_valid_vector(self, monkeypatch):
        import crate.analysis_daemon as analysis_daemon

        calls: dict[str, list] = {"stored": [], "failed": []}
        track = {"id": 9, "path": "/music/bliss.flac", "title": "Bliss Track"}
        vector = [0.1] * 20

        monkeypatch.setattr(analysis_daemon, "_reset_stale_claims", lambda state: None)
        monkeypatch.setattr(analysis_daemon, "_get_pending_count", lambda state: 1)
        monkeypatch.setattr(analysis_daemon, "_claim_track", lambda state: track)
        monkeypatch.setattr(analysis_daemon, "_mark_failed", lambda track_id, state: calls["failed"].append((track_id, state)))
        monkeypatch.setattr(analysis_daemon, "_db_store_bliss_vector", lambda track_id, data: calls["stored"].append((track_id, data)))
        monkeypatch.setitem(
            sys.modules,
            "crate.bliss",
            SimpleNamespace(is_available=lambda: True, analyze_file=lambda path: vector),
        )
        monkeypatch.setattr(analysis_daemon.time, "sleep", lambda _seconds: (_ for _ in ()).throw(_LoopExit()))

        with pytest.raises(_LoopExit):
            analysis_daemon.bliss_daemon({})

        assert calls["stored"] == [(9, vector)]
        assert calls["failed"] == []


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
class TestAnalysisJobsIntegration:
    def _seed_track(self, pg_db, suffix: str) -> dict:
        from crate.db.tx import transaction_scope

        artist = f"Analysis Artist {suffix}"
        album = f"Analysis Album {suffix}"
        path = f"/music/{artist}/{album}/track-{suffix}.flac"

        pg_db.upsert_artist({"name": artist})
        album_id = pg_db.upsert_album(
            {
                "artist": artist,
                "name": album,
                "path": f"/music/{artist}/{album}",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": artist,
                "album": album,
                "filename": f"track-{suffix}.flac",
                "title": f"Track {suffix}",
                "path": path,
                "duration": 180.0,
                "size": 1000,
                "format": "flac",
            }
        )

        with transaction_scope() as session:
            row = session.execute(
                text("SELECT id, path FROM library_tracks WHERE path = :path"),
                {"path": path},
            ).mappings().first()
        return dict(row)

    def test_claim_track_updates_state_and_status(self, pg_db):
        from crate.db.jobs import analysis as analysis_jobs
        from crate.db.tx import transaction_scope

        track = self._seed_track(pg_db, "claim")
        with transaction_scope() as session:
            session.execute(
                text("UPDATE library_tracks SET analysis_state = 'pending', bliss_state = 'pending' WHERE id = :id"),
                {"id": track["id"]},
            )

        assert analysis_jobs.get_pending_count("analysis_state") == 1

        claimed = analysis_jobs.claim_track("analysis_state")

        assert claimed is not None
        assert claimed["id"] == track["id"]
        assert analysis_jobs.get_pending_count("analysis_state") == 0

        status = analysis_jobs.get_analysis_status()
        assert status["total"] == 1
        assert status["analysis_active"] == 1
        assert status["analysis_pending"] == 0
        assert status["bliss_pending"] == 1

    def test_reset_stale_claims_and_store_bliss_vector(self, pg_db):
        from crate.db.jobs import analysis as analysis_jobs
        from crate.db.tx import transaction_scope

        track = self._seed_track(pg_db, "bliss")
        with transaction_scope() as session:
            session.execute(
                text("UPDATE library_tracks SET analysis_state = 'analyzing', bliss_state = 'pending' WHERE id = :id"),
                {"id": track["id"]},
            )

        reset = analysis_jobs.reset_stale_claims("analysis_state")
        assert reset == 1
        assert analysis_jobs.get_pending_count("analysis_state") == 1

        vector = [0.2] * 20
        analysis_jobs.store_bliss_vector(track["id"], vector)

        with transaction_scope() as session:
            row = session.execute(
                text("SELECT analysis_state, bliss_state, bliss_vector FROM library_tracks WHERE id = :id"),
                {"id": track["id"]},
            ).mappings().first()

        assert row["analysis_state"] == "pending"
        assert row["bliss_state"] == "done"
        assert row["bliss_vector"] == vector
