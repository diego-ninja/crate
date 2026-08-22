from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest


@dataclass
class FakeResponse:
    payload: Any
    status_code: int = 200
    headers: dict[str, str] | None = None

    def json(self) -> Any:
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


def _session_material():
    from crate.bandcamp.models import BandcampFanIdentity, BandcampSessionMaterial

    return BandcampSessionMaterial(
        cookies={"identity": "session-cookie"},
        profile=BandcampFanIdentity(username="fan", fan_id=123),
    )


def _album(item_id: int, *, stream_url: str = "") -> dict[str, Any]:
    payload: dict[str, Any] = {
        "result_type": "a",
        "item_id": item_id,
        "band_id": 88,
        "band_name": "Followed Artist",
        "title": f"Release {item_id}",
        "item_url": f"https://followed-artist.bandcamp.com/album/release-{item_id}",
        "release_date": "2026-08-20",
        "primary_image": {
            "image_id": 700 + item_id,
            "url": "https://f4.bcbits.com/img/a1234567890_10.jpg",
        },
        "price": {"amount": 10, "currency": "EUR"},
        "encoding": "mp3-320",
    }
    if stream_url:
        payload["stream_url"] = stream_url
    return payload


def test_discover_paginates_and_normalizes_only_stable_fields(monkeypatch):
    from crate.bandcamp.discover import BandcampDiscoverClient

    pages = iter(
        [
            FakeResponse(
                {
                    "results": [
                        _album(
                            101,
                            stream_url="https://bandcamp.com/stream/private-token",
                        )
                    ],
                    "cursor": "cursor-2",
                },
                headers={"ETag": '"discover-1"'},
            ),
            FakeResponse(
                {
                    "results": [_album(101), _album(102)],
                    "cursor": "",
                }
            ),
        ]
    )
    client = BandcampDiscoverClient(_session_material(), enabled=True)
    calls: list[dict[str, Any]] = []

    def post(_url: str, **kwargs: Any) -> FakeResponse:
        calls.append(kwargs["json"])
        return next(pages)

    monkeypatch.setattr(client.web_client.session, "post", post)
    monkeypatch.setattr("crate.bandcamp.discover.wait_for_provider_slot", lambda *_: 0)

    result = client.fetch_followed()

    assert [entry.item["bandcamp_item_id"] for entry in result.items] == [101, 102]
    assert result.pages_fetched == 2
    assert result.skipped_items == 0
    assert calls[0] == {
        "followed_bands": True,
        "cursor": "*",
        "size": 60,
        "slice": "new",
        "include_result_types": ["a", "s"],
    }
    assert calls[1]["cursor"] == "cursor-2"
    assert "stream_url" not in result.items[0].item
    assert "stream_url" not in result.items[0].item["raw"]
    assert "encoding" not in result.items[0].item["raw"]
    assert result.items[0].item["raw"]["price"] == {
        "amount": 10,
        "currency": "EUR",
    }
    assert result.cache_metadata["etag"] == '"discover-1"'


def test_discover_stops_on_repeated_cursor_without_duplicates(monkeypatch):
    from crate.bandcamp.discover import BandcampDiscoverClient

    pages = iter(
        [
            FakeResponse({"results": [_album(101)], "cursor": "repeat"}),
            FakeResponse({"results": [_album(101), _album(102)], "cursor": "repeat"}),
        ]
    )
    client = BandcampDiscoverClient(_session_material(), enabled=True, max_pages=5)
    calls = 0

    def post(*_args: Any, **_kwargs: Any) -> FakeResponse:
        nonlocal calls
        calls += 1
        return next(pages)

    monkeypatch.setattr(client.web_client.session, "post", post)
    monkeypatch.setattr("crate.bandcamp.discover.wait_for_provider_slot", lambda *_: 0)

    result = client.fetch_followed()

    assert [entry.item["bandcamp_item_id"] for entry in result.items] == [101, 102]
    assert result.pages_fetched == 2
    assert calls == 2


@pytest.mark.parametrize("status_code", [401, 403])
def test_discover_rejects_expired_authenticated_session(monkeypatch, status_code: int):
    from crate.bandcamp.discover import (
        BandcampDiscoverAuthError,
        BandcampDiscoverClient,
    )

    client = BandcampDiscoverClient(_session_material(), enabled=True)
    monkeypatch.setattr(
        client.web_client.session,
        "post",
        lambda *_args, **_kwargs: FakeResponse({}, status_code=status_code),
    )
    monkeypatch.setattr("crate.bandcamp.discover.wait_for_provider_slot", lambda *_: 0)

    with pytest.raises(BandcampDiscoverAuthError):
        client.fetch_followed()


def test_discover_surfaces_rate_limit(monkeypatch):
    from crate.bandcamp.discover import (
        BandcampDiscoverRateLimited,
        BandcampDiscoverClient,
    )

    client = BandcampDiscoverClient(_session_material(), enabled=True)
    monkeypatch.setattr(
        client.web_client.session,
        "post",
        lambda *_args, **_kwargs: FakeResponse({}, status_code=429),
    )
    monkeypatch.setattr("crate.bandcamp.discover.wait_for_provider_slot", lambda *_: 0)

    with pytest.raises(BandcampDiscoverRateLimited):
        client.fetch_followed()


def test_discover_rejects_malformed_json_and_missing_cursor(monkeypatch):
    from crate.bandcamp.discover import (
        BandcampDiscoverClient,
        BandcampDiscoverContractError,
    )

    client = BandcampDiscoverClient(_session_material(), enabled=True)
    responses = iter(
        [
            FakeResponse(ValueError("invalid json")),
            FakeResponse({"results": [_album(101)]}),
        ]
    )
    monkeypatch.setattr(
        client.web_client.session,
        "post",
        lambda *_args, **_kwargs: next(responses),
    )
    monkeypatch.setattr("crate.bandcamp.discover.wait_for_provider_slot", lambda *_: 0)

    with pytest.raises(BandcampDiscoverContractError):
        client.fetch_followed()

    with pytest.raises(BandcampDiscoverContractError):
        client.fetch_followed()


def test_discover_requires_valid_session_material():
    from crate.bandcamp.discover import (
        BandcampDiscoverAuthError,
        BandcampDiscoverClient,
    )
    from crate.bandcamp.models import BandcampSessionMaterial

    with pytest.raises(BandcampDiscoverAuthError):
        BandcampDiscoverClient(BandcampSessionMaterial(), enabled=True)


def test_discover_uses_cached_result_without_calling_provider(monkeypatch):
    from crate.bandcamp.discover import BandcampDiscoverClient, normalize_discover_item

    cached = {
        "items": [
            {
                "item": normalize_discover_item(_album(101)),
                "page_cursor": "*",
                "rank": 0,
            }
        ],
        "pages_fetched": 1,
        "skipped_items": 0,
        "last_cursor": "",
        "cache_metadata": {"etag": '"cached"'},
    }
    monkeypatch.setattr(
        "crate.bandcamp.discover.get_cache", lambda *_args, **_kwargs: cached
    )
    monkeypatch.setattr(
        "crate.bandcamp.discover.set_cache",
        lambda *_args, **_kwargs: pytest.fail("cache hit must not write"),
    )
    client = BandcampDiscoverClient(
        _session_material(), enabled=True, cache_key="bandcamp:discover:1"
    )
    monkeypatch.setattr(
        client.web_client.session,
        "post",
        lambda *_args, **_kwargs: pytest.fail("cache hit must not call Bandcamp"),
    )

    result = client.fetch_followed()

    assert result.cache_hit is True
    assert result.items[0].item["bandcamp_item_id"] == 101


def test_discover_worker_refreshes_only_an_active_connection(monkeypatch):
    from crate.bandcamp.discover import (
        BandcampDiscoverItem,
        BandcampDiscoverResult,
        normalize_discover_item,
    )
    from crate.worker_handlers import bandcamp as worker_bandcamp

    events: list[tuple[str, dict[str, Any]]] = []
    persisted: dict[str, Any] = {}
    normalized_item = normalize_discover_item(_album(101))

    class FakeDiscoverClient:
        def __init__(self, session_material: Any, **kwargs: Any):
            assert session_material.cookies == {"identity": "session-cookie"}
            assert kwargs["cache_key"] == "bandcamp:discover:user:1"

        def fetch_followed(self) -> BandcampDiscoverResult:
            return BandcampDiscoverResult(
                items=(
                    BandcampDiscoverItem(
                        item=normalized_item,
                        page_cursor="*",
                        rank=0,
                    ),
                ),
                pages_fetched=1,
                skipped_items=0,
                last_cursor="",
                cache_metadata={"etag": '"discover"'},
            )

    monkeypatch.setattr(worker_bandcamp, "bandcamp_discover_enabled", lambda: True)
    monkeypatch.setattr(
        worker_bandcamp,
        "get_connection_for_user",
        lambda user_id: {
            "id": 9,
            "user_id": user_id,
            "status": "connected",
            "session_secret_ref": "bandcamp-secret",
        },
    )
    monkeypatch.setattr(
        worker_bandcamp,
        "load_secret",
        lambda *_args, **_kwargs: {
            "cookies": {"identity": "session-cookie"},
            "profile": {"username": "fan", "fan_id": 123},
        },
    )
    monkeypatch.setattr(
        worker_bandcamp,
        "session_material_from_payload",
        lambda payload: _session_material(),
    )
    monkeypatch.setattr(worker_bandcamp, "BandcampDiscoverClient", FakeDiscoverClient)
    monkeypatch.setattr(
        worker_bandcamp,
        "refresh_bandcamp_discover_for_user",
        lambda user_id, items, **kwargs: (
            persisted.update({"user_id": user_id, "items": items, "kwargs": kwargs})
            or {"upserted": 1, "stale": 0}
        ),
    )
    monkeypatch.setattr(
        worker_bandcamp,
        "emit_task_event",
        lambda task_id, event, payload: events.append((event, payload)),
    )

    result = worker_bandcamp._handle_bandcamp_discover_refresh(
        "task-discover-1", {"user_id": 1}, {}
    )

    assert result == {
        "enabled": True,
        "pages_fetched": 1,
        "items_accepted": 1,
        "items_skipped": 0,
        "upserted": 1,
        "stale": 0,
        "cache_hit": False,
    }
    assert persisted["user_id"] == 1
    assert persisted["items"][0]["item"]["bandcamp_item_id"] == 101
    assert persisted["kwargs"] == {
        "last_cursor": "",
        "cache_metadata": {"etag": '"discover"'},
    }
    assert all("session-cookie" not in str(payload) for _, payload in events)


def test_discover_worker_does_not_call_provider_without_active_connection(monkeypatch):
    from crate.worker_handlers import bandcamp as worker_bandcamp

    monkeypatch.setattr(worker_bandcamp, "bandcamp_discover_enabled", lambda: True)
    monkeypatch.setattr(
        worker_bandcamp,
        "get_connection_for_user",
        lambda _user_id: {"status": "revoked"},
    )
    monkeypatch.setattr(
        worker_bandcamp,
        "BandcampDiscoverClient",
        lambda *_args, **_kwargs: pytest.fail(
            "provider must not run without connection"
        ),
    )
    monkeypatch.setattr(
        worker_bandcamp, "emit_task_event", lambda *_args, **_kwargs: None
    )

    assert worker_bandcamp._handle_bandcamp_discover_refresh(
        "task-discover-2", {"user_id": 1}, {}
    ) == {
        "enabled": True,
        "skipped": "inactive_connection",
    }
