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

        calls: dict[str, list] = {"stored": [], "failed": [], "released": []}
        track = {"id": 7, "path": "/music/test.flac", "title": "Test Track"}

        monkeypatch.setattr(analysis_daemon, "_reset_stale_claims", lambda state: None)
        monkeypatch.setattr(analysis_daemon, "_get_pending_count", lambda state: 1)
        monkeypatch.setattr(analysis_daemon, "_claim_tracks", lambda state, limit: [track])
        monkeypatch.setattr(analysis_daemon, "_should_pause_for_load", lambda: False)
        monkeypatch.setattr(analysis_daemon, "_mark_failed", lambda track_id, state: calls["failed"].append((track_id, state)))
        monkeypatch.setattr(analysis_daemon, "_release_claims", lambda track_ids, state: calls["released"].append((track_ids, state)))
        monkeypatch.setattr(
            analysis_daemon,
            "_store_analysis_results",
            lambda results: calls["stored"].extend(results),
        )
        monkeypatch.setitem(
            sys.modules,
            "crate.audio_analysis",
            SimpleNamespace(
                analyze_batch=lambda paths: [
                    {
                        "bpm": 128.4,
                        "key": "C",
                        "scale": "major",
                        "energy": 0.91,
                        "mood": {"happy": 0.8},
                    }
                ],
                analyze_track=lambda path: {
                    "bpm": 128.4,
                    "key": "C",
                    "scale": "major",
                    "energy": 0.91,
                    "mood": {"happy": 0.8},
                }
            ),
        )
        monkeypatch.setattr(analysis_daemon.time, "sleep", lambda _seconds: (_ for _ in ()).throw(_LoopExit()))

        with pytest.raises(_LoopExit):
            analysis_daemon.analysis_daemon({})

        assert calls["stored"] == [
            (
                7,
                "/music/test.flac",
                {
                    "bpm": 128.4,
                    "key": "C",
                    "scale": "major",
                    "energy": 0.91,
                    "mood": {"happy": 0.8},
                },
            )
        ]
        assert calls["failed"] == []
        assert calls["released"] == []

    def test_analysis_daemon_marks_failed_when_result_has_no_bpm(self, monkeypatch):
        import crate.analysis_daemon as analysis_daemon

        calls: dict[str, list] = {"stored": [], "failed": [], "released": []}
        track = {"id": 8, "path": "/music/empty.flac", "title": "Empty Track"}

        monkeypatch.setattr(analysis_daemon, "_reset_stale_claims", lambda state: None)
        monkeypatch.setattr(analysis_daemon, "_get_pending_count", lambda state: 1)
        monkeypatch.setattr(analysis_daemon, "_claim_tracks", lambda state, limit: [track])
        monkeypatch.setattr(analysis_daemon, "_should_pause_for_load", lambda: False)
        monkeypatch.setattr(analysis_daemon, "_mark_failed", lambda track_id, state: calls["failed"].append((track_id, state)))
        monkeypatch.setattr(analysis_daemon, "_release_claims", lambda track_ids, state: calls["released"].append((track_ids, state)))
        monkeypatch.setattr(
            analysis_daemon,
            "_store_analysis_results",
            lambda results: calls["stored"].extend(results),
        )
        monkeypatch.setitem(
            sys.modules,
            "crate.audio_analysis",
            SimpleNamespace(
                analyze_batch=lambda paths: [{"key": "D"}],
                analyze_track=lambda path: {"key": "D"},
            ),
        )
        monkeypatch.setattr(analysis_daemon.time, "sleep", lambda _seconds: (_ for _ in ()).throw(_LoopExit()))

        with pytest.raises(_LoopExit):
            analysis_daemon.analysis_daemon({})

        assert calls["stored"] == []
        assert calls["failed"] == [(8, "analysis_state")]
        assert calls["released"] == []

    def test_bliss_daemon_stores_valid_vector(self, monkeypatch):
        import crate.analysis_daemon as analysis_daemon

        calls: dict[str, list] = {"stored": [], "failed": [], "released": []}
        track = {"id": 9, "path": "/music/bliss.flac", "title": "Bliss Track"}
        vector = [0.1] * 20

        monkeypatch.setattr(analysis_daemon, "_reset_stale_claims", lambda state: None)
        monkeypatch.setattr(analysis_daemon, "_get_pending_count", lambda state: 1)
        monkeypatch.setattr(analysis_daemon, "_claim_tracks", lambda state, limit: [track])
        monkeypatch.setattr(analysis_daemon, "_should_pause_for_load", lambda: False)
        monkeypatch.setattr(analysis_daemon, "_mark_failed", lambda track_id, state: calls["failed"].append((track_id, state)))
        monkeypatch.setattr(analysis_daemon, "_release_claims", lambda track_ids, state: calls["released"].append((track_ids, state)))
        monkeypatch.setattr(
            analysis_daemon,
            "_store_bliss_vectors",
            lambda batch: calls["stored"].append(batch),
        )
        monkeypatch.setitem(
            sys.modules,
            "crate.bliss",
            SimpleNamespace(is_available=lambda: True, analyze_file=lambda path: vector),
        )
        monkeypatch.setattr(analysis_daemon.time, "sleep", lambda _seconds: (_ for _ in ()).throw(_LoopExit()))

        with pytest.raises(_LoopExit):
            analysis_daemon.bliss_daemon({})

        assert calls["stored"] == [{9: vector}]
        assert calls["failed"] == []
        assert calls["released"] == []


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

    def test_upsert_track_creates_processing_rows(self, pg_db):
        from crate.db.tx import transaction_scope

        track = self._seed_track(pg_db, "processing-rows")

        with transaction_scope() as session:
            rows = session.execute(
                text(
                    """
                    SELECT pipeline, state
                    FROM track_processing_state
                    WHERE track_id = :id
                    ORDER BY pipeline
                    """
                ),
                {"id": track["id"]},
            ).mappings().all()

        assert {(row["pipeline"], row["state"]) for row in rows} == {
            ("analysis", "pending"),
            ("bliss", "pending"),
        }

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
        from crate.db.management import get_last_bliss_track
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
                text(
                    """
                    SELECT analysis_state, bliss_state, bliss_vector,
                           bliss_computed_at,
                           bliss_embedding IS NOT NULL AS has_bliss_embedding
                    FROM library_tracks
                    WHERE id = :id
                    """
                ),
                {"id": track["id"]},
            ).mappings().first()

        assert row["analysis_state"] == "pending"
        assert row["bliss_state"] == "done"
        assert row["bliss_vector"] == vector
        assert row["has_bliss_embedding"] is True
        assert row["bliss_computed_at"] is not None

        last_bliss = get_last_bliss_track()
        assert last_bliss["title"] == "Track bliss"

    def test_bliss_claim_skips_tracks_under_active_analysis(self, pg_db):
        from crate.db.jobs import analysis as analysis_jobs
        from crate.db.tx import transaction_scope

        blocked = self._seed_track(pg_db, "blocked")
        eligible = self._seed_track(pg_db, "eligible")

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET analysis_state = 'analyzing', bliss_state = 'pending', updated_at = NOW() + INTERVAL '2 seconds'
                    WHERE id = :id
                    """
                ),
                {"id": blocked["id"]},
            )
            session.execute(
                text(
                    """
                    UPDATE track_processing_state
                    SET state = 'analyzing',
                        claimed_by = 'test-suite',
                        claimed_at = NOW(),
                        updated_at = NOW()
                    WHERE track_id = :id
                      AND pipeline = 'analysis'
                    """
                ),
                {"id": blocked["id"]},
            )
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET analysis_state = 'pending', bliss_state = 'pending', updated_at = NOW()
                    WHERE id = :id
                    """
                ),
                {"id": eligible["id"]},
            )

        claimed = analysis_jobs.claim_track("bliss_state")

        assert claimed is not None
        assert claimed["id"] == eligible["id"]

        with transaction_scope() as session:
            rows = session.execute(
                text("SELECT id, analysis_state, bliss_state FROM library_tracks WHERE id IN (:blocked_id, :eligible_id) ORDER BY id"),
                {"blocked_id": blocked["id"], "eligible_id": eligible["id"]},
            ).mappings().all()

        by_id = {row["id"]: row for row in rows}
        assert by_id[blocked["id"]]["analysis_state"] == "analyzing"
        assert by_id[blocked["id"]]["bliss_state"] == "pending"
        assert by_id[eligible["id"]]["bliss_state"] == "analyzing"

    def test_bliss_claim_ignores_stale_legacy_analysis_state_when_processing_row_is_pending(self, pg_db):
        from crate.db.jobs import analysis as analysis_jobs
        from crate.db.tx import transaction_scope

        track = self._seed_track(pg_db, "legacy-stale")

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET analysis_state = 'analyzing', bliss_state = 'pending', updated_at = NOW()
                    WHERE id = :id
                    """
                ),
                {"id": track["id"]},
            )
            session.execute(
                text(
                    """
                    UPDATE track_processing_state
                    SET state = 'pending',
                        claimed_by = NULL,
                        claimed_at = NULL,
                        updated_at = NOW()
                    WHERE track_id = :id
                      AND pipeline IN ('analysis', 'bliss')
                    """
                ),
                {"id": track["id"]},
            )

        claimed = analysis_jobs.claim_track("bliss_state")

        assert claimed is not None
        assert claimed["id"] == track["id"]

    def test_processing_rows_prefer_shadow_tables_when_legacy_states_are_stale(self, pg_db):
        from crate.db.jobs import analysis as analysis_jobs
        from crate.db.tx import transaction_scope

        track = self._seed_track(pg_db, "shadow-truth")
        vector = [0.6] * 20
        vector_literal = "[" + ",".join(["0.6"] * 20) + "]"

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET analysis_state = 'pending',
                        bliss_state = 'pending',
                        bpm = 126.0,
                        audio_key = 'F',
                        audio_scale = 'minor',
                        energy = 0.67,
                        bliss_vector = CAST(:vector AS double precision[]),
                        bliss_embedding = CAST(:vector_literal AS vector(20))
                    WHERE id = :id
                    """
                ),
                {"id": track["id"], "vector": vector, "vector_literal": vector_literal},
            )
            session.execute(text("DELETE FROM track_processing_state WHERE track_id = :id"), {"id": track["id"]})
            session.execute(
                text(
                    """
                    INSERT INTO track_analysis_features (
                        track_id,
                        bpm,
                        audio_key,
                        audio_scale,
                        energy,
                        updated_at
                    )
                    VALUES (
                        :track_id,
                        126.0,
                        'F',
                        'minor',
                        0.67,
                        TIMESTAMPTZ '2026-04-27T09:30:00Z'
                    )
                    ON CONFLICT (track_id) DO UPDATE SET
                        bpm = EXCLUDED.bpm,
                        audio_key = EXCLUDED.audio_key,
                        audio_scale = EXCLUDED.audio_scale,
                        energy = EXCLUDED.energy,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {"track_id": track["id"]},
            )
            session.execute(
                text(
                    """
                    INSERT INTO track_bliss_embeddings (
                        track_id,
                        bliss_vector,
                        bliss_embedding,
                        updated_at
                    )
                    VALUES (
                        :track_id,
                        :vector,
                        CAST(:vector_literal AS vector(20)),
                        TIMESTAMPTZ '2026-04-27T10:00:00Z'
                    )
                    ON CONFLICT (track_id) DO UPDATE SET
                        bliss_vector = EXCLUDED.bliss_vector,
                        bliss_embedding = EXCLUDED.bliss_embedding,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {"track_id": track["id"], "vector": vector, "vector_literal": vector_literal},
            )

        assert analysis_jobs.get_pending_count("analysis_state") == 0
        assert analysis_jobs.get_pending_count("bliss_state") == 0

        with transaction_scope() as session:
            rows = session.execute(
                text(
                    """
                    SELECT pipeline, state, completed_at
                    FROM track_processing_state
                    WHERE track_id = :id
                    ORDER BY pipeline
                    """
                ),
                {"id": track["id"]},
            ).mappings().all()

        assert {(row["pipeline"], row["state"]) for row in rows} == {
            ("analysis", "done"),
            ("bliss", "done"),
        }
        assert all(row["completed_at"] is not None for row in rows)

    def test_processing_rows_do_not_trust_legacy_done_without_shadow_data(self, pg_db):
        from crate.db.jobs import analysis as analysis_jobs
        from crate.db.management import get_last_analyzed_track, get_last_bliss_track
        from crate.db.tx import transaction_scope

        track = self._seed_track(pg_db, "legacy-done-no-shadow")

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET analysis_state = 'done',
                        bliss_state = 'done',
                        analysis_completed_at = TIMESTAMPTZ '2026-04-27T08:00:00Z',
                        bliss_computed_at = TIMESTAMPTZ '2026-04-27T08:00:00Z',
                        bpm = NULL,
                        audio_key = NULL,
                        energy = NULL,
                        mood_json = NULL,
                        bliss_vector = NULL,
                        bliss_embedding = NULL
                    WHERE id = :id
                    """
                ),
                {"id": track["id"]},
            )
            session.execute(text("DELETE FROM track_processing_state WHERE track_id = :id"), {"id": track["id"]})
            session.execute(text("DELETE FROM track_analysis_features WHERE track_id = :id"), {"id": track["id"]})
            session.execute(text("DELETE FROM track_bliss_embeddings WHERE track_id = :id"), {"id": track["id"]})

        assert analysis_jobs.get_pending_count("analysis_state") == 1
        assert analysis_jobs.get_pending_count("bliss_state") == 1
        assert get_last_analyzed_track() == {}
        assert get_last_bliss_track() == {}

    def test_last_pipeline_cards_use_pipeline_specific_timestamps(self, pg_db):
        from crate.db.management import get_last_analyzed_track, get_last_bliss_track
        from crate.db.tx import transaction_scope

        bliss_track = self._seed_track(pg_db, "bliss-last")
        analysis_track = self._seed_track(pg_db, "analysis-last")

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET bliss_state = 'done',
                        bliss_vector = CAST(:vector AS double precision[]),
                        bliss_computed_at = TIMESTAMPTZ '2026-04-23T10:00:00Z',
                        updated_at = TIMESTAMPTZ '2026-04-23T11:00:00Z'
                    WHERE id = :id
                    """
                ),
                {"id": bliss_track["id"], "vector": [0.3] * 20},
            )
            session.execute(
                text(
                    """
                    INSERT INTO track_bliss_embeddings (track_id, bliss_vector, bliss_embedding, updated_at)
                    VALUES (
                        :track_id,
                        :vector,
                        CAST(:vector_literal AS vector(20)),
                        TIMESTAMPTZ '2026-04-23T10:00:00Z'
                    )
                    ON CONFLICT (track_id) DO UPDATE SET
                        bliss_vector = EXCLUDED.bliss_vector,
                        bliss_embedding = EXCLUDED.bliss_embedding,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "track_id": bliss_track["id"],
                    "vector": [0.3] * 20,
                    "vector_literal": "[" + ",".join(["0.3"] * 20) + "]",
                },
            )
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET analysis_state = 'done',
                        bpm = 128.0,
                        energy = 0.82,
                        analysis_completed_at = TIMESTAMPTZ '2026-04-23T12:00:00Z',
                        updated_at = TIMESTAMPTZ '2026-04-23T09:00:00Z'
                    WHERE id = :id
                    """
                ),
                {"id": analysis_track["id"]},
            )
            session.execute(
                text(
                    """
                    INSERT INTO track_analysis_features (
                        track_id,
                        bpm,
                        energy,
                        updated_at
                    )
                    VALUES (
                        :track_id,
                        128.0,
                        0.82,
                        TIMESTAMPTZ '2026-04-23T12:00:00Z'
                    )
                    ON CONFLICT (track_id) DO UPDATE SET
                        bpm = EXCLUDED.bpm,
                        energy = EXCLUDED.energy,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {"track_id": analysis_track["id"]},
            )

        last_bliss = get_last_bliss_track()
        last_analyzed = get_last_analyzed_track()

        assert last_bliss["title"] == "Track bliss-last"
        assert last_bliss["updated_at"] is not None
        assert last_analyzed["title"] == "Track analysis-last"
        assert last_analyzed["updated_at"] is not None

    def test_backfill_pipeline_read_models_populates_shadow_tables(self, pg_db):
        from crate.db.jobs import analysis as analysis_jobs
        from crate.db.tx import transaction_scope

        track = self._seed_track(pg_db, "shadow-backfill")

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET analysis_state = 'done',
                        bpm = 124.0,
                        audio_key = 'A',
                        audio_scale = 'minor',
                        energy = 0.71,
                        bliss_state = 'done',
                        bliss_vector = CAST(:vector AS double precision[]),
                        bliss_embedding = CAST(:vector_literal AS vector(20)),
                        analysis_completed_at = NOW(),
                        bliss_computed_at = NOW()
                    WHERE id = :id
                    """
                ),
                {
                    "id": track["id"],
                    "vector": [0.4] * 20,
                    "vector_literal": "[" + ",".join(["0.4"] * 20) + "]",
                },
            )
            session.execute(text("DELETE FROM track_processing_state WHERE track_id = :id"), {"id": track["id"]})
            session.execute(text("DELETE FROM track_analysis_features WHERE track_id = :id"), {"id": track["id"]})
            session.execute(text("DELETE FROM track_bliss_embeddings WHERE track_id = :id"), {"id": track["id"]})

        result = analysis_jobs.backfill_pipeline_read_models(limit=100)

        assert result["processing_analysis"] >= 1
        assert result["processing_bliss"] >= 1
        assert result["analysis_features"] >= 1
        assert result["bliss_embeddings"] >= 1

        with transaction_scope() as session:
            processing = session.execute(
                text(
                    """
                    SELECT pipeline, state
                    FROM track_processing_state
                    WHERE track_id = :id
                    ORDER BY pipeline
                    """
                ),
                {"id": track["id"]},
            ).mappings().all()
            analysis_features = session.execute(
                text(
                    """
                    SELECT bpm, audio_key, audio_scale, energy
                    FROM track_analysis_features
                    WHERE track_id = :id
                    """
                ),
                {"id": track["id"]},
            ).mappings().first()
            bliss_features = session.execute(
                text(
                    """
                    SELECT bliss_vector, bliss_embedding IS NOT NULL AS has_embedding
                    FROM track_bliss_embeddings
                    WHERE track_id = :id
                    """
                ),
                {"id": track["id"]},
            ).mappings().first()

        assert {(row["pipeline"], row["state"]) for row in processing} == {
            ("analysis", "done"),
            ("bliss", "done"),
        }
        assert analysis_features["bpm"] == 124.0
        assert analysis_features["audio_key"] == "A"
        assert analysis_features["audio_scale"] == "minor"
        assert analysis_features["energy"] == 0.71
        assert bliss_features["bliss_vector"] == [0.4] * 20
        assert bliss_features["has_embedding"] is True
