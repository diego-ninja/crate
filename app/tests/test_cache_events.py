import asyncio
import json


class _FakeRedis:
    def __init__(self):
        self.next_id = 0
        self.events: list[str] = []
        self.published: list[tuple[str, str]] = []

    def incr(self, _key: str) -> int:
        self.next_id += 1
        return self.next_id

    def lpush(self, _key: str, value: str) -> None:
        self.events.insert(0, value)

    def ltrim(self, _key: str, _start: int, _end: int) -> None:
        return None

    def publish(self, channel: str, value: str) -> None:
        self.published.append((channel, value))


class _FakePubSub:
    def __init__(self, messages: list[dict]):
        self.messages = list(messages)
        self.subscribed: list[str] = []
        self.unsubscribed: list[str] = []
        self.closed = False

    async def subscribe(self, channel: str) -> None:
        self.subscribed.append(channel)

    async def unsubscribe(self, channel: str) -> None:
        self.unsubscribed.append(channel)

    async def get_message(self, ignore_subscribe_messages: bool = True, timeout: float = 0.0):
        del ignore_subscribe_messages, timeout
        if self.messages:
            return self.messages.pop(0)
        return None

    async def aclose(self) -> None:
        self.closed = True


class _FakeAsyncRedis:
    def __init__(self, pubsub: _FakePubSub):
        self._pubsub = pubsub
        self.closed = False

    def pubsub(self) -> _FakePubSub:
        return self._pubsub

    async def aclose(self) -> None:
        self.closed = True


def test_should_append_invalidation_domain_event_is_selective():
    from crate.api import cache_events

    assert cache_events._should_append_invalidation_domain_event("library") is True
    assert cache_events._should_append_invalidation_domain_event("artist:7") is True
    assert cache_events._should_append_invalidation_domain_event("playlist:42") is True
    assert cache_events._should_append_invalidation_domain_event("home:user:9") is True

    assert cache_events._should_append_invalidation_domain_event("likes") is False
    assert cache_events._should_append_invalidation_domain_event("follows") is False
    assert cache_events._should_append_invalidation_domain_event("history") is False
    assert cache_events._should_append_invalidation_domain_event("home") is False


def test_do_broadcast_only_appends_projector_relevant_invalidation_events(monkeypatch):
    from crate.api import cache_events

    fake_redis = _FakeRedis()
    appended: list[tuple[str, dict, str, str]] = []

    monkeypatch.setattr(cache_events, "_get_redis", lambda: fake_redis)
    monkeypatch.setattr(cache_events, "_clear_backend_cache_for_scopes", lambda scopes: None)
    monkeypatch.setattr(
        "crate.db.domain_events.append_domain_event",
        lambda event_type, payload, scope=None, subject_key=None, session=None: appended.append(
            (event_type, payload, scope or "", subject_key or "")
        ),
    )

    cache_events._do_broadcast(["likes", "library", "home:user:7"])

    assert [json.loads(event)["scope"] for event in reversed(fake_redis.events)] == [
        "likes",
        "library",
        "home:user:7",
    ]
    assert [channel for channel, _payload in fake_redis.published] == [
        cache_events._LIVE_CHANNEL,
        cache_events._LIVE_CHANNEL,
        cache_events._LIVE_CHANNEL,
    ]
    assert appended == [
        ("ui.invalidate", {"scope": "library", "redis_event_id": 2}, "ui.invalidate", "library"),
        ("ui.invalidate", {"scope": "home:user:7", "redis_event_id": 3}, "ui.invalidate", "home:user:7"),
    ]


def test_invalidation_stream_replays_events_and_switches_to_pubsub(monkeypatch):
    from crate.api import cache_events

    fake_pubsub = _FakePubSub(
        [
            {"type": "message", "data": json.dumps({"id": 2, "scope": "history"})},
            {"type": "message", "data": json.dumps({"id": 3, "scope": "library"})},
        ]
    )
    fake_redis = _FakeAsyncRedis(fake_pubsub)

    async def _open_live_invalidation_pubsub():
        await fake_pubsub.subscribe(cache_events._LIVE_CHANNEL)
        return fake_redis, fake_pubsub

    monkeypatch.setattr(cache_events, "_open_live_invalidation_pubsub", _open_live_invalidation_pubsub)
    monkeypatch.setattr(
        cache_events,
        "get_invalidation_events_since",
        lambda last_id: [{"id": 2, "scope": "history"}] if last_id == 1 else [],
    )

    async def _collect():
        stream = cache_events._invalidation_stream(1)
        replay = await anext(stream)
        live = await anext(stream)
        await stream.aclose()
        return replay, live

    replay, live = asyncio.run(_collect())

    assert replay == "id: 2\ndata: history\n\n"
    assert live == "id: 3\ndata: library\n\n"
    assert fake_pubsub.subscribed == [cache_events._LIVE_CHANNEL]
    assert fake_pubsub.unsubscribed == [cache_events._LIVE_CHANNEL]
    assert fake_pubsub.closed is True
    assert fake_redis.closed is True


def test_artist_invalidation_clears_listen_artist_page_cache(monkeypatch):
    from crate.api import cache_events

    deleted_prefixes: list[str] = []
    marked: list[tuple[str | None, str | None]] = []

    monkeypatch.setattr("crate.db.cache_store.delete_cache_prefix", lambda prefix: deleted_prefixes.append(prefix))
    monkeypatch.setattr(
        "crate.db.ui_snapshot_store.mark_ui_snapshots_stale",
        lambda scope=None, subject_key=None, scope_prefix=None: marked.append((scope or scope_prefix, subject_key)),
    )

    cache_events._clear_backend_cache_for_scopes(["artist:52"])

    assert "artist:52" in deleted_prefixes
    assert "listen:artist_page:" in deleted_prefixes
    assert ("home:", None) in marked
