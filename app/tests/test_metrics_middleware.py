from crate.api.metrics_middleware import _classify_metric_target


def test_metrics_middleware_classifies_event_stream_as_stream():
    target = _classify_metric_target(
        "/api/admin/ops-stream",
        [(b"content-type", b"text/event-stream; charset=utf-8")],
    )

    assert target == "stream"


def test_metrics_middleware_classifies_json_api_as_api():
    target = _classify_metric_target(
        "/api/admin/ops-snapshot",
        [(b"content-type", b"application/json")],
    )

    assert target == "api"


def test_metrics_middleware_skips_media_streams():
    target = _classify_metric_target(
        "/api/stream/library/foo.flac",
        [(b"content-type", b"audio/flac")],
    )

    assert target is None
