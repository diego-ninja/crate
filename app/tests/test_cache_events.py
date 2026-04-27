import json


class _FakeRedis:
    def __init__(self):
        self.next_id = 0
        self.events: list[str] = []

    def incr(self, _key: str) -> int:
        self.next_id += 1
        return self.next_id

    def lpush(self, _key: str, value: str) -> None:
        self.events.insert(0, value)

    def ltrim(self, _key: str, _start: int, _end: int) -> None:
        return None


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
    assert appended == [
        ("ui.invalidate", {"scope": "library", "redis_event_id": 2}, "ui.invalidate", "library"),
        ("ui.invalidate", {"scope": "home:user:7", "redis_event_id": 3}, "ui.invalidate", "home:user:7"),
    ]
