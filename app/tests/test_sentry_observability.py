from __future__ import annotations

from unittest.mock import patch


def test_sentry_is_disabled_without_dsn(monkeypatch):
    from crate.observability.sentry import load_settings

    monkeypatch.delenv("SENTRY_DSN", raising=False)

    settings = load_settings("api")

    assert settings.enabled is False
    assert settings.service == "api"


def test_sentry_settings_read_release_environment_and_sample_rate(monkeypatch):
    from crate.observability.sentry import load_settings

    monkeypatch.setenv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1")
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "staging")
    monkeypatch.setenv("SENTRY_RELEASE", "crate-abc123")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "0.25")
    monkeypatch.setenv("SENTRY_PROFILES_SAMPLE_RATE", "0.05")

    settings = load_settings("readplane")

    assert settings.enabled is True
    assert settings.service == "readplane"
    assert settings.environment == "staging"
    assert settings.release == "crate-abc123"
    assert settings.traces_sample_rate == 0.25
    assert settings.profiles_sample_rate == 0.05


def test_sentry_settings_clamp_invalid_sample_rates(monkeypatch):
    from crate.observability.sentry import load_settings

    monkeypatch.setenv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "not-a-rate")
    monkeypatch.setenv("SENTRY_PROFILES_SAMPLE_RATE", "2")

    settings = load_settings("workers")

    assert settings.traces_sample_rate == 0.1
    assert settings.profiles_sample_rate == 1.0


def test_sentry_scrubber_redacts_credentials_and_sensitive_query_values():
    from crate.observability.sentry import scrub_sentry_event

    event = {
        "request": {
            "url": (
                "https://api.example.test/api/stream?media_ticket=secret"
                "&artist=birds-in-row"
            ),
            "headers": {
                "Authorization": "Bearer secret",
                "Content-Type": "application/json",
            },
            "cookies": {"session": "secret"},
        },
        "user": {"id": 42, "email": "user@example.test"},
        "extra": {"refresh_token": "secret", "safe": "kept"},
    }

    scrubbed = scrub_sentry_event(event)

    assert scrubbed["request"]["url"] == (
        "https://api.example.test/api/stream?media_ticket=[Filtered]"
        "&artist=birds-in-row"
    )
    assert scrubbed["request"]["headers"]["Authorization"] == "[Filtered]"
    assert scrubbed["request"]["headers"]["Content-Type"] == "application/json"
    assert scrubbed["request"]["cookies"] == "[Filtered]"
    assert scrubbed["user"] == {"id": "42"}
    assert scrubbed["extra"]["refresh_token"] == "[Filtered]"
    assert scrubbed["extra"]["safe"] == "kept"
    assert event["request"]["headers"]["Authorization"] == "Bearer secret"


def test_init_sentry_configures_sdk_once(monkeypatch):
    from crate.observability import sentry

    monkeypatch.setenv("SENTRY_DSN", "https://public@example.ingest.sentry.io/1")
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "development")

    init_calls: list[dict] = []
    tags: list[tuple[str, str]] = []
    monkeypatch.setattr(sentry.sentry_sdk, "is_initialized", lambda: False)
    monkeypatch.setattr(
        sentry.sentry_sdk, "init", lambda **kwargs: init_calls.append(kwargs)
    )
    monkeypatch.setattr(
        sentry.sentry_sdk,
        "set_tag",
        lambda key, value: tags.append((key, value)),
    )

    assert sentry.init_sentry("api") is True

    assert len(init_calls) == 1
    assert init_calls[0]["dsn"] == "https://public@example.ingest.sentry.io/1"
    assert init_calls[0]["send_default_pii"] is False
    assert init_calls[0]["before_send"] is sentry.scrub_sentry_event
    assert tags == [("service", "api")]


def test_init_sentry_does_not_initialize_without_dsn(monkeypatch):
    from crate.observability import sentry

    monkeypatch.delenv("SENTRY_DSN", raising=False)

    with patch.object(sentry.sentry_sdk, "init") as init:
        assert sentry.init_sentry("workers") is False

    init.assert_not_called()


def test_task_scope_adds_low_cardinality_tags_and_task_context(monkeypatch):
    from crate.observability import sentry

    class FakeScope:
        def __init__(self):
            self.tags = []
            self.contexts = []

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def set_tag(self, key, value):
            self.tags.append((key, value))

        def set_context(self, key, value):
            self.contexts.append((key, value))

    class FakeSpan:
        def __init__(self):
            self.data = []

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def set_data(self, key, value):
            self.data.append((key, value))

    scope = FakeScope()
    span = FakeSpan()
    monkeypatch.setattr(sentry.sentry_sdk, "is_initialized", lambda: True)
    monkeypatch.setattr(sentry.sentry_sdk, "push_scope", lambda: scope)
    monkeypatch.setattr(
        sentry.sentry_sdk,
        "start_span",
        lambda **kwargs: (span, kwargs)[0],
    )

    with sentry.task_scope("bandcamp_radar_refresh", "task-123", "maintenance"):
        pass

    assert scope.tags == [
        ("task_type", "bandcamp_radar_refresh"),
        ("queue", "maintenance"),
    ]
    assert scope.contexts == [
        ("task", {"id": "task-123", "type": "bandcamp_radar_refresh"})
    ]
    assert span.data == [("task_id", "task-123"), ("queue", "maintenance")]


def test_task_scope_is_a_noop_when_sentry_is_disabled(monkeypatch):
    from crate.observability import sentry

    monkeypatch.setattr(sentry.sentry_sdk, "is_initialized", lambda: False)

    with sentry.task_scope("scan", "task-123", "maintenance") as span:
        assert span is None
