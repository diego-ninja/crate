import asyncio
import sys
import types


class _FakePubSub:
    def __init__(self, messages, *, get_message_error: Exception | None = None):
        self.messages = list(messages)
        self.subscribed = []
        self.unsubscribed = []
        self.get_message_error = get_message_error

    async def subscribe(self, channel: str) -> None:
        self.subscribed.append(channel)

    async def unsubscribe(self, channel: str) -> None:
        self.unsubscribed.append(channel)

    async def listen(self):
        for message in self.messages:
            yield message
        while True:
            await asyncio.sleep(3600)

    async def get_message(self, ignore_subscribe_messages: bool = True, timeout: float = 0.0):
        del ignore_subscribe_messages, timeout
        if self.get_message_error is not None:
            error = self.get_message_error
            self.get_message_error = None
            raise error
        if self.messages:
            return self.messages.pop(0)
        return None


class _FakeRedis:
    def __init__(self, pubsub: _FakePubSub):
        self._pubsub = pubsub
        self.closed = False

    def pubsub(self):
        return self._pubsub

    async def aclose(self) -> None:
        self.closed = True


def test_global_stream_pubsub_cleans_up_redis_connections(monkeypatch):
    from crate.api import events

    fake_pubsub = _FakePubSub([
        {"type": "message", "data": "refresh"},
    ])
    fake_redis = _FakeRedis(fake_pubsub)

    fake_asyncio_module = types.SimpleNamespace(from_url=lambda *_args, **_kwargs: fake_redis)
    fake_redis_package = types.ModuleType("redis")
    fake_redis_package.asyncio = fake_asyncio_module

    monkeypatch.setitem(sys.modules, "redis", fake_redis_package)
    monkeypatch.setitem(sys.modules, "redis.asyncio", fake_asyncio_module)
    monkeypatch.setattr(events, "_get_status_snapshot", lambda: {"tasks": []})

    async def _collect():
        stream = events._global_stream_pubsub()
        initial = await anext(stream)
        live = await anext(stream)
        await stream.aclose()
        return initial, live

    initial, live = asyncio.run(_collect())

    assert initial == "data: {\"tasks\": []}\n\n"
    assert live == "data: {\"tasks\": []}\n\n"
    assert fake_pubsub.subscribed == [events.REDIS_CHANNEL_GLOBAL]
    assert fake_pubsub.unsubscribed == [events.REDIS_CHANNEL_GLOBAL]
    assert fake_redis.closed is True


def _install_fake_async_redis(monkeypatch, pubsub: _FakePubSub):
    fake_redis = _FakeRedis(pubsub)
    fake_asyncio_module = types.SimpleNamespace(from_url=lambda *_args, **_kwargs: fake_redis)
    fake_redis_package = types.ModuleType("redis")
    fake_redis_package.asyncio = fake_asyncio_module
    monkeypatch.setitem(sys.modules, "redis", fake_redis_package)
    monkeypatch.setitem(sys.modules, "redis.asyncio", fake_asyncio_module)
    return fake_redis


def _collect_initial_and_fallback(stream_factory):
    async def _collect():
        stream = stream_factory()
        initial = await anext(stream)
        fallback = await anext(stream)
        await stream.aclose()
        return initial, fallback

    return asyncio.run(_collect())


def test_ops_stream_cleans_up_redis_on_pubsub_error(monkeypatch):
    from crate.api import admin_ops

    fake_pubsub = _FakePubSub([], get_message_error=RuntimeError("redis down"))
    fake_redis = _install_fake_async_redis(monkeypatch, fake_pubsub)
    monkeypatch.setattr(admin_ops, "get_cached_ops_snapshot", lambda fresh=False: {"fresh": fresh})

    initial, fallback = _collect_initial_and_fallback(admin_ops._ops_stream)

    assert initial == "data: {\"fresh\": false}\n\n"
    assert fallback == "data: {\"fresh\": false}\n\n"
    assert fake_pubsub.subscribed == [admin_ops.snapshot_channel("ops", "dashboard")]
    assert fake_pubsub.unsubscribed == [admin_ops.snapshot_channel("ops", "dashboard")]
    assert fake_redis.closed is True


def test_tasks_stream_cleans_up_redis_on_pubsub_error(monkeypatch):
    from crate.api import tasks

    fake_pubsub = _FakePubSub([], get_message_error=RuntimeError("redis down"))
    fake_redis = _install_fake_async_redis(monkeypatch, fake_pubsub)
    monkeypatch.setattr(tasks, "get_cached_tasks_surface", lambda limit=100, fresh=False: {"limit": limit, "fresh": fresh})

    initial, fallback = _collect_initial_and_fallback(lambda: tasks._tasks_stream(25))

    assert initial == "data: {\"limit\": 25, \"fresh\": false}\n\n"
    assert fallback == "data: {\"limit\": 25, \"fresh\": false}\n\n"
    assert fake_pubsub.subscribed == [tasks.TASKS_SURFACE_STREAM_CHANNEL]
    assert fake_pubsub.unsubscribed == [tasks.TASKS_SURFACE_STREAM_CHANNEL]
    assert fake_redis.closed is True


def test_health_stream_cleans_up_redis_on_pubsub_error(monkeypatch):
    from crate.api import management

    fake_pubsub = _FakePubSub([], get_message_error=RuntimeError("redis down"))
    fake_redis = _install_fake_async_redis(monkeypatch, fake_pubsub)
    monkeypatch.setattr(
        management,
        "get_cached_health_surface",
        lambda check_type=None, limit=500, fresh=False: {"check_type": check_type, "limit": limit, "fresh": fresh},
    )

    initial, fallback = _collect_initial_and_fallback(lambda: management._health_stream(check_type="tags", limit=33))

    assert initial == "data: {\"check_type\": \"tags\", \"limit\": 33, \"fresh\": false}\n\n"
    assert fallback == "data: {\"check_type\": \"tags\", \"limit\": 33, \"fresh\": false}\n\n"
    assert fake_pubsub.subscribed == [management.HEALTH_SURFACE_STREAM_CHANNEL]
    assert fake_pubsub.unsubscribed == [management.HEALTH_SURFACE_STREAM_CHANNEL]
    assert fake_redis.closed is True


def test_admin_logs_stream_cleans_up_redis_on_pubsub_error(monkeypatch):
    from crate.api import admin_metrics

    fake_pubsub = _FakePubSub([], get_message_error=RuntimeError("redis down"))
    fake_redis = _install_fake_async_redis(monkeypatch, fake_pubsub)
    monkeypatch.setattr(admin_metrics, "get_cached_logs_surface", lambda limit=100, fresh=False: {"limit": limit, "fresh": fresh})

    initial, fallback = _collect_initial_and_fallback(lambda: admin_metrics._admin_logs_stream(40))

    assert initial == "data: {\"limit\": 40, \"fresh\": false}\n\n"
    assert fallback == "data: {\"limit\": 40, \"fresh\": false}\n\n"
    assert fake_pubsub.subscribed == [admin_metrics.LOGS_SURFACE_STREAM_CHANNEL]
    assert fake_pubsub.unsubscribed == [admin_metrics.LOGS_SURFACE_STREAM_CHANNEL]
    assert fake_redis.closed is True
