from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import uuid

from alembic import command
from alembic.config import Config
import psycopg2


ROOT = Path(__file__).resolve().parents[2]
SCHEMA_049_FIXTURE = ROOT / "app/tests/fixtures/schema_049.sql"
SCHEMA_049_SHA256 = "680a382b3ff73cd81f153753b9b34188e6d5b0408f49438a0da7d2f6e3b3cb71"


def _connection():
    return psycopg2.connect(
        host=os.environ["CRATE_POSTGRES_HOST"],
        port=os.environ["CRATE_POSTGRES_PORT"],
        user=os.environ["CRATE_POSTGRES_USER"],
        password=os.environ["CRATE_POSTGRES_PASSWORD"],
        dbname=os.environ["CRATE_POSTGRES_DB"],
    )


def _reset_schema() -> None:
    from crate.db.engine import reset_engine

    reset_engine()
    connection = _connection()
    connection.autocommit = True
    with connection.cursor() as cursor:
        cursor.execute("DROP SCHEMA IF EXISTS public CASCADE")
        cursor.execute("CREATE SCHEMA public")
        cursor.execute("GRANT ALL ON SCHEMA public TO PUBLIC")
    connection.close()


def _migrate(revision: str, *, downgrade: bool = False) -> None:
    config = Config(str(ROOT / "app/alembic.ini"))
    config.set_main_option(
        "script_location",
        str(ROOT / "app/crate/db/migrations"),
    )
    operation = command.downgrade if downgrade else command.upgrade
    operation(config, revision)


def _restore_049_schema_fixture() -> None:
    from crate.db.engine import reset_engine

    reset_engine()
    fixture = SCHEMA_049_FIXTURE.read_text()
    assert hashlib.sha256(fixture.encode()).hexdigest() == SCHEMA_049_SHA256
    connection = _connection()
    connection.autocommit = True
    try:
        with connection.cursor() as cursor:
            cursor.execute("DROP SCHEMA IF EXISTS public CASCADE")
            cursor.execute("CREATE SCHEMA public")
            cursor.execute("GRANT ALL ON SCHEMA public TO PUBLIC")
            cursor.execute(fixture)
            cursor.execute(
                "INSERT INTO public.alembic_version (version_num) VALUES ('049')"
            )
    finally:
        connection.close()


def _seed_049_user_library_state() -> dict[str, str | int]:
    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    track_uid = str(uuid.uuid4())
    connection = _connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO users (email, name, password_hash, created_at)
                VALUES ('legacy@example.test', 'Legacy User', 'hash', NOW())
                RETURNING id
                """
            )
            user_id = cursor.fetchone()[0]
            cursor.execute(
                """
                INSERT INTO library_artists
                    (name, folder_name, entity_uid, album_count, track_count)
                VALUES ('Legacy Artist', 'legacy-artist', %s, 1, 1)
                RETURNING id
                """,
                (artist_uid,),
            )
            artist_id = cursor.fetchone()[0]
            cursor.execute(
                """
                INSERT INTO library_albums
                    (artist, name, path, entity_uid, track_count)
                VALUES (
                    'Legacy Artist', 'Legacy Album',
                    '/music/legacy-artist/legacy-album', %s, 1
                )
                RETURNING id
                """,
                (album_uid,),
            )
            album_id = cursor.fetchone()[0]
            cursor.execute(
                """
                INSERT INTO library_tracks (
                    album_id, artist, album, filename, title, path, entity_uid
                ) VALUES (
                    %s, 'Legacy Artist', 'Legacy Album', '01-legacy.flac',
                    'Legacy Track',
                    '/music/legacy-artist/legacy-album/01-legacy.flac', %s
                )
                RETURNING id
                """,
                (album_id, track_uid),
            )
            track_id = cursor.fetchone()[0]
            cursor.execute(
                "INSERT INTO user_follows VALUES (%s, 'Legacy Artist', NOW())",
                (user_id,),
            )
            cursor.execute(
                "INSERT INTO user_saved_albums VALUES (%s, %s, NOW())",
                (user_id, album_id),
            )
            cursor.execute(
                "INSERT INTO user_liked_tracks VALUES (%s, %s, NOW())",
                (user_id, track_id),
            )
            cursor.execute(
                """
                INSERT INTO playlists (name, user_id, created_at, updated_at)
                VALUES ('Legacy Playlist', %s, NOW(), NOW())
                RETURNING id
                """,
                (user_id,),
            )
            playlist_id = cursor.fetchone()[0]
            cursor.execute(
                """
                INSERT INTO playlist_tracks (
                    playlist_id, track_id, track_entity_uid, track_path,
                    title, artist, album, position, added_at
                ) VALUES (
                    %s, %s, %s,
                    '/music/legacy-artist/legacy-album/01-legacy.flac',
                    'Legacy Track', 'Legacy Artist', 'Legacy Album', 1, NOW()
                )
                """,
                (playlist_id, track_id, track_uid),
            )
            cursor.execute(
                """
                INSERT INTO playlist_members
                    (playlist_id, user_id, role, invited_by, created_at)
                VALUES (%s, %s, 'owner', %s, NOW())
                """,
                (playlist_id, user_id, user_id),
            )
            cursor.execute(
                "INSERT INTO user_followed_playlists VALUES (%s, %s, NOW())",
                (user_id, playlist_id),
            )
            cursor.execute(
                """
                INSERT INTO bandcamp_connections (
                    user_id, username, session_secret_ref, session_fingerprint,
                    connection_method, created_at, updated_at
                ) VALUES (
                    %s, 'legacy-fan', 'legacy-secret', 'fingerprint',
                    'cookie', NOW(), NOW()
                ) RETURNING id
                """,
                (user_id,),
            )
            bandcamp_connection_id = cursor.fetchone()[0]
            cursor.execute(
                """
                INSERT INTO bandcamp_items (
                    bandcamp_item_id, bandcamp_item_type, artist_name,
                    album_title, item_url, first_seen_at, updated_at
                ) VALUES (
                    4242, 'album', 'Legacy Artist', 'Legacy Album',
                    'https://legacy.bandcamp.test/album', NOW(), NOW()
                ) RETURNING id
                """
            )
            bandcamp_item_id = cursor.fetchone()[0]
            cursor.execute(
                """
                INSERT INTO user_bandcamp_items (
                    user_id, connection_id, bandcamp_item_id, relation_type,
                    owned, downloadable, last_seen_at
                ) VALUES (%s, %s, %s, 'collection', TRUE, TRUE, NOW())
                """,
                (user_id, bandcamp_connection_id, bandcamp_item_id),
            )
        connection.commit()
    finally:
        connection.close()
    return {
        "user_id": user_id,
        "artist_id": artist_id,
        "artist_uid": artist_uid,
        "album_id": album_id,
        "album_uid": album_uid,
        "track_id": track_id,
        "track_uid": track_uid,
        "playlist_id": playlist_id,
        "bandcamp_connection_id": bandcamp_connection_id,
        "bandcamp_item_id": bandcamp_item_id,
    }


def _scalar(query: str, params: tuple = ()):
    connection = _connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(query, params)
            return cursor.fetchone()[0]
    finally:
        connection.close()


def _seed_063_legacy_state() -> dict[str, str]:
    local_uid = str(uuid.uuid4())
    peer_uid = str(uuid.uuid4())
    pairing_uid = str(uuid.uuid4())
    import_uid = str(uuid.uuid4())
    connection = _connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO federation_local_node (
                    node_uid, display_name, api_base_url, active_key_id,
                    public_keys_json, private_key_ref
                ) VALUES (%s, 'Legacy local', 'https://local.example.test',
                          'local-key', %s::jsonb,
                          'federation/keys/local-key.pem')
                """,
                (
                    local_uid,
                    json.dumps([{"key_id": "local-key", "public_key": "local-public"}]),
                ),
            )
            cursor.execute(
                """
                INSERT INTO federation_nodes (
                    node_uid, display_name, api_base_url, active_key_id,
                    public_keys_json, trust_state, default_grant_preset
                ) VALUES (%s, 'Legacy peer', 'https://peer.example.test',
                          'peer-key', %s::jsonb, 'pending', 'discovery')
                """,
                (
                    peer_uid,
                    json.dumps([{"key_id": "peer-key", "public_key": "peer-public"}]),
                ),
            )
            cursor.execute(
                """
                INSERT INTO federation_pairing_requests (
                    request_uid, remote_node_uid, remote_base_url, challenge,
                    status, expires_at
                ) VALUES (%s, %s, 'https://peer.example.test', 'challenge',
                          'pending', NOW() + INTERVAL '10 minutes')
                """,
                (pairing_uid, peer_uid),
            )
            cursor.execute(
                """
                INSERT INTO federation_peer_grants (
                    node_uid, principal_selector, preset, capabilities_json,
                    constraints_json
                ) VALUES (%s, %s, 'discovery',
                          '["catalog.search"]'::jsonb,
                          '{"max_results": 7}'::jsonb)
                """,
                (peer_uid, f"peer_users:{peer_uid}"),
            )
            cursor.execute(
                """
                INSERT INTO federation_import_requests (
                    request_id, node_uid, remote_entity_uid, title, status
                ) VALUES (%s, %s, 'legacy-album', 'Legacy album',
                          'pending_approval')
                """,
                (import_uid, peer_uid),
            )
        connection.commit()
    finally:
        connection.close()
    return {
        "local_uid": local_uid,
        "peer_uid": peer_uid,
        "pairing_uid": pairing_uid,
        "import_uid": import_uid,
    }


def _assert_hardened_state(ids: dict[str, str]) -> None:
    assert _scalar("SELECT version_num FROM alembic_version") == "090"
    assert (
        _scalar(
            "SELECT status FROM federation_local_keys WHERE node_uid = %s",
            (ids["local_uid"],),
        )
        == "active"
    )
    assert (
        _scalar(
            "SELECT status FROM federation_peer_keys WHERE node_uid = %s",
            (ids["peer_uid"],),
        )
        == "active"
    )
    assert (
        _scalar(
            "SELECT state FROM federation_pairings WHERE pairing_uid = %s",
            (ids["pairing_uid"],),
        )
        == "remote_pending"
    )
    assert (
        _scalar(
            "SELECT status FROM federation_import_requests WHERE request_id = %s",
            (ids["import_uid"],),
        )
        == "awaiting_approval"
    )
    assert _scalar(
        "SELECT idempotency_key IS NOT NULL FROM federation_import_requests "
        "WHERE request_id = %s",
        (ids["import_uid"],),
    )
    assert (
        _scalar(
            "SELECT capabilities_json ? 'stream.proxy' FROM federation_peer_grants "
            "WHERE node_uid = %s",
            (ids["peer_uid"],),
        )
        is False
    )


def test_empty_database_migrates_from_base_to_head(pg_db):
    del pg_db
    _reset_schema()

    _migrate("head")

    assert _scalar("SELECT version_num FROM alembic_version") == "090"
    for table in (
        "federation_local_keys",
        "federation_catalog_changes",
        "global_catalog_artist_route_aliases",
        "user_global_track_likes",
        "federation_directory_subscriptions",
        "federation_risk_observations",
        "domain_event_outbox",
        "global_catalog_search_documents",
        "global_catalog_search_projection_state",
    ):
        assert _scalar("SELECT to_regclass(%s) IS NOT NULL", (f"public.{table}",))


def test_080_upgrade_removes_deprecated_navidrome_column(pg_db):
    del pg_db
    _reset_schema()
    _migrate("080")
    connection = _connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("ALTER TABLE library_tracks ADD COLUMN navidrome_id TEXT")
        connection.commit()
    finally:
        connection.close()

    _migrate("head")

    assert _scalar("SELECT version_num FROM alembic_version") == "090"
    assert (
        _scalar(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'library_tracks'
                  AND column_name = 'navidrome_id'
            )
            """
        )
        is False
    )

    _migrate("080", downgrade=True)

    assert (
        _scalar(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'library_tracks'
                  AND column_name = 'navidrome_id'
            )
            """
        )
        is True
    )


def test_real_main_049_snapshot_upgrades_without_user_data_loss(pg_db):
    del pg_db
    _restore_049_schema_fixture()
    ids = _seed_049_user_library_state()

    _migrate("head")

    assert _scalar("SELECT version_num FROM alembic_version") == "090"
    assert _scalar("SELECT email FROM users WHERE id = %s", (ids["user_id"],)) == (
        "legacy@example.test"
    )
    assert (
        _scalar(
            "SELECT entity_uid::text FROM library_artists WHERE id = %s",
            (ids["artist_id"],),
        )
        == ids["artist_uid"]
    )
    assert (
        _scalar(
            "SELECT entity_uid::text FROM library_albums WHERE id = %s",
            (ids["album_id"],),
        )
        == ids["album_uid"]
    )
    assert (
        _scalar(
            "SELECT entity_uid::text FROM library_tracks WHERE id = %s",
            (ids["track_id"],),
        )
        == ids["track_uid"]
    )
    assert (
        _scalar(
            "SELECT COUNT(*) FROM user_follows WHERE user_id = %s",
            (ids["user_id"],),
        )
        == 1
    )
    assert (
        _scalar(
            "SELECT COUNT(*) FROM user_saved_albums WHERE user_id = %s",
            (ids["user_id"],),
        )
        == 1
    )
    assert (
        _scalar(
            "SELECT COUNT(*) FROM user_liked_tracks WHERE user_id = %s",
            (ids["user_id"],),
        )
        == 1
    )
    assert (
        _scalar(
            "SELECT COUNT(*) FROM user_global_track_like_repairs "
            "WHERE user_id = %s AND legacy_track_id = %s AND status = 'unresolved'",
            (ids["user_id"], ids["track_id"]),
        )
        == 1
    )
    assert (
        _scalar(
            "SELECT track_entity_uid::text FROM playlist_tracks WHERE playlist_id = %s",
            (ids["playlist_id"],),
        )
        == ids["track_uid"]
    )
    assert (
        _scalar(
            "SELECT COUNT(*) FROM playlist_members WHERE playlist_id = %s",
            (ids["playlist_id"],),
        )
        == 1
    )
    assert (
        _scalar(
            "SELECT COUNT(*) FROM user_followed_playlists WHERE user_id = %s",
            (ids["user_id"],),
        )
        == 1
    )
    assert (
        _scalar(
            "SELECT COUNT(*) FROM user_bandcamp_items "
            "WHERE user_id = %s AND connection_id = %s AND bandcamp_item_id = %s",
            (
                ids["user_id"],
                ids["bandcamp_connection_id"],
                ids["bandcamp_item_id"],
            ),
        )
        == 1
    )


def test_063_snapshot_upgrades_without_trust_or_import_escalation(pg_db):
    del pg_db
    _reset_schema()
    _migrate("063")
    ids = _seed_063_legacy_state()

    _migrate("head")

    _assert_hardened_state(ids)
    assert (
        _scalar(
            "SELECT trust_state FROM federation_nodes WHERE node_uid = %s",
            (ids["peer_uid"],),
        )
        == "pending"
    )


def test_head_rolls_back_to_063_boundary_and_reupgrades(pg_db):
    del pg_db
    _reset_schema()
    _migrate("063")
    ids = _seed_063_legacy_state()
    _migrate("head")

    _migrate("063", downgrade=True)

    assert _scalar("SELECT version_num FROM alembic_version") == "063"
    assert (
        _scalar(
            "SELECT status FROM federation_import_requests WHERE request_id = %s",
            (ids["import_uid"],),
        )
        == "pending_approval"
    )
    assert _scalar(
        "SELECT public_keys_json @> %s::jsonb FROM federation_local_node "
        "WHERE node_uid = %s",
        (json.dumps([{"key_id": "local-key"}]), ids["local_uid"]),
    )

    _migrate("head")

    _assert_hardened_state(ids)
