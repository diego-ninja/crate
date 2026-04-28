import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
class TestImportQueueReadModels:
    def _ensure_tables(self):
        from crate.db.tx import transaction_scope

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS ui_snapshots (
                        scope TEXT NOT NULL,
                        subject_key TEXT NOT NULL,
                        version INTEGER NOT NULL DEFAULT 1,
                        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                        built_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        source_seq BIGINT,
                        generation_ms INTEGER,
                        stale_after TIMESTAMPTZ,
                        PRIMARY KEY (scope, subject_key)
                    )
                    """
                )
            )
            # domain_events now live in Redis Streams, no PG table needed.
            session.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS ops_runtime_state (
                        key TEXT PRIMARY KEY,
                        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
            )
            session.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS import_queue_items (
                        id BIGSERIAL PRIMARY KEY,
                        source TEXT NOT NULL DEFAULT 'filesystem',
                        path TEXT NOT NULL,
                        artist TEXT,
                        album TEXT,
                        status TEXT NOT NULL DEFAULT 'pending',
                        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                        discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        UNIQUE (source, path)
                    )
                    """
                )
            )

    def test_refresh_list_mark_and_remove_import_queue_items(self):
        from crate.db.import_queue_read_models import (
            count_import_queue_items,
            list_import_queue_items,
            mark_import_queue_item_imported,
            refresh_import_queue_items,
            remove_import_queue_item,
        )
        from crate.db.tx import transaction_scope

        self._ensure_tables()

        suffix = uuid.uuid4().hex[:8]
        source_path = f"/music/.imports/tidal/Artist-{suffix}/Album-{suffix}"
        dest_path = f"/music/Artist-{suffix}/Album-{suffix}"

        refresh_result = refresh_import_queue_items(
            [
                {
                    "source": "tidal",
                    "source_path": source_path,
                    "artist": f"Artist {suffix}",
                    "album": f"Album {suffix}",
                    "track_count": 12,
                    "formats": ["flac"],
                    "total_size_mb": 512,
                    "dest_path": dest_path,
                    "dest_exists": False,
                    "status": "pending",
                }
            ],
            scanned_sources=["tidal"],
        )

        assert refresh_result["pending"] >= 1
        pending = list_import_queue_items(status="pending")
        current = next(item for item in pending if item["source_path"] == source_path)
        assert current["artist"] == f"Artist {suffix}"
        assert current["album"] == f"Album {suffix}"
        assert current["track_count"] == 12
        assert current["formats"] == ["flac"]

        changed = mark_import_queue_item_imported(
            source_path,
            result={"status": "imported", "dest": dest_path},
            source="tidal",
        )
        assert changed is True
        assert all(item["source_path"] != source_path for item in list_import_queue_items(status="pending"))

        refresh_import_queue_items(
            [
                {
                    "source": "tidal",
                    "source_path": source_path,
                    "artist": f"Artist {suffix}",
                    "album": f"Album {suffix}",
                    "track_count": 12,
                    "formats": ["flac"],
                    "total_size_mb": 512,
                    "dest_path": dest_path,
                    "dest_exists": True,
                    "status": "pending",
                }
            ],
            scanned_sources=["tidal"],
        )

        assert all(item["source_path"] != source_path for item in list_import_queue_items(status="pending"))

        removed = remove_import_queue_item(source_path, source="tidal")
        assert removed is True

        with transaction_scope() as session:
            row = session.execute(
                text(
                    """
                    SELECT COUNT(*) AS cnt
                    FROM import_queue_items
                    WHERE source = 'tidal' AND path = :path
                    """
                ),
                {"path": source_path},
            ).mappings().first()
        assert int(row["cnt"]) == 0
        assert count_import_queue_items(status="pending") >= 0

    def test_refresh_removes_stale_items_for_scanned_sources(self):
        from crate.db.import_queue_read_models import list_import_queue_items, refresh_import_queue_items

        self._ensure_tables()

        suffix = uuid.uuid4().hex[:8]
        source_path = f"/music/.imports/soulseek/Artist-{suffix}/Album-{suffix}"

        refresh_import_queue_items(
            [
                {
                    "source": "soulseek",
                    "source_path": source_path,
                    "artist": f"Artist {suffix}",
                    "album": f"Album {suffix}",
                    "track_count": 5,
                    "formats": ["mp3"],
                    "total_size_mb": 120,
                    "dest_path": f"/music/Artist-{suffix}/Album-{suffix}",
                    "dest_exists": False,
                    "status": "pending",
                }
            ],
            scanned_sources=["soulseek"],
        )

        assert any(item["source_path"] == source_path for item in list_import_queue_items(status="pending"))

        refresh_import_queue_items([], scanned_sources=["soulseek"])

        assert all(item["source_path"] != source_path for item in list_import_queue_items(status="pending"))
