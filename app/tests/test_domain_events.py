class _FakeRedisStream:
    def __init__(self):
        self.seq = 0
        self.group_created = False
        self.stream: list[tuple[str, dict]] = []
        self.pending_by_consumer: dict[str, list[tuple[str, dict]]] = {}
        self.delivered_ids: set[str] = set()

    def xadd(self, _stream_key: str, fields: dict, maxlen: int | None = None, approximate: bool = True) -> str:
        del maxlen, approximate
        msg_id = f"{len(self.stream) + 1}-0"
        self.stream.append((msg_id, dict(fields)))
        return msg_id

    def incr(self, _key: str) -> int:
        self.seq += 1
        return self.seq

    def get(self, _key: str) -> str | None:
        return str(self.seq) if self.seq else None

    def xgroup_create(self, _stream_key: str, _group_name: str, id: str = "0", mkstream: bool = True) -> None:
        del id, mkstream
        if self.group_created:
            raise RuntimeError("BUSYGROUP Consumer Group name already exists")
        self.group_created = True

    def xreadgroup(self, _group_name: str, consumer_name: str, streams: dict[str, str], count: int, block: int | None = None):
        del block
        request_id = next(iter(streams.values()))
        pending = self.pending_by_consumer.setdefault(consumer_name, [])

        if request_id == "0":
            messages = pending[:count]
            return [("crate:domain_events", messages)] if messages else []

        if request_id != ">":
            raise AssertionError(f"Unexpected read id: {request_id}")

        messages = []
        for message in self.stream:
            if message[0] in self.delivered_ids:
                continue
            self.delivered_ids.add(message[0])
            pending.append(message)
            messages.append(message)
            if len(messages) >= count:
                break
        return [("crate:domain_events", messages)] if messages else []

    def xack(self, _stream_key: str, _group_name: str, *ids: str) -> int:
        acked = set(ids)
        for consumer_name, pending in list(self.pending_by_consumer.items()):
            self.pending_by_consumer[consumer_name] = [
                message for message in pending if message[0] not in acked
            ]
        return len(ids)

    def xrange(self, _stream_key: str, _min: str, _max: str, count: int):
        del _min, _max
        return self.stream[:count]


def _patch_fake_redis(monkeypatch):
    from crate.db import domain_events

    fake_redis = _FakeRedisStream()
    monkeypatch.setattr(domain_events, "_get_redis", lambda: fake_redis)
    monkeypatch.setattr(domain_events, "_group_created", False)
    return domain_events, fake_redis


def test_append_domain_event_defers_publish_until_after_commit(monkeypatch):
    domain_events, fake_redis = _patch_fake_redis(monkeypatch)
    callbacks = []

    monkeypatch.setattr(domain_events, "register_after_commit", lambda session, callback: callbacks.append(callback))

    returned = domain_events.append_domain_event(
        "library.scan.completed",
        {"scan_id": 12},
        scope="library",
        subject_key="global",
        session=object(),
    )

    assert returned == 0
    assert fake_redis.stream == []
    assert len(callbacks) == 1

    callbacks[0]()

    assert fake_redis.stream == [
        (
            "1-0",
            {
                "event_type": "library.scan.completed",
                "scope": "library",
                "subject_key": "global",
                "payload_json": '{"scan_id": 12}',
            },
        )
    ]
    assert domain_events.get_latest_domain_event_id() == 1


def test_list_domain_events_replays_pending_before_consuming_new(monkeypatch):
    domain_events, _fake_redis = _patch_fake_redis(monkeypatch)

    domain_events.append_domain_event("first.event", {"order": 1}, scope="ops", subject_key="dashboard")
    domain_events.append_domain_event("second.event", {"order": 2}, scope="ops", subject_key="dashboard")

    first = domain_events.list_domain_events(limit=1, consumer_name="worker")
    assert [event["event_type"] for event in first] == ["first.event"]

    replayed = domain_events.list_domain_events(limit=1, consumer_name="worker")
    assert [event["id"] for event in replayed] == [first[0]["id"]]

    domain_events.mark_domain_events_processed([first[0]["id"]])

    second = domain_events.list_domain_events(limit=1, consumer_name="worker")
    assert [event["event_type"] for event in second] == ["second.event"]
