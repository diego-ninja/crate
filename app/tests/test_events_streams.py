import asyncio
import sys
import types


class _FakePubSub:
    def __init__(self, messages):
        self.messages = list(messages)
        self.subscribed = []
        self.unsubscribed = []

    async def subscribe(self, channel: str) -> None:
        self.subscribed.append(channel)

    async def unsubscribe(self, channel: str) -> None:
        self.unsubscribed.append(channel)

    async def listen(self):
        for message in self.messages:
            yield message
        while True:
            await asyncio.sleep(3600)


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
