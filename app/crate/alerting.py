"""Health evaluation and alerting engine.

Computes a degradation score (0–100) from metrics and checks
thresholds. Integrates with Telegram for proactive alerts.
"""

from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass, field

from crate.db.cache import get_setting

log = logging.getLogger(__name__)


@dataclass
class ThresholdBreach:
    name: str
    value: float
    threshold: float
    severity: str  # "warning" | "critical"


@dataclass
class HealthStatus:
    score: int = 100
    breaches: list[ThresholdBreach] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)

    def summary_text(self) -> str:
        lines = []
        m = self.metrics
        lines.append(f"\U0001f4ca API: p95 {m.get('api_p95', 0):.0f}ms, {m.get('api_error_rate', 0):.1f}% errors")
        lines.append(f"\u2699\ufe0f Queue: {m.get('queue_depth', 0):.0f} pending")
        lines.append(f"\U0001f4be Disk: {m.get('disk_free_gb', 0):.0f} GB free ({m.get('disk_usage_pct', 0):.0f}%)")
        lines.append(f"\U0001f9e0 RAM: {m.get('ram_usage_pct', 0):.0f}%")
        if self.breaches:
            lines.append("")
            lines.append("\u26a0\ufe0f Breaches:")
            for b in self.breaches:
                lines.append(f"  \u2022 {b.name}: {b.value:.1f} (threshold: {b.threshold})")
        return "\n".join(lines)


def _get_threshold(key: str, default: float) -> float:
    raw = get_setting(f"alert_threshold_{key}")
    if raw is not None:
        try:
            return float(raw)
        except (ValueError, TypeError):
            pass
    return default


DEFAULT_THRESHOLDS = {
    "api_p95_latency_ms": 3000,
    "api_error_rate_pct": 5,
    "worker_queue_depth": 50,
    "disk_usage_pct": 90,
    "ram_usage_pct": 95,
    "task_failure_rate_pct": 20,
}


def evaluate_health() -> HealthStatus:
    """Evaluate current system health and return a scored status."""
    from crate.metrics import query_summary

    status = HealthStatus()
    breaches: list[ThresholdBreach] = []

    # API latency
    api_latency = query_summary("api.latency", minutes=5)
    api_p95 = api_latency.get("max", 0)  # approximation — max of 5min as p95 proxy
    status.metrics["api_p95"] = api_p95
    threshold = _get_threshold("api_p95_latency_ms", DEFAULT_THRESHOLDS["api_p95_latency_ms"])
    if api_p95 > threshold:
        breaches.append(ThresholdBreach("API p95 latency", api_p95, threshold, "warning"))

    # API error rate
    api_requests = query_summary("api.requests", minutes=5)
    api_errors = query_summary("api.errors", minutes=5)
    total_requests = api_requests.get("count", 0)
    error_count = api_errors.get("count", 0)
    error_rate = (error_count / total_requests * 100) if total_requests > 0 else 0
    status.metrics["api_error_rate"] = error_rate
    threshold = _get_threshold("api_error_rate_pct", DEFAULT_THRESHOLDS["api_error_rate_pct"])
    if error_rate > threshold:
        breaches.append(ThresholdBreach("API error rate", error_rate, threshold, "critical"))

    # Queue depth
    queue = query_summary("worker.queue.depth", minutes=5)
    queue_depth = queue.get("max", 0)
    status.metrics["queue_depth"] = queue_depth
    threshold = _get_threshold("worker_queue_depth", DEFAULT_THRESHOLDS["worker_queue_depth"])
    if queue_depth > threshold:
        breaches.append(ThresholdBreach("Worker queue depth", queue_depth, threshold, "warning"))

    # Disk
    try:
        usage = shutil.disk_usage("/music")
        disk_pct = (usage.used / usage.total) * 100
        disk_free_gb = usage.free / (1024 ** 3)
        status.metrics["disk_usage_pct"] = disk_pct
        status.metrics["disk_free_gb"] = disk_free_gb
        threshold = _get_threshold("disk_usage_pct", DEFAULT_THRESHOLDS["disk_usage_pct"])
        if disk_pct > threshold:
            breaches.append(ThresholdBreach("Disk usage", disk_pct, threshold, "critical"))
    except Exception:
        status.metrics["disk_usage_pct"] = 0
        status.metrics["disk_free_gb"] = 0

    # RAM
    try:
        with open("/proc/meminfo") as f:
            info = {}
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    info[parts[0].rstrip(":")] = int(parts[1])
        total = info.get("MemTotal", 1)
        available = info.get("MemAvailable", 0)
        ram_pct = ((total - available) / total) * 100
        status.metrics["ram_usage_pct"] = ram_pct
        threshold = _get_threshold("ram_usage_pct", DEFAULT_THRESHOLDS["ram_usage_pct"])
        if ram_pct > threshold:
            breaches.append(ThresholdBreach("RAM usage", ram_pct, threshold, "warning"))
    except Exception:
        status.metrics["ram_usage_pct"] = 0

    # Compute degradation score (0-100, 100=healthy)
    # Each breach deducts points based on severity
    score = 100
    for b in breaches:
        if b.severity == "critical":
            score -= 20
        else:
            score -= 10
    status.score = max(0, min(100, score))
    status.breaches = breaches

    return status


def check_and_alert():
    """Evaluate health and send Telegram alerts if thresholds are breached.

    Called from the Telegram bot loop every 5 minutes.
    """
    from crate.telegram import send_alert

    status = evaluate_health()

    if status.score < 50:
        send_alert("critical", f"\U0001f534 Service CRITICAL ({status.score}/100)\n\n{status.summary_text()}")
    elif status.score < 80:
        send_alert("degraded", f"\u26a0\ufe0f Service degraded ({status.score}/100)\n\n{status.summary_text()}")

    for breach in status.breaches:
        send_alert(
            f"metric:{breach.name}",
            f"\u26a0\ufe0f <b>{breach.name}</b>: {breach.value:.1f} (threshold: {breach.threshold})",
        )
