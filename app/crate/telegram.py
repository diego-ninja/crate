"""Telegram bot for Crate — monitoring & control.

Runs as a daemon thread inside the worker process.  Uses the Telegram
Bot API directly via requests (no framework needed for this scope).

Configuration stored in DB settings:
  telegram_bot_token  — from @BotFather
  telegram_chat_id    — set automatically via /start, or manually
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

from crate.db.cache import get_setting, set_setting
from crate.db.queries.telegram import (
    find_active_task_by_prefix,
    get_library_status_summary,
    get_server_db_stats,
    list_active_tasks,
    list_recent_albums,
    list_recently_played,
)
from crate.db.tasks import create_task, update_task

log = logging.getLogger(__name__)

_BOT_TOKEN: str | None = None
_CHAT_ID: str | None = None
_LAST_UPDATE_ID = 0

# Alert cooldowns — one alert per type every 30 min
_alert_cooldowns: dict[str, float] = {}
_ALERT_COOLDOWN_SEC = 1800


# ── Core API ──────────────────────────────────────────────────────

def _api(method: str, **params) -> dict | None:
    token = _BOT_TOKEN or get_setting("telegram_bot_token")
    if not token:
        return None
    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{token}/{method}",
            json={k: v for k, v in params.items() if v is not None},
            timeout=30,
        )
        data = resp.json()
        if not data.get("ok"):
            log.warning("Telegram API %s failed: %s", method, data.get("description", ""))
            return None
        return data.get("result")
    except Exception:
        log.debug("Telegram API %s error", method, exc_info=True)
        return None


def send_message(text: str, *, chat_id: str | None = None, parse_mode: str = "HTML") -> bool:
    """Send a message to Telegram.

    When chat_id is explicit (command reply) it always sends.
    When chat_id is None (notification) it checks the enabled flag.
    """
    if not chat_id and get_setting("telegram_enabled", "false") != "true":
        return False
    cid = chat_id or _CHAT_ID or get_setting("telegram_chat_id")
    if not cid:
        return False
    result = _api("sendMessage", chat_id=cid, text=text, parse_mode=parse_mode,
                   disable_web_page_preview=True)
    return result is not None


def send_alert(alert_type: str, text: str) -> bool:
    now = time.time()
    last = _alert_cooldowns.get(alert_type, 0)
    if now - last < _ALERT_COOLDOWN_SEC:
        return False
    if send_message(text):
        _alert_cooldowns[alert_type] = now
        return True
    return False


# ── Notify helpers (called from task handlers) ────────────────────

def notify_task_completed(task_type: str, task_id: str, result: dict | None = None):
    from crate.task_registry import task_label, task_icon

    icon = task_icon(task_type)
    label = task_label(task_type)

    # Build result summary
    detail_lines = []
    if result:
        # Filter to scalar values, skip internal keys
        skip_keys = {"examples_mapped", "task_id", "config"}
        for k, v in result.items():
            if k in skip_keys or not isinstance(v, (int, float, str)):
                continue
            detail_lines.append(f"  \u2022 {k.replace('_', ' ')}: {v}")

    detail = "\n".join(detail_lines[:8])
    parts = [f"{icon} <b>{label}</b> completed", f"<code>{task_id[:8]}</code>"]
    if detail:
        parts.append(f"\n\U0001f4ca Results:\n{detail}")
    parts.append(f"\n/task {task_id[:8]}")

    send_message("\n".join(parts))


def notify_task_failed(task_type: str, task_id: str, error: str = ""):
    from crate.task_registry import task_label, task_icon

    icon = task_icon(task_type)
    label = task_label(task_type)
    parts = [f"\u274c <b>{label}</b> FAILED", f"<code>{task_id[:8]}</code>"]
    if error:
        parts.append(f"\n\U0001f4a5 <pre>{error[:300]}</pre>")
    parts.append(f"\n/task {task_id[:8]}")
    send_message("\n".join(parts))


def notify_new_release(artist: str, album: str, year: str = ""):
    send_message(
        f"\U0001f195 New release detected\n<b>{artist}</b> — {album}"
        f" ({year})" if year else ""
    )


# ── Commands ──────────────────────────────────────────────────────

def _cmd_start(chat_id: str, _args: str):
    set_setting("telegram_chat_id", chat_id)
    global _CHAT_ID
    _CHAT_ID = chat_id
    send_message(
        "\U0001f3b5 <b>Crate Bot</b> linked to this chat.\n\n"
        "<b>Monitoring</b>\n"
        "/health — degradation score + metrics\n"
        "/status — library stats\n"
        "/server — system resources\n"
        "/workers — worker status\n"
        "/logs [level] — recent worker logs\n\n"
        "<b>Tasks</b>\n"
        "/tasks — active tasks\n"
        "/task &lt;id&gt; — task detail + progress\n"
        "/cancel &lt;id&gt; — cancel a task\n\n"
        "<b>Library</b>\n"
        "/playing — now playing\n"
        "/recent — recent additions\n"
        "/download &lt;tidal-url&gt; — start download\n"
        "/search &lt;query&gt; — search Tidal",
        chat_id=chat_id,
    )


def _cmd_status(chat_id: str, _args: str):
    summary = get_library_status_summary()

    size_gb = summary["size_bytes"] / (1024 ** 3)
    disk = _disk_usage()

    send_message(
        f"\U0001f4ca <b>Crate Status</b>\n\n"
        f"\U0001f3b5 {summary['artists']:,} artists / {summary['albums']:,} albums / {summary['tracks']:,} tracks\n"
        f"\U0001f4be Library: {size_gb:.1f} GB\n"
        f"\U0001f4bf Disk: {disk}\n"
        f"\u2699\ufe0f Tasks: {summary['running']} running, {summary['pending']} pending",
        chat_id=chat_id,
    )


def _cmd_server(chat_id: str, _args: str):
    mem = _memory_info()
    disk = _disk_usage()
    api_health = _api_health()
    db_stats = get_server_db_stats()
    db_size_mb = db_stats["size_bytes"] / (1024 * 1024)

    send_message(
        f"\U0001f5a5 <b>Server</b>\n\n"
        f"RAM: {mem['used_gb']:.1f} / {mem['total_gb']:.1f} GB ({mem['percent']}%)\n"
        f"Swap: {mem['swap_used_gb']:.1f} / {mem['swap_total_gb']:.1f} GB ({mem['swap_percent']}%)\n"
        f"Disk: {disk}\n"
        f"DB: {db_size_mb:.0f} MB, {db_stats['active_connections']} active connections\n"
        f"API: {api_health}",
        chat_id=chat_id,
    )


def _cmd_tasks(chat_id: str, _args: str):
    rows = list_active_tasks(limit=15)

    if not rows:
        send_message("\u2705 No active tasks", chat_id=chat_id)
        return

    lines = []
    for row in rows:
        icon = "\U0001f7e2" if row["status"] == "running" else "\U0001f7e1"
        progress = ""
        if row["progress"]:
            try:
                p = json.loads(row["progress"])
                if "done" in p and "total" in p:
                    progress = f" ({p['done']}/{p['total']})"
                elif "phase" in p:
                    progress = f" [{p['phase']}]"
            except (json.JSONDecodeError, TypeError):
                pass
        lines.append(f"{icon} <code>{row['id'][:8]}</code> {row['type']}{progress}")

    send_message(f"\u2699\ufe0f <b>Tasks</b>\n\n" + "\n".join(lines), chat_id=chat_id)


def _cmd_playing(chat_id: str, _args: str):
    rows = list_recently_played(limit_minutes=10)

    if not rows:
        send_message("\U0001f508 Nothing playing right now", chat_id=chat_id)
        return

    seen_users: set[int] = set()
    lines = []
    for row in rows:
        uid = row["user_id"]
        if uid in seen_users:
            continue
        seen_users.add(uid)
        name = row.get("display_name") or row.get("username") or f"User {uid}"
        quality = ""
        fmt = (row.get("format") or "").upper()
        if fmt:
            bd = row.get("bit_depth")
            sr = row.get("sample_rate")
            if bd and sr:
                quality = f" [{fmt} {bd}/{sr // 1000 if sr >= 1000 else sr}]"
            else:
                quality = f" [{fmt}]"
        lines.append(f"\U0001f3b6 <b>{name}</b>: {row['artist']} — {row['title']}{quality}")

    send_message("\U0001f3a7 <b>Now Playing</b>\n\n" + "\n".join(lines), chat_id=chat_id)


def _cmd_recent(chat_id: str, args: str):
    limit = 10
    if args.strip().isdigit():
        limit = min(int(args.strip()), 25)

    rows = list_recent_albums(limit)

    if not rows:
        send_message("No albums in library yet", chat_id=chat_id)
        return

    lines = []
    for row in rows:
        year = f" ({row['year']})" if row.get("year") else ""
        fmt = ""
        try:
            formats = json.loads(row["formats_json"]) if isinstance(row["formats_json"], str) else (row["formats_json"] or [])
            if formats:
                fmt = f" [{', '.join(f.upper() for f in formats)}]"
        except (json.JSONDecodeError, TypeError):
            pass
        lines.append(f"\u2022 <b>{row['artist']}</b> — {row['name']}{year}{fmt}")

    send_message(f"\U0001f4e6 <b>Recent additions</b>\n\n" + "\n".join(lines), chat_id=chat_id)


def _cmd_download(chat_id: str, args: str):
    url = args.strip()
    if not url or "tidal.com" not in url:
        send_message("\u26a0\ufe0f Usage: /download &lt;tidal-url&gt;", chat_id=chat_id)
        return

    task_id = create_task("tidal_download", {"url": url, "quality": "max"})
    send_message(f"\U0001f4e5 Download queued\n<code>{task_id[:8]}</code>\n{url}", chat_id=chat_id)


def _cmd_cancel(chat_id: str, args: str):
    task_id_prefix = args.strip()
    if not task_id_prefix:
        send_message("\u26a0\ufe0f Usage: /cancel &lt;task_id&gt; (first 8 chars are enough)", chat_id=chat_id)
        return

    row = find_active_task_by_prefix(task_id_prefix)

    if not row:
        send_message(f"\u26a0\ufe0f No active task matching <code>{task_id_prefix}</code>", chat_id=chat_id)
        return

    update_task(row["id"], status="cancelled")
    send_message(
        f"\U0001f6d1 Cancelled <b>{row['type']}</b>\n<code>{row['id'][:8]}</code>",
        chat_id=chat_id,
    )


def _cmd_search(chat_id: str, args: str):
    query = args.strip()
    if not query:
        send_message("\u26a0\ufe0f Usage: /search &lt;query&gt;", chat_id=chat_id)
        return

    try:
        from crate.tidal import search
        results = search(query, limit=5)
        albums = results.get("albums", [])[:5]
        artists = results.get("artists", [])[:3]
    except Exception as e:
        send_message(f"\u274c Search failed: {str(e)[:200]}", chat_id=chat_id)
        return

    if not albums and not artists:
        send_message(f"\U0001f50d No results for \"{query}\"", chat_id=chat_id)
        return

    lines = []
    if artists:
        lines.append("<b>Artists:</b>")
        for a in artists:
            lines.append(f"  \u2022 {a.get('name', '?')}")
    if albums:
        lines.append("\n<b>Albums:</b>")
        for a in albums:
            artist = a.get("artist", {}).get("name", "?") if isinstance(a.get("artist"), dict) else a.get("artist", "?")
            year = f" ({a['year']})" if a.get("year") else ""
            url = a.get("url", "")
            lines.append(f"  \u2022 {artist} — {a.get('title', '?')}{year}")
            if url:
                lines.append(f"    /download {url}")

    send_message(f"\U0001f50d <b>Tidal search:</b> {query}\n\n" + "\n".join(lines), chat_id=chat_id)


# ── System monitoring helpers ─────────────────────────────────────

def _disk_usage() -> str:
    try:
        usage = shutil.disk_usage("/music")
        free_gb = usage.free / (1024 ** 3)
        total_gb = usage.total / (1024 ** 3)
        pct = (usage.used / usage.total) * 100
        return f"{free_gb:.0f} GB free / {total_gb:.0f} GB ({pct:.0f}%)"
    except Exception:
        return "unavailable"


def _memory_info() -> dict:
    try:
        with open("/proc/meminfo") as f:
            info = {}
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    info[parts[0].rstrip(":")] = int(parts[1])

        total = info.get("MemTotal", 0) / (1024 * 1024)
        available = info.get("MemAvailable", 0) / (1024 * 1024)
        used = total - available
        swap_total = info.get("SwapTotal", 0) / (1024 * 1024)
        swap_free = info.get("SwapFree", 0) / (1024 * 1024)
        swap_used = swap_total - swap_free

        return {
            "total_gb": total,
            "used_gb": used,
            "percent": round(used / total * 100) if total > 0 else 0,
            "swap_total_gb": swap_total,
            "swap_used_gb": swap_used,
            "swap_percent": round(swap_used / swap_total * 100) if swap_total > 0 else 0,
        }
    except Exception:
        return {"total_gb": 0, "used_gb": 0, "percent": 0,
                "swap_total_gb": 0, "swap_used_gb": 0, "swap_percent": 0}


def _api_health() -> str:
    try:
        start = time.monotonic()
        resp = requests.get("http://crate-api:8585/api/health", timeout=5)
        elapsed = (time.monotonic() - start) * 1000
        if resp.status_code == 200:
            return f"healthy ({elapsed:.0f}ms)"
        return f"unhealthy ({resp.status_code}, {elapsed:.0f}ms)"
    except Exception:
        return "unreachable"


# ── Health check alerts (metrics-driven) ─────────────────────────

def _check_alerts():
    """Evaluate health via the alerting engine and send alerts."""
    try:
        from crate.alerting import check_and_alert
        check_and_alert()
    except Exception:
        log.debug("Alerting check failed", exc_info=True)


# ── Command router ────────────────────────────────────────────────

def _cmd_health(chat_id: str, _args: str):
    try:
        from crate.alerting import evaluate_health
        status = evaluate_health()
        score = status.score
        if score >= 80:
            icon = "\U0001f7e2"
        elif score >= 50:
            icon = "\U0001f7e1"
        else:
            icon = "\U0001f534"
        send_message(f"{icon} <b>Health: {score}/100</b>\n\n{status.summary_text()}", chat_id=chat_id)
    except Exception as e:
        send_message(f"\u274c Health check failed: {str(e)[:200]}", chat_id=chat_id)


def _cmd_task(chat_id: str, args: str):
    task_id_prefix = args.strip()
    if not task_id_prefix:
        send_message("\u26a0\ufe0f Usage: /task &lt;task_id&gt;", chat_id=chat_id)
        return

    from crate.db.tasks import get_task
    from crate.task_registry import task_label, task_icon

    row = find_active_task_by_prefix(task_id_prefix)
    if not row:
        # Try completed tasks too
        try:
            from crate.db.tasks import list_tasks
            for t in list_tasks(limit=50):
                if t["id"].startswith(task_id_prefix):
                    row = t
                    break
        except Exception:
            pass

    if not row:
        send_message(f"\u26a0\ufe0f No task matching <code>{task_id_prefix}</code>", chat_id=chat_id)
        return

    task = get_task(row["id"]) if row.get("id") else row
    if not task:
        send_message(f"\u26a0\ufe0f Task not found", chat_id=chat_id)
        return

    icon = task_icon(task["type"])
    label = task_label(task["type"])
    status_icon = {
        "running": "\U0001f7e2", "pending": "\U0001f7e1",
        "completed": "\u2705", "failed": "\u274c", "cancelled": "\U0001f6d1",
    }.get(task.get("status", ""), "\u2753")

    lines = [f"{icon} <b>{label}</b> {status_icon} {task.get('status', '?')}"]
    lines.append(f"<code>{task['id'][:12]}</code>")

    # Parse structured progress
    progress = task.get("progress")
    if progress:
        from crate.task_progress import TaskProgress
        p = TaskProgress.from_json(progress)
        if p.total > 0:
            pct = p.percent()
            bar = "\u2588" * int(pct / 10) + "\u2591" * (10 - int(pct / 10))
            lines.append(f"\nPhase: {p.phase_index + 1}/{p.phase_count} \u2014 {p.phase}")
            lines.append(f"Progress: {bar} {pct:.0f}% ({p.done}/{p.total})")
            if p.rate > 0:
                lines.append(f"Rate: {p.rate:.1f} items/sec \u00b7 ETA: {p.eta_sec}s")
            if p.item:
                lines.append(f"Current: {p.item}")
        elif p.phase:
            lines.append(f"\nPhase: {p.phase}")

    # Show recent events
    try:
        from crate.db.events import get_task_events
        events = get_task_events(task["id"], limit=5)
        if events:
            lines.append("\n\U0001f4cb Last events:")
            for evt in events[-5:]:
                data = evt.get("data_json", {})
                if isinstance(data, str):
                    try:
                        data = json.loads(data)
                    except Exception:
                        data = {}
                level = data.get("level", "info")
                level_icon = {
                    "error": "\U0001f534", "warn": "\U0001f7e1", "info": "\U0001f7e2"
                }.get(level, "\u2022")
                msg = data.get("message") or data.get("label") or evt.get("event_type", "")
                lines.append(f"  {level_icon} {msg[:80]}")
    except Exception:
        pass

    if task.get("error"):
        lines.append(f"\n\U0001f4a5 Error: <pre>{task['error'][:200]}</pre>")

    send_message("\n".join(lines), chat_id=chat_id)


def _cmd_logs(chat_id: str, args: str):
    level = args.strip().lower() or None
    if level and level not in ("info", "warn", "error", "debug"):
        level = None

    try:
        from crate.db.worker_logs import query_logs
        logs = query_logs(level=level, limit=10)
    except Exception as e:
        send_message(f"\u274c Failed to query logs: {str(e)[:200]}", chat_id=chat_id)
        return

    if not logs:
        send_message("\u2705 No recent worker logs" + (f" (level={level})" if level else ""), chat_id=chat_id)
        return

    level_icons = {"error": "\U0001f534", "warn": "\U0001f7e1", "info": "\U0001f7e2", "debug": "\u26aa"}
    lines = ["\U0001f4cb <b>Recent logs</b>"]
    for entry in logs:
        icon = level_icons.get(entry.get("level", "info"), "\u2022")
        cat = entry.get("category", "")
        msg = entry.get("message", "")[:80]
        lines.append(f"  {icon} [{cat}] {msg}")

    send_message("\n".join(lines), chat_id=chat_id)


def _cmd_workers(chat_id: str, _args: str):
    try:
        from crate.db.worker_logs import list_known_workers
        workers = list_known_workers()
    except Exception:
        send_message("\u274c Failed to query workers", chat_id=chat_id)
        return

    if not workers:
        send_message("\U0001f527 No workers seen in the last 24h", chat_id=chat_id)
        return

    lines = ["\U0001f527 <b>Workers</b>"]
    for w in workers:
        lines.append(f"  \u2022 <code>{w['worker_id']}</code>: {w['log_count']} logs, last seen {w.get('last_seen', '?')}")

    send_message("\n".join(lines), chat_id=chat_id)


_COMMANDS: dict[str, callable] = {
    "start": _cmd_start,
    "help": _cmd_start,
    "status": _cmd_status,
    "server": _cmd_server,
    "health": _cmd_health,
    "tasks": _cmd_tasks,
    "task": _cmd_task,
    "cancel": _cmd_cancel,
    "playing": _cmd_playing,
    "recent": _cmd_recent,
    "download": _cmd_download,
    "search": _cmd_search,
    "logs": _cmd_logs,
    "workers": _cmd_workers,
}


def _is_enabled() -> bool:
    return get_setting("telegram_enabled", "false") == "true"


def _handle_update(update: dict):
    message = update.get("message", {})
    text = (message.get("text") or "").strip()
    chat_id = str(message.get("chat", {}).get("id", ""))
    if not text or not chat_id:
        return

    # Only respond to the authorized chat
    authorized = _CHAT_ID or get_setting("telegram_chat_id")
    if authorized and chat_id != authorized:
        if not text.startswith("/start"):
            return

    if not text.startswith("/"):
        return

    parts = text.split(None, 1)
    cmd = parts[0].lstrip("/").split("@")[0].lower()
    args = parts[1] if len(parts) > 1 else ""

    # /start always works (to register); everything else requires enabled
    if cmd != "start" and not _is_enabled():
        send_message(
            "\U0001f6ab Bot is disabled. Enable it from Crate admin settings.",
            chat_id=chat_id,
        )
        return

    handler = _COMMANDS.get(cmd)
    if handler:
        try:
            handler(chat_id, args)
        except Exception:
            log.warning("Telegram command /%s failed", cmd, exc_info=True)
            send_message(f"\u274c Command /{cmd} failed", chat_id=chat_id)


# ── Main loop ─────────────────────────────────────────────────────

def telegram_bot_loop(config: dict):
    """Main bot loop — runs as a daemon thread in the worker."""
    global _BOT_TOKEN, _CHAT_ID, _LAST_UPDATE_ID

    _BOT_TOKEN = config.get("telegram_bot_token") or get_setting("telegram_bot_token") or os.environ.get("TELEGRAM_BOT_TOKEN")
    _CHAT_ID = config.get("telegram_chat_id") or get_setting("telegram_chat_id") or os.environ.get("TELEGRAM_CHAT_ID")

    if not _BOT_TOKEN:
        log.info("Telegram bot token not configured, bot disabled")
        return

    log.info("Telegram bot starting (chat_id=%s)", _CHAT_ID or "waiting for /start")
    last_alert_check = 0

    while True:
        try:
            # Poll for updates (long polling, 30s timeout)
            result = _api("getUpdates", offset=_LAST_UPDATE_ID + 1, timeout=30)
            if result is None:
                # API error (conflict, network, etc.) — back off before retry
                time.sleep(5)
                continue
            for update in result:
                _LAST_UPDATE_ID = update.get("update_id", _LAST_UPDATE_ID)
                _handle_update(update)

            # Health check alerts every 5 min
            now = time.time()
            if now - last_alert_check > 300:
                last_alert_check = now
                _check_alerts()

        except Exception:
            log.debug("Telegram bot loop error", exc_info=True)
            time.sleep(10)
