import json

import crate.media_worker_progress as media_progress


class FakeRedis:
    def __init__(self, messages=None, hash_data=None):
        self.messages = messages or []
        self.hash_data = hash_data or {}
        self.values = {}
        self.acked = []
        self.sets = []
        self.deleted = []
        self.expired = []
        self.groups = []

    def xgroup_create(self, stream, group, id="0", mkstream=True):
        self.groups.append((stream, group, id, mkstream))

    def xreadgroup(self, group, consumer, streams, count, block):
        stream_id = next(iter(streams.values()))
        if stream_id == "0":
            return []
        stream_name = next(iter(streams.keys()))
        return [(stream_name, self.messages[:count])]

    def xack(self, stream, group, msg_id):
        self.acked.append((stream, group, msg_id))

    def set(self, key, value, ex=None, nx=False):
        if nx and key in self.values:
            return False
        self.values[key] = value
        self.sets.append((key, value, ex))
        return True

    def get(self, key):
        return self.values.get(key)

    def expire(self, key, ttl):
        self.expired.append((key, ttl))

    def delete(self, key):
        self.deleted.append(key)
        self.values.pop(key, None)

    def pttl(self, key):
        return 1000 if key in self.values else -2

    def hgetall(self, key):
        return self.hash_data.get(key, {})


def test_bridge_media_worker_events_to_task_progress(monkeypatch):
    payload = {
        "job_id": "task-1",
        "event": "entry_finished",
        "kind": "album",
        "name": "01 Track.flac",
        "index": 1,
        "total": 2,
        "bytes": 123,
    }
    fake_redis = FakeRedis(
        messages=[
            (
                "1777977153295-0",
                {
                    "job_id": "task-1",
                    "event": "entry_finished",
                    "payload_json": json.dumps(payload),
                },
            )
        ]
    )
    updates = []
    events = []

    monkeypatch.setattr(media_progress, "_group_created", False)
    monkeypatch.setattr(media_progress, "_get_redis", lambda: fake_redis)
    monkeypatch.setattr("crate.db.queries.tasks.get_task", lambda task_id: {"id": task_id, "status": "running"})
    monkeypatch.setattr(
        "crate.db.repositories.tasks.update_task",
        lambda task_id, **kwargs: updates.append((task_id, kwargs)),
    )
    monkeypatch.setattr(
        "crate.db.events.emit_task_event",
        lambda task_id, event_type, data: events.append((task_id, event_type, data)),
    )

    stats = media_progress.bridge_media_worker_task_events(limit=10, consumer_name="test")

    assert stats == {"read": 1, "bridged": 1, "ignored": 0}
    assert fake_redis.acked == [("crate:media-worker:events", "crate-media-worker-task-bridge", "1777977153295-0")]
    assert updates[0][0] == "task-1"
    progress = json.loads(updates[0][1]["progress"])
    assert progress["phase"] == "writing_package"
    assert progress["done"] == 1
    assert progress["total"] == 2
    assert events[0][0] == "task-1"
    assert events[0][1] == "progress"
    assert events[0][2]["media_worker_event"] == "entry_finished"
    assert events[0][2]["message"] == "Packaged 01 Track.flac"


def test_bridge_ignores_non_task_media_worker_jobs(monkeypatch):
    fake_redis = FakeRedis(
        messages=[
            (
                "1-0",
                {
                    "job_id": "download-cache-key",
                    "event": "finished",
                    "payload_json": json.dumps({"job_id": "download-cache-key", "event": "finished"}),
                },
            )
        ]
    )
    monkeypatch.setattr(media_progress, "_group_created", False)
    monkeypatch.setattr(media_progress, "_get_redis", lambda: fake_redis)
    monkeypatch.setattr("crate.db.queries.tasks.get_task", lambda task_id: None)

    stats = media_progress.bridge_media_worker_task_events(limit=10, consumer_name="test")

    assert stats == {"read": 1, "bridged": 0, "ignored": 1}
    assert fake_redis.acked == [("crate:media-worker:events", "crate-media-worker-task-bridge", "1-0")]


def test_cancel_media_worker_job_sets_global_cancel_key(monkeypatch):
    fake_redis = FakeRedis()
    monkeypatch.setattr(media_progress, "_get_redis", lambda: fake_redis)

    assert media_progress.cancel_media_worker_job("task-2", ttl_seconds=30) is True

    assert fake_redis.sets == [("crate:media-worker:cancel:task-2", "1", 30)]


def test_get_media_worker_job_decodes_payload(monkeypatch):
    fake_redis = FakeRedis(
        hash_data={
            "crate:media-worker:job:job-1": {
                "status": "ready",
                "payload_json": json.dumps({"job_id": "job-1", "event": "finished"}),
            }
        }
    )
    monkeypatch.setattr(media_progress, "_get_redis", lambda: fake_redis)

    job = media_progress.get_media_worker_job("job-1")

    assert job["status"] == "ready"
    assert job["payload"]["event"] == "finished"


def test_media_worker_slot_lease_uses_first_free_slot(monkeypatch):
    fake_redis = FakeRedis()
    monkeypatch.setattr(media_progress, "_get_redis", lambda: fake_redis)
    monkeypatch.setenv("CRATE_MEDIA_WORKER_MAX_ACTIVE", "2")

    lease = media_progress.acquire_media_worker_slot("job-1", ttl_seconds=45)

    assert lease is not None
    assert lease.key == "crate:media-worker:slot:0"
    assert fake_redis.values["crate:media-worker:slot:0"] == "job-1"

    lease.release()

    assert fake_redis.deleted == ["crate:media-worker:slot:0"]


def test_media_worker_slot_lease_refuses_when_full(monkeypatch):
    fake_redis = FakeRedis()
    fake_redis.values["crate:media-worker:slot:0"] = "busy"
    monkeypatch.setattr(media_progress, "_get_redis", lambda: fake_redis)
    monkeypatch.setenv("CRATE_MEDIA_WORKER_MAX_ACTIVE", "1")

    lease = media_progress.acquire_media_worker_slot("job-2", ttl_seconds=45)

    assert lease is None
