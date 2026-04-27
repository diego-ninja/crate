from __future__ import annotations


class TestMetricsBatchQueries:
    def test_query_summaries_batches_multiple_metrics_in_one_pipeline(self, monkeypatch):
        from crate import metrics

        fixed_bucket = 600

        class FakePipeline:
            def __init__(self):
                self.keys: list[str] = []
                self.executed = False

            def hgetall(self, key: str):
                self.keys.append(key)
                return self

            def execute(self):
                self.executed = True
                results = []
                for key in self.keys:
                    if "api.request.latency" in key:
                        results.append({"count": "2", "sum": "84", "min": "40", "max": "44"})
                    elif "api.request.errors" in key:
                        results.append({"count": "1", "sum": "1", "min": "1", "max": "1"})
                    else:
                        results.append({})
                return results

        class FakeRedis:
            def __init__(self):
                self.pipeline_calls = 0
                self.pipeline_instance = FakePipeline()

            def pipeline(self, transaction: bool = False):
                assert transaction is False
                self.pipeline_calls += 1
                return self.pipeline_instance

        fake_redis = FakeRedis()

        monkeypatch.setattr(metrics, "_minute_bucket", lambda ts=None: fixed_bucket)
        monkeypatch.setattr("crate.db.cache_runtime._get_redis", lambda: fake_redis)

        summaries = metrics.query_summaries(
            {
                "api_latency": ("api.request.latency", 2),
                "api_errors": ("api.request.errors", 1),
            }
        )

        assert fake_redis.pipeline_calls == 1
        assert fake_redis.pipeline_instance.executed is True
        assert fake_redis.pipeline_instance.keys == [
            "crate:metrics:api.request.latency:600",
            "crate:metrics:api.request.latency:540",
            "crate:metrics:api.request.errors:600",
        ]
        assert summaries["api_latency"] == {"count": 4, "avg": 42.0, "min": 40.0, "max": 44.0, "sum": 168.0}
        assert summaries["api_errors"] == {"count": 1, "avg": 1.0, "min": 1.0, "max": 1.0, "sum": 1.0}
