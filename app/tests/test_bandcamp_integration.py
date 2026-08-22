import json
import os
import tempfile
import uuid
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


@pytest.fixture
def bandcamp_api_client(pg_db, monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("JWT_SECRET", "test-secret-key-1234-12345678901234")
    test_lib = tempfile.mkdtemp(prefix="crate_bandcamp_test_lib_")
    os.environ["CRATE_TEST_LIB"] = test_lib

    async def _fake_resolve_user(self, request):
        return {
            "id": 1,
            "email": "admin@cratemusic.app",
            "role": "admin",
            "username": "admin",
            "name": "Test Admin",
        }

    with (
        patch(
            "crate.api._deps.load_config",
            return_value={
                "library_path": test_lib,
                "audio_extensions": [".flac", ".mp3"],
                "exclude_dirs": [],
            },
        ),
        patch("crate.api.auth.AuthMiddleware.resolve_user", _fake_resolve_user),
    ):
        from crate.api import create_app

        app = create_app()
        with TestClient(app) as client:
            yield client


def test_bandcamp_secret_store_roundtrips_and_revokes(pg_db, monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret-key-1234-12345678901234")

    from crate.bandcamp.credentials import (
        CredentialSecretError,
        load_secret,
        revoke_secret,
        store_secret,
    )

    secret_ref = store_secret(
        "bandcamp_session",
        {"cookies": {"identity": "private-cookie"}, "profile": {"username": "diego"}},
    )

    assert (
        load_secret(secret_ref, scope="bandcamp_session")["cookies"]["identity"]
        == "private-cookie"
    )

    revoke_secret(secret_ref)
    with pytest.raises(CredentialSecretError):
        load_secret(secret_ref, scope="bandcamp_session")


def test_bandcamp_connect_session_creates_connection(bandcamp_api_client):
    response = bandcamp_api_client.post(
        "/api/bandcamp/me/connect/session",
        json={
            "connection_method": "manual_dev",
            "session": {
                "cookies": {"identity": "cookie-value"},
                "profile": {
                    "username": "diego",
                    "fan_id": 123,
                    "display_name": "Diego",
                    "image_url": "https://bandcamp.com/avatar.jpg",
                },
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["connected"] is True
    assert payload["username"] == "diego"
    assert payload["fan_id"] == 123


def test_bandcamp_connect_cookie_creates_connection(bandcamp_api_client, monkeypatch):
    from crate.bandcamp.models import BandcampFanIdentity

    class FakeBandcampWebClient:
        def __init__(self, session_material, *, timeout):
            self.session_material = session_material
            self.timeout = timeout

        def validate_session(self):
            assert self.session_material.cookies["identity"] == "cookie-value"
            assert self.session_material.cookies["client_id"] == "client-cookie"
            return BandcampFanIdentity(
                username="diego",
                fan_id=123,
                display_name="Diego",
                image_url="https://bandcamp.com/avatar.jpg",
            )

    monkeypatch.setattr("crate.api.bandcamp.BandcampWebClient", FakeBandcampWebClient)

    response = bandcamp_api_client.post(
        "/api/bandcamp/me/connect/cookie",
        json={
            "connection_method": "manual_cookie",
            "cookie": "identity=cookie-value; client_id=client-cookie",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["connected"] is True
    assert payload["username"] == "diego"
    assert payload["fan_id"] == 123


def test_bandcamp_status_reports_bridge_runtime(bandcamp_api_client, monkeypatch):
    monkeypatch.setenv("CRATE_BANDCAMP_WEB_CREDENTIAL_BRIDGE_ENABLED", "true")
    monkeypatch.setenv("CRATE_BANDCAMP_CREDENTIAL_BRIDGE_BACKEND", "command")
    monkeypatch.delenv("CRATE_BANDCAMP_CREDENTIAL_BRIDGE_COMMAND", raising=False)

    response = bandcamp_api_client.get("/api/bandcamp/me/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["bridge_enabled"] is True
    assert payload["bridge_ready"] is False
    assert payload["bridge_backend"] == "command"
    assert "command is not configured" in payload["bridge_message"]


def test_bandcamp_command_bridge_parses_connected_session(monkeypatch):
    monkeypatch.setenv("CRATE_BANDCAMP_WEB_CREDENTIAL_BRIDGE_ENABLED", "true")
    monkeypatch.setenv("CRATE_BANDCAMP_CREDENTIAL_BRIDGE_BACKEND", "command")
    monkeypatch.setenv(
        "CRATE_BANDCAMP_CREDENTIAL_BRIDGE_COMMAND", "fake-bandcamp-broker"
    )

    from crate.bandcamp import credential_broker

    def _fake_run(*args, **kwargs):
        assert json.loads(kwargs["input"].decode("utf-8")) == {
            "email": "fan@example.com",
            "password": "secret",
        }
        return SimpleNamespace(
            returncode=0,
            stdout=json.dumps(
                {
                    "status": "connected",
                    "session": {
                        "cookies": {"identity": "cookie"},
                        "profile": {"username": "fan", "fan_id": 456},
                    },
                }
            ).encode("utf-8"),
            stderr=b"",
        )

    monkeypatch.setattr(credential_broker.subprocess, "run", _fake_run)

    result = credential_broker.login_with_credentials(
        email="fan@example.com",
        password="secret",
    )

    assert result.status == "connected"
    assert result.session
    assert result.session.profile.username == "fan"


def test_bandcamp_credential_bridge_defaults_to_browser_backend(monkeypatch):
    monkeypatch.setenv("CRATE_BANDCAMP_WEB_CREDENTIAL_BRIDGE_ENABLED", "true")
    monkeypatch.delenv("CRATE_BANDCAMP_CREDENTIAL_BRIDGE_BACKEND", raising=False)

    from crate.bandcamp import credential_broker
    from crate.bandcamp.models import BandcampCredentialLoginResult

    monkeypatch.setattr(
        credential_broker,
        "_login_with_browser_backend",
        lambda **kwargs: BandcampCredentialLoginResult(status="connected"),
    )

    result = credential_broker.login_with_credentials(
        email="fan@example.com",
        password="secret",
    )

    assert result.status == "connected"


def test_bandcamp_collection_sync_command_parses_normalized_items(monkeypatch):
    monkeypatch.setenv("CRATE_BANDCAMP_COLLECTION_SYNC_COMMAND", "fake-bandcamp-sync")

    from crate.bandcamp import collection_sync
    from crate.bandcamp.models import BandcampFanIdentity, BandcampSessionMaterial

    def _fake_run(*args, **kwargs):
        assert json.loads(kwargs["input"].decode("utf-8")) == {
            "session": {
                "cookies": {"identity": "cookie"},
                "profile": {
                    "username": "fan",
                    "fan_id": 456,
                    "display_name": "",
                    "image_url": "",
                },
            },
            "include": ["collection", "wishlist"],
        }
        return SimpleNamespace(
            returncode=0,
            stdout=json.dumps(
                {
                    "collection": [
                        {
                            "item_url": "https://artist.bandcamp.com/album/lp",
                            "type": "album",
                            "artist": "Artist",
                            "title": "LP",
                            "cover_url": "https://f4.bcbits.com/img/a.jpg",
                            "tags": ["screamo"],
                            "downloadable": True,
                        }
                    ],
                    "wishlist": [
                        {
                            "relation_type": "wishlist",
                            "item": {
                                "url": "https://artist.bandcamp.com/track/song",
                                "type": "track",
                                "artist_name": "Artist",
                                "track_title": "Song",
                            },
                        }
                    ],
                }
            ).encode("utf-8"),
            stderr=b"",
        )

    monkeypatch.setattr(collection_sync.subprocess, "run", _fake_run)

    result = collection_sync.sync_collection_with_command(
        BandcampSessionMaterial(
            cookies={"identity": "cookie"},
            profile=BandcampFanIdentity(username="fan", fan_id=456),
        ),
        include=["collection", "wishlist"],
    )

    assert [item.relation_type for item in result.items] == ["collection", "wishlist"]
    assert result.items[0].item["album_title"] == "LP"
    assert result.items[0].owned is True
    assert result.items[1].item["track_title"] == "Song"


def test_bandcamp_web_parses_fan_identity_and_collection_page():
    from crate.bandcamp.web import (
        extract_fan_identity_from_home_html,
        parse_fancollection_page,
    )

    identity_blob = {
        "pageContext": {
            "identity": {
                "username": "fan",
                "fanId": 456,
                "name": "Fan User",
                "imageUrl": "https://bandcamp.com/fan.jpg",
            }
        }
    }
    html = (
        '<html><body><div id="HomepageApp" data-blob="'
        + json.dumps(identity_blob).replace('"', "&quot;")
        + '"></div></body></html>'
    )

    identity = extract_fan_identity_from_home_html(html)
    assert identity.username == "fan"
    assert identity.fan_id == 456

    entries, next_token = parse_fancollection_page(
        {
            "items": [
                {
                    "item_id": 101,
                    "item_type": "album",
                    "sale_item_type": "a",
                    "sale_item_id": 101,
                    "band_id": 202,
                    "band_name": "Artist",
                    "item_title": "LP",
                    "item_url": "https://artist.bandcamp.com/album/lp",
                    "band_url": "https://artist.bandcamp.com",
                    "item_art_url": "https://f4.bcbits.com/img/a.jpg",
                    "token": "123:1:a::",
                }
            ],
            "redownload_urls": {"a101": "https://bandcamp.com/download?id=101"},
        },
        relation_type="collection",
    )

    assert next_token == "123:1:a::"
    assert entries[0]["owned"] is True
    assert entries[0]["downloadable"] is True
    assert entries[0]["item"]["album_title"] == "LP"
    assert entries[0]["item"]["artist_url"] == "https://artist.bandcamp.com"
    assert entries[0]["item"]["raw"]["download_url_key"] == "a101"
    assert "redownload_url" not in entries[0]["item"]["raw"]


def test_bandcamp_web_skips_items_without_bandcamp_url():
    from crate.bandcamp.web import parse_fancollection_page

    entries, next_token = parse_fancollection_page(
        {
            "items": [
                {
                    "item_id": 101,
                    "item_type": "album",
                    "band_name": "Artist",
                    "item_title": "LP",
                    "item_url": "https://example.com/not-bandcamp",
                    "token": "bad-token",
                },
                {
                    "item_id": 102,
                    "item_type": "album",
                    "band_name": "Artist",
                    "item_title": "Real LP",
                    "item_url": "https://artist.bandcamp.com/album/real-lp",
                    "token": "good-token",
                },
            ]
        },
        relation_type="collection",
    )

    assert next_token == "good-token"
    assert len(entries) == 1
    assert entries[0]["item"]["album_title"] == "Real LP"


def test_bandcamp_web_parses_followers_with_url_hints():
    from crate.bandcamp.web import parse_fancollection_page

    entries, next_token = parse_fancollection_page(
        {
            "followeers": [
                {
                    "band_id": 101,
                    "name": "Followed Artist",
                    "date_followed": "2026-07-15T21:46:07Z",
                    "url_hints": {
                        "subdomain": "followed-artist",
                        "custom_domain": None,
                    },
                    "token": "following-token",
                }
            ],
            "last_token": "following-token",
            "more_available": False,
        },
        relation_type="following",
    )

    assert next_token == "following-token"
    assert entries[0]["item"]["band_id"] == 101
    assert entries[0]["item"]["artist_name"] == "Followed Artist"
    assert entries[0]["item"]["item_url"] == "https://followed-artist.bandcamp.com"
    assert entries[0]["item"]["artist_url"] == "https://followed-artist.bandcamp.com"


def test_bandcamp_web_paginates_following_bands_without_duplicates(monkeypatch):
    from crate.bandcamp.models import BandcampFanIdentity, BandcampSessionMaterial
    from crate.bandcamp.web import BandcampWebClient

    class FakeResponse:
        status_code = 200

        def __init__(self, payload):
            self._payload = payload

        def json(self):
            return self._payload

    pages = iter(
        [
            FakeResponse(
                {
                    "followeers": [
                        {
                            "band_id": 101,
                            "name": "First Artist",
                            "url_hints": {"subdomain": "first-artist"},
                            "token": "page-one",
                        },
                        {
                            "band_id": 102,
                            "name": "Second Artist",
                            "url_hints": {"subdomain": "second-artist"},
                            "token": "page-one",
                        },
                    ],
                    "more_available": True,
                }
            ),
            FakeResponse(
                {
                    "followeers": [
                        {
                            "band_id": 102,
                            "name": "Second Artist",
                            "url_hints": {"subdomain": "second-artist"},
                            "token": "page-two",
                        },
                        {
                            "band_id": 103,
                            "name": "Third Artist",
                            "url_hints": {"subdomain": "third-artist"},
                            "token": "page-two",
                        },
                    ],
                    "more_available": False,
                }
            ),
        ]
    )
    client = BandcampWebClient(
        BandcampSessionMaterial(
            cookies={"identity": "cookie"},
            profile=BandcampFanIdentity(username="fan", fan_id=456),
        )
    )
    monkeypatch.setattr(client.session, "post", lambda *args, **kwargs: next(pages))

    payload = client.sync_collection_payload(
        include=["following"], page_size=100, max_pages=3
    )

    assert [entry["item"]["band_id"] for entry in payload["following"]] == [
        101,
        102,
        103,
    ]


def test_bandcamp_web_resolves_pagedata_and_stat_download_url():
    from crate.bandcamp.web import (
        resolve_download_url_from_pagedata,
        resolve_stat_download_url,
    )

    page_blob = {
        "digital_items": [
            {
                "item_id": 101,
                "downloads": {
                    "flac": {
                        "url": "https://bandcamp.com/download/foo?encoding=flac",
                    }
                },
            }
        ]
    }
    html = (
        '<html><body><div id="pagedata" data-blob="'
        + json.dumps(page_blob).replace('"', "&quot;")
        + '"></div></body></html>'
    )

    download_url = resolve_download_url_from_pagedata(
        html,
        item={"bandcamp_item_id": 101},
        requested_format="flac",
    )
    assert download_url == "https://bandcamp.com/download/foo?encoding=flac"
    assert (
        resolve_stat_download_url(
            '{"download_url":"https:\\/\\/bcbits.com\\/archive.zip"}',
            fallback="https://bandcamp.com/download/foo",
        )
        == "https://bcbits.com/archive.zip"
    )


def test_bandcamp_search_parser_extracts_artist_and_album_results():
    from crate.bandcamp.search import (
        find_exact_album_url,
        find_exact_artist_url,
        parse_bandcamp_search_results,
    )

    html = """
    <li class="searchresult">
      <div class="itemtype">ARTIST</div>
      <div class="heading"><a href="https://slowthai.bandcamp.com">slowthai</a></div>
    </li>
    <li class="searchresult">
      <div class="itemtype">ALBUM</div>
      <div class="heading"><a href="https://artist.bandcamp.com/album/lp">LP</a></div>
      <div class="subhead">by Artist</div>
    </li>
    """
    results = parse_bandcamp_search_results(html)

    assert results[0].url == "https://slowthai.bandcamp.com"
    assert results[1].artist == "by Artist"
    assert (
        find_exact_artist_url("slowthai", search_fn=lambda *_a, **_k: results)
        == "https://slowthai.bandcamp.com"
    )
    assert (
        find_exact_album_url("Artist", "LP", search_fn=lambda *_a, **_k: results)
        == "https://artist.bandcamp.com/album/lp"
    )


def test_bandcamp_direct_probe_resolves_artist_and_album_urls(monkeypatch):
    from crate.bandcamp import search as bandcamp_search

    class Response:
        status_code = 200

        def __init__(self, url: str, text: str):
            self.url = url
            self.text = text

    def fake_get(url: str, **_kwargs):
        if url == "https://highvis.bandcamp.com":
            return Response(
                "https://highvis.bandcamp.com/",
                """
                <html><head>
                  <title>Merch | High Vis</title>
                  <meta property="og:site_name" content="High Vis" />
                </head></html>
                """,
            )
        if url == "https://highvis.bandcamp.com/album/blending":
            return Response(
                url,
                """
                <html><head>
                  <title>Blending | High Vis</title>
                  <meta property="og:title" content="Blending, by High Vis" />
                  <meta property="og:site_name" content="High Vis" />
                </head></html>
                """,
            )
        if url == "https://convergecult.bandcamp.com":
            return Response(
                "https://convergecult.bandcamp.com/album/hum-of-hurt",
                """
                <html><head>
                  <title>Hum of Hurt | Converge</title>
                  <meta property="og:site_name" content="Converge" />
                </head></html>
                """,
            )
        if url == "https://convergecult.bandcamp.com/album/you-fail-me":
            return Response(
                url,
                """
                <html><head>
                  <title>You Fail Me | Converge</title>
                  <meta property="og:title" content="You Fail Me, by Converge" />
                  <meta property="og:site_name" content="Converge" />
                </head></html>
                """,
            )
        response = Response(url, "")
        response.status_code = 404
        return response

    monkeypatch.setattr(bandcamp_search.requests, "get", fake_get)

    assert (
        bandcamp_search.find_exact_artist_url("High Vis", allow_search=False)
        == "https://highvis.bandcamp.com"
    )
    assert (
        bandcamp_search.find_exact_album_url(
            "High Vis",
            "Blending",
            allow_search=False,
        )
        == "https://highvis.bandcamp.com/album/blending"
    )
    assert (
        bandcamp_search.find_exact_artist_url("Converge", allow_search=False)
        == "https://convergecult.bandcamp.com"
    )
    assert (
        bandcamp_search.find_exact_album_url(
            "Converge",
            "You Fail Me",
            allow_search=False,
        )
        == "https://convergecult.bandcamp.com/album/you-fail-me"
    )


def test_bandcamp_search_reports_client_challenge(monkeypatch):
    from crate.bandcamp import search as bandcamp_search

    class Response:
        status_code = 200
        text = "<html><head><title>Client Challenge</title></head></html>"

    monkeypatch.setattr(
        bandcamp_search.requests,
        "get",
        lambda *_a, **_k: Response(),
    )

    with pytest.raises(bandcamp_search.BandcampSearchError):
        bandcamp_search.search_bandcamp("High Vis")


def test_bandcamp_credential_worker_stores_connection(pg_db, monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret-key-1234-12345678901234")
    monkeypatch.setenv("CRATE_BANDCAMP_WEB_CREDENTIAL_BRIDGE_ENABLED", "true")

    from crate.bandcamp.credentials import store_secret
    from crate.bandcamp.models import (
        BandcampCredentialLoginResult,
        BandcampFanIdentity,
        BandcampSessionMaterial,
    )
    from crate.db.repositories.bandcamp import (
        create_pairing_challenge,
        get_connection_for_user,
        get_pairing_challenge,
    )
    from crate.worker_handlers import bandcamp as worker_bandcamp

    challenge = create_pairing_challenge(
        user_id=1,
        connection_method="web_credential_bridge",
    )
    credential_ref = store_secret(
        "bandcamp_web_credentials",
        {
            "email": "fan@example.com",
            "password": "super-secret",
            "remember_password": False,
        },
    )

    session_material = BandcampSessionMaterial(
        cookies={"identity": "cookie-value"},
        profile=BandcampFanIdentity(
            username="fan",
            fan_id=456,
            display_name="Fan User",
            image_url="https://bandcamp.com/fan.jpg",
        ),
    )

    monkeypatch.setattr(
        worker_bandcamp,
        "login_with_credentials",
        lambda **kwargs: BandcampCredentialLoginResult(
            status="connected",
            session=session_material,
        ),
    )
    monkeypatch.setattr(worker_bandcamp, "emit_task_event", lambda *a, **k: None)
    monkeypatch.setattr(worker_bandcamp, "emit_progress", lambda *a, **k: None)

    result = worker_bandcamp._handle_bandcamp_connect_credentials(
        "task-1",
        {
            "user_id": 1,
            "pairing_id": challenge["pairing_id"],
            "credential_secret_ref": credential_ref,
        },
        {},
    )

    assert result == {"connected": True, "username": "fan"}
    connection = get_connection_for_user(1)
    assert connection
    assert connection["username"] == "fan"
    assert connection["connection_method"] == "web_credential_bridge"
    assert get_pairing_challenge(challenge["pairing_id"])["status"] == "connected"


def test_bandcamp_sync_worker_persists_collection(pg_db, monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret-key-1234-12345678901234")

    from crate.bandcamp.collection_sync import (
        BandcampCollectionSyncResult,
        BandcampSyncedItem,
    )
    from crate.bandcamp.credentials import fingerprint_secret, store_secret
    from crate.db.repositories.bandcamp import (
        list_user_collection,
        upsert_connection,
    )
    from crate.worker_handlers import bandcamp as worker_bandcamp

    session_ref = store_secret(
        "bandcamp_session",
        {
            "cookies": {"identity": "cookie-value"},
            "profile": {"username": "fan", "fan_id": 456},
        },
    )
    connection = upsert_connection(
        user_id=1,
        session_secret_ref=session_ref,
        session_fingerprint=fingerprint_secret(
            {"cookies": {"identity": "cookie-value"}}
        ),
        connection_method="manual_dev",
        username="fan",
        fan_id=456,
    )

    monkeypatch.setattr(worker_bandcamp, "emit_task_event", lambda *a, **k: None)
    monkeypatch.setattr(worker_bandcamp, "emit_progress", lambda *a, **k: None)
    queued_tasks = []
    monkeypatch.setattr(
        worker_bandcamp,
        "create_task",
        lambda task_type, params, **kwargs: (
            queued_tasks.append((task_type, params, kwargs)) or "bandcamp-import-task"
        ),
    )
    monkeypatch.setattr(
        worker_bandcamp,
        "sync_collection_with_command",
        lambda *_args, **_kwargs: BandcampCollectionSyncResult(
            items=(
                BandcampSyncedItem(
                    relation_type="collection",
                    item={
                        "item_url": "https://artist.bandcamp.com/album/lp",
                        "bandcamp_item_type": "album",
                        "artist_name": "Artist",
                        "album_title": "LP",
                        "cover_url": "https://f4.bcbits.com/img/a.jpg",
                        "release_date": "2026-05-17",
                        "tags": ["screamo"],
                    },
                    owned=True,
                    downloadable=True,
                ),
            ),
        ),
    )

    result = worker_bandcamp._handle_bandcamp_sync_collection(
        "task-sync-1",
        {
            "user_id": 1,
            "connection_id": connection["id"],
            "include": ["collection"],
        },
        {},
    )

    assert result["counts"] == {"collection": 1}
    assert result["imports_queued"] == 1
    assert queued_tasks[0][0] == "bandcamp_import_purchase"
    collection = list_user_collection(1, "collection")
    assert len(collection) == 1
    assert collection[0]["artist_name"] == "Artist"
    assert collection[0]["album_title"] == "LP"


def test_bandcamp_sync_skips_import_when_album_already_exists(pg_db, monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret-key-1234-12345678901234")

    from crate.bandcamp.collection_sync import (
        BandcampCollectionSyncResult,
        BandcampSyncedItem,
    )
    from crate.bandcamp.credentials import fingerprint_secret, store_secret
    from crate.db.repositories.bandcamp import upsert_connection
    from crate.worker_handlers import bandcamp as worker_bandcamp

    pg_db.upsert_artist({"name": "Artist"})
    pg_db.upsert_album(
        {
            "artist": "Artist",
            "name": "LP",
            "path": "/music/Artist/LP",
            "track_count": 0,
            "total_size": 0,
            "total_duration": 0,
            "formats": [],
        }
    )

    session_ref = store_secret(
        "bandcamp_session",
        {
            "cookies": {"identity": "cookie-value"},
            "profile": {"username": "fan", "fan_id": 456},
        },
    )
    connection = upsert_connection(
        user_id=1,
        session_secret_ref=session_ref,
        session_fingerprint=fingerprint_secret(
            {"cookies": {"identity": "cookie-value"}}
        ),
        connection_method="manual_dev",
        username="fan",
        fan_id=456,
    )

    monkeypatch.setattr(worker_bandcamp, "emit_task_event", lambda *a, **k: None)
    monkeypatch.setattr(worker_bandcamp, "emit_progress", lambda *a, **k: None)
    queued_tasks = []
    monkeypatch.setattr(
        worker_bandcamp,
        "create_task",
        lambda task_type, params, **kwargs: (
            queued_tasks.append((task_type, params, kwargs)) or "bandcamp-import-task"
        ),
    )
    monkeypatch.setattr(
        worker_bandcamp,
        "sync_collection_with_command",
        lambda *_args, **_kwargs: BandcampCollectionSyncResult(
            items=(
                BandcampSyncedItem(
                    relation_type="collection",
                    item={
                        "item_url": "https://artist.bandcamp.com/album/lp",
                        "bandcamp_item_type": "album",
                        "artist_name": "Artist",
                        "album_title": "LP",
                    },
                    owned=True,
                    downloadable=True,
                ),
            ),
        ),
    )

    result = worker_bandcamp._handle_bandcamp_sync_collection(
        "task-sync-1",
        {
            "user_id": 1,
            "connection_id": connection["id"],
            "include": ["collection"],
        },
        {},
    )

    assert result["counts"] == {"collection": 1}
    assert result["imports_queued"] == 0
    assert result["imports_skipped_existing"] == 1
    assert queued_tasks == []


def test_bandcamp_sync_skips_import_when_another_user_is_importing(pg_db, monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret-key-1234-12345678901234")

    from crate.bandcamp.collection_sync import (
        BandcampCollectionSyncResult,
        BandcampSyncedItem,
    )
    from crate.bandcamp.credentials import fingerprint_secret, store_secret
    from crate.db.repositories.bandcamp import (
        create_bandcamp_import,
        upsert_bandcamp_item,
        upsert_connection,
    )
    from crate.db.tx import transaction_scope
    from crate.worker_handlers import bandcamp as worker_bandcamp

    with transaction_scope() as session:
        session.execute(
            text("""
            INSERT INTO users (email, username, name, role, created_at)
            VALUES ('bandcamp-second-user@example.com', 'bandcamp-second', 'Second', 'user', NOW())
            ON CONFLICT (email) DO NOTHING
            """)
        )

    item = upsert_bandcamp_item(
        {
            "item_url": "https://artist.bandcamp.com/album/lp",
            "bandcamp_item_type": "album",
            "artist_name": "Artist",
            "album_title": "LP",
        }
    )
    first_session_ref = store_secret(
        "bandcamp_session",
        {
            "cookies": {"identity": "first-cookie"},
            "profile": {"username": "first", "fan_id": 456},
        },
    )
    first_connection = upsert_connection(
        user_id=2,
        session_secret_ref=first_session_ref,
        session_fingerprint=fingerprint_secret(
            {"cookies": {"identity": "first-cookie"}}
        ),
        connection_method="manual_dev",
        username="first",
        fan_id=456,
    )
    create_bandcamp_import(
        user_id=2,
        connection_id=first_connection["id"],
        bandcamp_item_id=item["id"],
    )

    second_session_ref = store_secret(
        "bandcamp_session",
        {
            "cookies": {"identity": "second-cookie"},
            "profile": {"username": "second", "fan_id": 789},
        },
    )
    second_connection = upsert_connection(
        user_id=1,
        session_secret_ref=second_session_ref,
        session_fingerprint=fingerprint_secret(
            {"cookies": {"identity": "second-cookie"}}
        ),
        connection_method="manual_dev",
        username="second",
        fan_id=789,
    )

    monkeypatch.setattr(worker_bandcamp, "emit_task_event", lambda *a, **k: None)
    monkeypatch.setattr(worker_bandcamp, "emit_progress", lambda *a, **k: None)
    queued_tasks = []
    monkeypatch.setattr(
        worker_bandcamp,
        "create_task",
        lambda task_type, params, **kwargs: (
            queued_tasks.append((task_type, params, kwargs)) or "bandcamp-import-task"
        ),
    )
    monkeypatch.setattr(
        worker_bandcamp,
        "sync_collection_with_command",
        lambda *_args, **_kwargs: BandcampCollectionSyncResult(
            items=(
                BandcampSyncedItem(
                    relation_type="collection",
                    item={
                        "item_url": "https://artist.bandcamp.com/album/lp",
                        "bandcamp_item_type": "album",
                        "artist_name": "Artist",
                        "album_title": "LP",
                    },
                    owned=True,
                    downloadable=True,
                ),
            ),
        ),
    )

    result = worker_bandcamp._handle_bandcamp_sync_collection(
        "task-sync-1",
        {
            "user_id": 1,
            "connection_id": second_connection["id"],
            "include": ["collection"],
        },
        {},
    )

    assert result["imports_queued"] == 0
    assert queued_tasks == []


def test_admin_bandcamp_collection_lists_synced_purchases(
    bandcamp_api_client, monkeypatch
):
    monkeypatch.setenv("JWT_SECRET", "test-secret-key-1234-12345678901234")

    from crate.bandcamp.credentials import fingerprint_secret, store_secret
    from crate.db.repositories.bandcamp import (
        upsert_bandcamp_item,
        upsert_connection,
        upsert_user_bandcamp_item,
    )

    session_ref = store_secret(
        "bandcamp_session",
        {
            "cookies": {"identity": "cookie-value"},
            "profile": {"username": "fan", "fan_id": 456},
        },
    )
    connection = upsert_connection(
        user_id=1,
        session_secret_ref=session_ref,
        session_fingerprint=fingerprint_secret(
            {"cookies": {"identity": "cookie-value"}}
        ),
        connection_method="manual_dev",
        username="fan",
        fan_id=456,
    )
    item = upsert_bandcamp_item(
        {
            "item_url": "https://artist.bandcamp.com/album/lp",
            "bandcamp_item_type": "album",
            "artist_name": "Artist",
            "album_title": "LP",
            "cover_url": "https://f4.bcbits.com/img/a.jpg",
        }
    )
    upsert_user_bandcamp_item(
        user_id=1,
        connection_id=connection["id"],
        bandcamp_item_id=item["id"],
        relation_type="collection",
        owned=True,
        downloadable=True,
    )

    response = bandcamp_api_client.get(
        "/api/bandcamp/admin/collection?relation_type=collection"
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] >= 1
    assert payload["items"][0]["album_title"] == "LP"
    assert payload["items"][0]["user_email"] == "admin@cratemusic.app"


def test_bandcamp_import_requires_owned_downloadable_item(bandcamp_api_client):
    response = bandcamp_api_client.post(
        "/api/bandcamp/me/imports",
        json={"bandcamp_item_id": 999999, "format": "flac"},
    )

    assert response.status_code == 404


def test_bandcamp_import_endpoint_queues_owned_item(bandcamp_api_client, monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret-key-1234-12345678901234")

    from crate.bandcamp.credentials import fingerprint_secret, store_secret
    from crate.db.repositories.bandcamp import (
        upsert_bandcamp_item,
        upsert_connection,
        upsert_user_bandcamp_item,
    )

    session_ref = store_secret(
        "bandcamp_session",
        {
            "cookies": {"identity": "cookie-value"},
            "profile": {"username": "fan", "fan_id": 456},
        },
    )
    connection = upsert_connection(
        user_id=1,
        session_secret_ref=session_ref,
        session_fingerprint=fingerprint_secret(
            {"cookies": {"identity": "cookie-value"}}
        ),
        connection_method="manual_dev",
        username="fan",
        fan_id=456,
    )
    item = upsert_bandcamp_item(
        {
            "item_url": "https://artist.bandcamp.com/album/import-me",
            "bandcamp_item_type": "album",
            "artist_name": "Artist",
            "album_title": "Import Me",
        }
    )
    upsert_user_bandcamp_item(
        user_id=1,
        connection_id=connection["id"],
        bandcamp_item_id=item["id"],
        relation_type="collection",
        owned=True,
        downloadable=True,
    )

    response = bandcamp_api_client.post(
        "/api/bandcamp/me/imports",
        json={"bandcamp_item_id": item["id"], "format": "flac"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_id"]
    assert payload["import_id"]

    collection_response = bandcamp_api_client.get("/api/bandcamp/me/collection")
    assert collection_response.status_code == 200
    collection_payload = collection_response.json()
    imported_item = next(
        collection_item
        for collection_item in collection_payload["items"]
        if collection_item["bandcamp_item_id"] == item["id"]
    )
    assert imported_item["latest_import_status"] == "queued"
    assert imported_item["latest_import_id"] == payload["import_id"]


def test_bandcamp_import_worker_downloads_and_reuses_upload_import(pg_db, monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret-key-1234-12345678901234")
    monkeypatch.setenv("DATA_DIR", tempfile.mkdtemp(prefix="crate_bandcamp_import_"))

    from pathlib import Path

    from crate.bandcamp.credentials import fingerprint_secret, store_secret
    from crate.bandcamp.downloads import BandcampDownloadResult
    from crate.db.repositories.bandcamp import (
        create_bandcamp_import,
        get_bandcamp_import,
        upsert_bandcamp_item,
        upsert_connection,
        upsert_user_bandcamp_item,
    )
    from crate.worker_handlers import acquisition as worker_acquisition
    from crate.worker_handlers import bandcamp as worker_bandcamp

    session_ref = store_secret(
        "bandcamp_session",
        {
            "cookies": {"identity": "cookie-value"},
            "profile": {"username": "fan", "fan_id": 456},
        },
    )
    connection = upsert_connection(
        user_id=1,
        session_secret_ref=session_ref,
        session_fingerprint=fingerprint_secret(
            {"cookies": {"identity": "cookie-value"}}
        ),
        connection_method="manual_dev",
        username="fan",
        fan_id=456,
    )
    item = upsert_bandcamp_item(
        {
            "item_url": "https://artist.bandcamp.com/album/import-worker",
            "bandcamp_item_type": "album",
            "artist_name": "Artist",
            "album_title": "Import Worker",
        }
    )
    upsert_user_bandcamp_item(
        user_id=1,
        connection_id=connection["id"],
        bandcamp_item_id=item["id"],
        relation_type="collection",
        owned=True,
        downloadable=True,
    )
    import_row = create_bandcamp_import(
        user_id=1,
        connection_id=connection["id"],
        bandcamp_item_id=item["id"],
    )

    def _fake_download(*_args, **kwargs):
        archive = Path(kwargs["output_dir"]) / "import-worker.zip"
        archive.write_bytes(b"zip")
        return BandcampDownloadResult(archive_paths=(archive,))

    monkeypatch.setattr(
        worker_bandcamp, "download_purchase_with_command", _fake_download
    )
    monkeypatch.setattr(worker_bandcamp, "emit_task_event", lambda *a, **k: None)
    monkeypatch.setattr(worker_bandcamp, "emit_progress", lambda *a, **k: None)
    monkeypatch.setattr(
        worker_acquisition,
        "_handle_library_upload",
        lambda *_a, **_k: {"success": True, "albums_imported": 1},
    )

    result = worker_bandcamp._handle_bandcamp_import_purchase(
        "task-import-1",
        {
            "user_id": 1,
            "connection_id": connection["id"],
            "bandcamp_import_id": import_row["id"],
            "bandcamp_item_id": item["id"],
            "format": "flac",
        },
        {},
    )

    assert result["success"] is True
    assert result["downloaded_archives"] == 1
    assert get_bandcamp_import(import_row["id"])["status"] == "completed"


def test_bandcamp_import_worker_skips_existing_library_album(pg_db, monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret-key-1234-12345678901234")
    monkeypatch.setenv("DATA_DIR", tempfile.mkdtemp(prefix="crate_bandcamp_import_"))

    from crate.bandcamp.credentials import fingerprint_secret, store_secret
    from crate.db.repositories.bandcamp import (
        create_bandcamp_import,
        get_bandcamp_import,
        upsert_bandcamp_item,
        upsert_connection,
        upsert_user_bandcamp_item,
    )
    from crate.worker_handlers import bandcamp as worker_bandcamp

    pg_db.upsert_artist({"name": "Artist"})
    pg_db.upsert_album(
        {
            "artist": "Artist",
            "name": "Import Worker",
            "path": "/music/Artist/Import Worker",
            "track_count": 0,
            "total_size": 0,
            "total_duration": 0,
            "formats": [],
        }
    )

    session_ref = store_secret(
        "bandcamp_session",
        {
            "cookies": {"identity": "cookie-value"},
            "profile": {"username": "fan", "fan_id": 456},
        },
    )
    connection = upsert_connection(
        user_id=1,
        session_secret_ref=session_ref,
        session_fingerprint=fingerprint_secret(
            {"cookies": {"identity": "cookie-value"}}
        ),
        connection_method="manual_dev",
        username="fan",
        fan_id=456,
    )
    item = upsert_bandcamp_item(
        {
            "item_url": "https://artist.bandcamp.com/album/import-worker",
            "bandcamp_item_type": "album",
            "artist_name": "Artist",
            "album_title": "Import Worker",
        }
    )
    upsert_user_bandcamp_item(
        user_id=1,
        connection_id=connection["id"],
        bandcamp_item_id=item["id"],
        relation_type="collection",
        owned=True,
        downloadable=True,
    )
    import_row = create_bandcamp_import(
        user_id=1,
        connection_id=connection["id"],
        bandcamp_item_id=item["id"],
    )

    download_called = False

    def _fake_download(*_args, **_kwargs):
        nonlocal download_called
        download_called = True
        raise AssertionError("download should not run for existing library albums")

    monkeypatch.setattr(
        worker_bandcamp, "download_purchase_with_command", _fake_download
    )
    monkeypatch.setattr(worker_bandcamp, "emit_task_event", lambda *a, **k: None)
    monkeypatch.setattr(worker_bandcamp, "emit_progress", lambda *a, **k: None)

    result = worker_bandcamp._handle_bandcamp_import_purchase(
        "task-import-1",
        {
            "user_id": 1,
            "connection_id": connection["id"],
            "bandcamp_import_id": import_row["id"],
            "bandcamp_item_id": item["id"],
            "format": "flac",
        },
        {},
    )

    assert result["skipped"] is True
    assert download_called is False
    assert get_bandcamp_import(import_row["id"])["status"] == "skipped"


def test_bandcamp_withdraw_contribution_marks_withdrawn_and_deletes_album(
    pg_db, monkeypatch
):
    from crate.db.repositories.bandcamp import (
        create_bandcamp_import,
        get_bandcamp_import,
        upsert_bandcamp_item,
        upsert_connection,
    )
    from crate.db.repositories.library_contributions import (
        get_user_album_contribution,
        record_album_contribution,
    )
    from crate.worker_handlers import contributions as worker_contributions

    pg_db.upsert_artist({"name": "Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Artist",
            "name": "Import Worker",
            "path": "/music/Artist/Import Worker",
            "track_count": 0,
            "total_size": 0,
            "total_duration": 0,
            "formats": [],
        }
    )
    item = upsert_bandcamp_item(
        {
            "item_url": "https://artist.bandcamp.com/album/import-worker",
            "bandcamp_item_type": "album",
            "artist_name": "Artist",
            "album_title": "Import Worker",
        }
    )
    connection = upsert_connection(
        user_id=1,
        session_secret_ref="secret",
        session_fingerprint="fingerprint",
        connection_method="manual_dev",
        username="fan",
    )
    import_row = create_bandcamp_import(
        user_id=1,
        connection_id=connection["id"],
        bandcamp_item_id=item["id"],
    )
    contribution = record_album_contribution(
        user_id=1,
        source="bandcamp",
        source_ref=f"bandcamp:{item['id']}",
        album_id=album_id,
        album_entity_uid=None,
        artist_name="Artist",
        album_name="Import Worker",
    )

    deleted_albums = []
    monkeypatch.setattr(worker_contributions, "emit_task_event", lambda *a, **k: None)
    monkeypatch.setattr(worker_contributions, "emit_progress", lambda *a, **k: None)
    monkeypatch.setattr(
        worker_contributions,
        "_delete_library_album_for_withdrawal",
        lambda task_id, contribution, config, **kwargs: (
            deleted_albums.append(contribution["album_id"]) or {"deleted": True}
        ),
    )

    result = worker_contributions._handle_library_withdraw_contribution(
        "task-withdraw-1",
        {"user_id": 1, "contribution_id": contribution["id"]},
        {},
    )

    assert result["withdrawn"] is True
    assert deleted_albums == [album_id]
    assert (
        get_user_album_contribution(
            user_id=1, contribution_id=contribution["id"], source="bandcamp"
        )["status"]
        == "withdrawn"
    )
    assert get_bandcamp_import(import_row["id"])["status"] == "withdrawn"


def test_bandcamp_withdraw_endpoint_queues_worker_task(
    bandcamp_api_client, pg_db, monkeypatch
):
    from crate.db.repositories.library_contributions import record_album_contribution

    pg_db.upsert_artist({"name": "Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Artist",
            "name": "Import Worker",
            "path": "/music/Artist/Import Worker",
            "track_count": 0,
            "total_size": 0,
            "total_duration": 0,
            "formats": [],
        }
    )
    contribution = record_album_contribution(
        user_id=1,
        source="bandcamp",
        source_ref="bandcamp:123",
        album_id=album_id,
        album_entity_uid=None,
        artist_name="Artist",
        album_name="Import Worker",
    )
    queued = []
    monkeypatch.setattr(
        "crate.api.bandcamp.create_task",
        lambda task_type, params: queued.append((task_type, params)) or "task-1",
    )

    response = bandcamp_api_client.post(
        f"/api/bandcamp/me/contributions/{contribution['id']}/withdraw"
    )

    assert response.status_code == 200
    assert response.json()["task_id"] == "task-1"
    assert queued == [
        (
            "library_withdraw_contribution",
            {"user_id": 1, "contribution_id": contribution["id"]},
        )
    ]


def test_me_withdraw_contribution_endpoint_queues_worker_task(
    bandcamp_api_client, pg_db, monkeypatch
):
    from crate.db.repositories.library_contributions import record_album_contribution

    pg_db.upsert_artist({"name": "Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Artist",
            "name": "Uploaded Worker",
            "path": "/music/Artist/Uploaded Worker",
            "track_count": 0,
            "total_size": 0,
            "total_duration": 0,
            "formats": [],
        }
    )
    contribution = record_album_contribution(
        user_id=1,
        source="listen_upload",
        source_ref="task-upload-1:123",
        album_id=album_id,
        album_entity_uid=None,
        artist_name="Artist",
        album_name="Uploaded Worker",
    )
    queued = []
    monkeypatch.setattr(
        "crate.api.me.create_task",
        lambda task_type, params: queued.append((task_type, params)) or "task-1",
    )

    response = bandcamp_api_client.post(
        f"/api/me/contributions/{contribution['id']}/withdraw"
    )

    assert response.status_code == 200
    assert response.json()["task_id"] == "task-1"
    assert queued == [
        (
            "library_withdraw_contribution",
            {"user_id": 1, "contribution_id": contribution["id"]},
        )
    ]


def test_bandcamp_match_endpoint_exposes_confirmed_artist_link(bandcamp_api_client):
    from crate.db.repositories.bandcamp import upsert_bandcamp_item

    item = upsert_bandcamp_item(
        {
            "item_url": "https://artist.bandcamp.com",
            "bandcamp_item_type": "artist",
            "artist_name": "Artist",
            "artist_url": "https://artist.bandcamp.com",
        }
    )
    entity_uid = str(uuid.uuid4())

    match_response = bandcamp_api_client.post(
        "/api/bandcamp/admin/matches",
        json={
            "bandcamp_item_id": item["id"],
            "entity_type": "artist",
            "entity_uid": entity_uid,
            "confidence": 1.0,
            "status": "confirmed",
            "source": "test",
        },
    )

    assert match_response.status_code == 200

    link_response = bandcamp_api_client.get(
        f"/api/bandcamp/links/artist/by-entity/{entity_uid}"
    )

    assert link_response.status_code == 200
    payload = link_response.json()
    assert payload["item_url"] == "https://artist.bandcamp.com"
    assert payload["match_status"] == "confirmed"

    list_response = bandcamp_api_client.get("/api/bandcamp/admin/matches")
    assert list_response.status_code == 200
    listed = list_response.json()["items"]
    assert any(row["bandcamp_item_id"] == item["id"] for row in listed)


def test_bandcamp_link_uses_persisted_artist_and_album_urls(pg_db):
    from crate.db.repositories.bandcamp import get_bandcamp_link_for_entity
    from crate.db.tx import transaction_scope

    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    artist_name = f"Persisted Bandcamp Artist {uuid.uuid4().hex[:6]}"
    with transaction_scope() as session:
        session.execute(
            text("""
            INSERT INTO library_artists (
                id, entity_uid, name, album_count, track_count, total_size,
                has_photo, bandcamp_url, bandcamp_url_source
            )
            VALUES (
                :id, CAST(:artist_uid AS uuid), :artist, 1, 10, 0, 0,
                'https://persistedartist.bandcamp.com', 'bandcamp:test'
            )
            """),
            {
                "id": 900000 + int(uuid.uuid4().hex[:5], 16),
                "artist_uid": artist_uid,
                "artist": artist_name,
            },
        )
        session.execute(
            text("""
            INSERT INTO library_albums (
                entity_uid, artist, name, path, track_count, total_size,
                total_duration, has_cover, bandcamp_url, bandcamp_url_source
            )
            VALUES (
                CAST(:album_uid AS uuid), :artist, :album, :path, 10, 0,
                0, 0, 'https://persistedartist.bandcamp.com/album/lp',
                'bandcamp:test'
            )
            """),
            {
                "album_uid": album_uid,
                "artist": artist_name,
                "album": "Persisted LP",
                "path": f"/music/{uuid.uuid4().hex}",
            },
        )

    artist_link = get_bandcamp_link_for_entity(
        entity_type="artist",
        entity_uid=artist_uid,
    )
    album_link = get_bandcamp_link_for_entity(
        entity_type="album",
        entity_uid=album_uid,
    )

    assert artist_link["artist_url"] == "https://persistedartist.bandcamp.com"
    assert artist_link["link_source"] == "entity_url"
    assert album_link["album_url"] == "https://persistedartist.bandcamp.com/album/lp"
    assert album_link["link_source"] == "entity_url"


def test_bandcamp_manual_confirm_persists_artist_url(pg_db):
    artist_uid = str(uuid.uuid4())
    artist_name = f"Manual Bandcamp Artist {uuid.uuid4().hex[:6]}"

    from crate.db.repositories.bandcamp import (
        set_bandcamp_library_match_status,
        upsert_bandcamp_item,
        upsert_bandcamp_library_match,
    )
    from crate.db.tx import read_scope, transaction_scope

    with transaction_scope() as session:
        session.execute(
            text("""
            INSERT INTO library_artists (
                id, entity_uid, name, album_count, track_count, total_size, has_photo
            )
            VALUES (
                :id, CAST(:entity_uid AS uuid), :name, 0, 0, 0, 0
            )
            """),
            {
                "id": 900000 + int(uuid.uuid4().hex[:5], 16),
                "entity_uid": artist_uid,
                "name": artist_name,
            },
        )
        item = upsert_bandcamp_item(
            {
                "item_url": "https://manualartist.bandcamp.com",
                "bandcamp_item_type": "artist",
                "artist_name": artist_name,
                "artist_url": "https://manualartist.bandcamp.com",
            },
            session=session,
        )
        match = upsert_bandcamp_library_match(
            bandcamp_item_id=item["id"],
            entity_type="artist",
            entity_uid=artist_uid,
            confidence=0.7,
            status="candidate",
            source="manual",
            session=session,
        )
        set_bandcamp_library_match_status(
            match["id"], status="confirmed", session=session
        )

    with read_scope() as session:
        row = (
            session.execute(
                text("""
                SELECT bandcamp_url, bandcamp_url_source
                FROM library_artists
                WHERE entity_uid = CAST(:entity_uid AS uuid)
                """),
                {"entity_uid": artist_uid},
            )
            .mappings()
            .one()
        )

    assert row["bandcamp_url"] == "https://manualartist.bandcamp.com"
    assert row["bandcamp_url_source"] == "bandcamp:manual"


def test_bandcamp_matcher_confirms_exact_artist_album(pg_db):
    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    artist_name = f"Bandcamp Match Artist {uuid.uuid4().hex[:6]}"
    album_name = "Exact LP"

    from crate.bandcamp.matcher import create_matches_for_bandcamp_item
    from crate.db.repositories.bandcamp import (
        get_bandcamp_link_for_entity,
        upsert_bandcamp_item,
    )
    from crate.db.tx import read_scope, transaction_scope

    with transaction_scope() as session:
        session.execute(
            text("""
            INSERT INTO library_artists (
                id, entity_uid, name, album_count, track_count, total_size, has_photo
            )
            VALUES (
                :id, CAST(:entity_uid AS uuid), :name, 1, 10, 0, 0
            )
            """),
            {
                "id": 900000 + int(uuid.uuid4().hex[:5], 16),
                "entity_uid": artist_uid,
                "name": artist_name,
            },
        )
        session.execute(
            text("""
            INSERT INTO library_albums (
                entity_uid, artist, name, path, track_count, total_size,
                total_duration, has_cover
            )
            VALUES (
                CAST(:entity_uid AS uuid), :artist, :name, :path, 10, 0, 0, 0
            )
            """),
            {
                "entity_uid": album_uid,
                "artist": artist_name,
                "name": album_name,
                "path": f"/music/{uuid.uuid4().hex}",
            },
        )
        item = upsert_bandcamp_item(
            {
                "item_url": "https://matchartist.bandcamp.com/album/exact-lp",
                "bandcamp_item_type": "album",
                "artist_name": artist_name,
                "album_title": album_name,
            },
            session=session,
        )
        matches = create_matches_for_bandcamp_item(item["id"], session=session)

    assert {match["entity_type"] for match in matches} == {"artist", "album"}
    album_link = get_bandcamp_link_for_entity(
        entity_type="album",
        entity_uid=album_uid,
    )
    assert album_link
    assert album_link["item_url"] == "https://matchartist.bandcamp.com/album/exact-lp"

    with read_scope() as session:
        artist_bandcamp = (
            session.execute(
                text("""
                SELECT bandcamp_url, bandcamp_url_source
                FROM library_artists
                WHERE entity_uid = CAST(:entity_uid AS uuid)
                """),
                {"entity_uid": artist_uid},
            )
            .mappings()
            .one()
        )
        album_bandcamp = (
            session.execute(
                text("""
                SELECT bandcamp_url, bandcamp_url_source
                FROM library_albums
                WHERE entity_uid = CAST(:entity_uid AS uuid)
                """),
                {"entity_uid": album_uid},
            )
            .mappings()
            .one()
        )

    assert artist_bandcamp["bandcamp_url"] == "https://matchartist.bandcamp.com"
    assert artist_bandcamp["bandcamp_url_source"] == "bandcamp:sync"
    assert (
        album_bandcamp["bandcamp_url"]
        == "https://matchartist.bandcamp.com/album/exact-lp"
    )
    assert album_bandcamp["bandcamp_url_source"] == "bandcamp:sync"


def test_bandcamp_url_backfill_worker_updates_missing_artist_and_album_urls(
    pg_db, monkeypatch
):
    from crate.db.tx import read_scope, transaction_scope
    from crate.worker_handlers import bandcamp as worker_bandcamp

    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    artist_name = f"Backfill Bandcamp Artist {uuid.uuid4().hex[:6]}"
    album_name = "Backfill LP"
    with transaction_scope() as session:
        session.execute(
            text("""
            INSERT INTO library_artists (
                id, entity_uid, name, album_count, track_count, total_size, has_photo
            )
            VALUES (
                :id, CAST(:entity_uid AS uuid), :name, 1, 10, 0, 0
            )
            """),
            {
                "id": 900000 + int(uuid.uuid4().hex[:5], 16),
                "entity_uid": artist_uid,
                "name": artist_name,
            },
        )
        session.execute(
            text("""
            INSERT INTO library_albums (
                entity_uid, artist, name, path, track_count, total_size,
                total_duration, has_cover
            )
            VALUES (
                CAST(:entity_uid AS uuid), :artist, :name, :path, 10, 0, 0, 0
            )
            """),
            {
                "entity_uid": album_uid,
                "artist": artist_name,
                "name": album_name,
                "path": f"/music/{uuid.uuid4().hex}",
            },
        )

    monkeypatch.setattr(worker_bandcamp, "emit_task_event", lambda *a, **k: None)
    monkeypatch.setattr(worker_bandcamp, "emit_progress", lambda *a, **k: None)
    monkeypatch.setattr(worker_bandcamp.time, "sleep", lambda *_a, **_k: None)
    monkeypatch.setattr(
        worker_bandcamp,
        "find_exact_artist_url",
        lambda name, **_kwargs: (
            "https://backfillartist.bandcamp.com" if name == artist_name else None
        ),
    )
    monkeypatch.setattr(
        worker_bandcamp,
        "find_exact_album_url",
        lambda artist, album, **_kwargs: (
            "https://backfillartist.bandcamp.com/album/backfill-lp"
            if artist == artist_name and album == album_name
            else None
        ),
    )

    result = worker_bandcamp._handle_bandcamp_backfill_entity_urls(
        "task-backfill",
        {"limit": 5000, "public_search": True},
        {},
    )

    assert result["public_artist_urls_updated"] >= 1
    assert result["public_album_urls_updated"] >= 1
    with read_scope() as session:
        artist_url = session.execute(
            text("""
            SELECT bandcamp_url
            FROM library_artists
            WHERE entity_uid = CAST(:entity_uid AS uuid)
            """),
            {"entity_uid": artist_uid},
        ).scalar_one()
        album_url = session.execute(
            text("""
            SELECT bandcamp_url
            FROM library_albums
            WHERE entity_uid = CAST(:entity_uid AS uuid)
            """),
            {"entity_uid": album_uid},
        ).scalar_one()

    assert artist_url == "https://backfillartist.bandcamp.com"
    assert album_url == "https://backfillartist.bandcamp.com/album/backfill-lp"


def test_bandcamp_radar_refresh_builds_wishlist_candidates(pg_db):
    from crate.db.repositories.bandcamp import (
        list_bandcamp_radar_items,
        refresh_bandcamp_radar_for_user,
        upsert_bandcamp_item,
        upsert_connection,
        upsert_user_bandcamp_item,
    )

    connection = upsert_connection(
        user_id=1,
        session_secret_ref="bandcamp_session:test",
        session_fingerprint="fingerprint",
        connection_method="manual_dev",
        username="fan",
        fan_id=456,
    )
    item = upsert_bandcamp_item(
        {
            "item_url": "https://radarartist.bandcamp.com/album/wishlist-lp",
            "bandcamp_item_type": "album",
            "artist_name": "Radar Artist",
            "album_title": "Wishlist LP",
        }
    )
    upsert_user_bandcamp_item(
        user_id=1,
        connection_id=connection["id"],
        bandcamp_item_id=item["id"],
        relation_type="wishlist",
        owned=False,
        downloadable=False,
    )

    result = refresh_bandcamp_radar_for_user(1)
    radar = list_bandcamp_radar_items(1)

    assert result["upserted"] >= 1
    assert any(row["bandcamp_item_id"] == item["id"] for row in radar)
    assert radar[0]["score"] >= 80


def test_bandcamp_private_items_are_hidden_after_connection_revocation(pg_db):
    from crate.db.repositories.bandcamp import (
        disconnect_connection,
        list_bandcamp_radar_items,
        list_user_collection,
        refresh_bandcamp_radar_for_user,
        upsert_bandcamp_item,
        upsert_connection,
        upsert_user_bandcamp_item,
    )

    connection = upsert_connection(
        user_id=1,
        session_secret_ref="bandcamp_session:test-revoked",
        session_fingerprint="fingerprint-revoked",
        connection_method="manual_dev",
        username="fan",
        fan_id=456,
    )
    item = upsert_bandcamp_item(
        {
            "item_url": "https://revokedartist.bandcamp.com/album/private-lp",
            "bandcamp_item_type": "album",
            "artist_name": "Revoked Artist",
            "album_title": "Private LP",
        }
    )
    upsert_user_bandcamp_item(
        user_id=1,
        connection_id=connection["id"],
        bandcamp_item_id=item["id"],
        relation_type="collection",
        owned=True,
        downloadable=True,
    )
    upsert_user_bandcamp_item(
        user_id=1,
        connection_id=connection["id"],
        bandcamp_item_id=item["id"],
        relation_type="following",
        owned=False,
        downloadable=False,
    )
    refresh_bandcamp_radar_for_user(1)

    assert list_user_collection(1, "collection")
    assert list_user_collection(1, "following")
    assert list_bandcamp_radar_items(1)

    disconnect_connection(1)

    assert list_user_collection(1, "collection") == []
    assert list_user_collection(1, "following") == []
    assert list_user_collection(1, "wishlist") == []
    assert list_bandcamp_radar_items(1) == []
    assert refresh_bandcamp_radar_for_user(1) == {"upserted": 0}


def test_bandcamp_discover_refresh_is_idempotent_and_preserves_radar_state(pg_db):
    from crate.db.repositories.bandcamp import (
        refresh_bandcamp_discover_for_user,
        update_bandcamp_radar_status,
        upsert_connection,
    )
    from crate.db.tx import read_scope

    upsert_connection(
        user_id=1,
        session_secret_ref="bandcamp_session:test-discover",
        session_fingerprint="fingerprint-discover",
        connection_method="manual_dev",
        username="fan",
        fan_id=456,
    )
    items = [
        {
            "item": {
                "item_url": "https://discoverartist.bandcamp.com/album/first",
                "bandcamp_item_type": "album",
                "artist_name": "Discover Artist",
                "album_title": "First",
                "release_date": "2026-08-20",
                "raw": {"title": "First"},
            },
            "page_cursor": "*",
            "rank": 0,
        },
        {
            "item": {
                "item_url": "https://discoverartist.bandcamp.com/album/second",
                "bandcamp_item_type": "album",
                "artist_name": "Discover Artist",
                "album_title": "Second",
                "release_date": "2026-08-21",
                "raw": {"title": "Second"},
            },
            "page_cursor": "cursor-2",
            "rank": 1,
        },
    ]

    first = refresh_bandcamp_discover_for_user(
        1,
        items,
        last_cursor="cursor-3",
        cache_metadata={"etag": '"discover"'},
    )
    assert first == {"upserted": 2, "stale": 0}

    with read_scope() as session:
        rows = (
            session.execute(
                text("""
            SELECT bri.id, bri.status, bri.source, bri.reason_json
            FROM bandcamp_radar_items bri
            WHERE bri.user_id = 1 AND bri.source = 'discover_followed'
            ORDER BY (bri.reason_json->>'rank')::int
            """)
            )
            .mappings()
            .all()
        )
    assert len(rows) == 2
    assert rows[0]["reason_json"]["release_date"] == "2026-08-20"
    assert rows[0]["reason_json"]["page_cursor"] == "*"

    update_bandcamp_radar_status(user_id=1, radar_id=rows[0]["id"], status="saved")
    second = refresh_bandcamp_discover_for_user(1, items[:1])
    assert second == {"upserted": 1, "stale": 1}

    with read_scope() as session:
        states = session.execute(
            text("""
            SELECT status, source
            FROM bandcamp_radar_items
            WHERE user_id = 1 AND source = 'discover_followed'
            ORDER BY id
            """)
        ).all()
    assert states == [("saved", "discover_followed"), ("stale", "discover_followed")]


def test_bandcamp_radar_refresh_requires_active_connection(
    bandcamp_api_client, monkeypatch
):
    from crate.api import bandcamp as bandcamp_api

    def fail_if_enqueued(*args, **kwargs):
        raise AssertionError(
            "Bandcamp refresh must not be enqueued without a connection"
        )

    monkeypatch.setattr(bandcamp_api, "create_task", fail_if_enqueued)

    response = bandcamp_api_client.post("/api/bandcamp/me/radar/refresh")

    assert response.status_code == 400
    assert response.json()["detail"] == "Bandcamp is not connected"
