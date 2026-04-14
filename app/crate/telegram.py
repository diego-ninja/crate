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

from crate.db import get_setting, set_setting

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
    icons = {
        "tidal_download": "\U0001f4e5",  # inbox tray
        "soulseek_download": "\U0001f4e5",
        "process_new_content": "\u2728",  # sparkles
        "enrich_artists": "\U0001f50d",  # magnifying glass
        "index_genres": "\U0001f3f7",    # label
        "library_sync": "\U0001f4c2",    # folder
        "scan": "\U0001f4c2",
    }
    icon = icons.get(task_type, "\u2705")  # green check
    detail = ""
    if result:
        if task_type == "tidal_download":
            artists = result.get("artists") or result.get("modified_artists") or []
            if artists:
                detail = f"\n{', '.join(artists[:5])}"
        elif "processed" in result or "mapped" in result:
            detail = f"\n{json.dumps({k: v for k, v in result.items() if isinstance(v, (int, float, str)) and k != 'examples_mapped'}, indent=None)}"

    send_message(f"{icon} <b>{task_type}</b> completed\n<code>{task_id[:8]}</code>{detail}")


def notify_task_failed(task_type: str, task_id: str, error: str = ""):
    send_message(
        f"\u274c <b>{task_type}</b> failed\n<code>{task_id[:8]}</code>"
        f"\n<pre>{error[:300]}</pre>" if error else ""
    )


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
        "/status — server & library stats\n"
        "/server — system resources\n"
        "/tasks — active tasks\n"
        "/cancel &lt;id&gt; — cancel a task\n"
        "/playing — now playing\n"
        "/recent — recent additions\n"
        "/download &lt;tidal-url&gt; — start download\n"
        "/search &lt;query&gt; — search Tidal",
        chat_id=chat_id,
    )


def _cmd_status(chat_id: str, _args: str):
    from crate.db.core import get_db_ctx

    with get_db_ctx() as cur:
        cur.execute("SELECT COUNT(*)::INTEGER AS c FROM library_artists")
        artists = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*)::INTEGER AS c FROM library_albums")
        albums = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*)::INTEGER AS c FROM library_tracks")
        tracks = cur.fetchone()["c"]
        cur.execute("SELECT COALESCE(SUM(size), 0)::BIGINT AS s FROM library_tracks")
        size_bytes = cur.fetchone()["s"]
        cur.execute("SELECT COUNT(*)::INTEGER AS c FROM tasks WHERE status = 'running'")
        running = cur.fetchone()["c"]
        cur.execute("SELECT COUNT(*)::INTEGER AS c FROM tasks WHERE status = 'pending'")
        pending = cur.fetchone()["c"]

    size_gb = size_bytes / (1024 ** 3)
    disk = _disk_usage()

    send_message(
        f"\U0001f4ca <b>Crate Status</b>\n\n"
        f"\U0001f3b5 {artists:,} artists / {albums:,} albums / {tracks:,} tracks\n"
        f"\U0001f4be Library: {size_gb:.1f} GB\n"
        f"\U0001f4bf Disk: {disk}\n"
        f"\u2699\ufe0f Tasks: {running} running, {pending} pending",
        chat_id=chat_id,
    )


def _cmd_server(chat_id: str, _args: str):
    mem = _memory_info()
    disk = _disk_usage()
    api_health = _api_health()

    from crate.db.core import get_db_ctx
    with get_db_ctx() as cur:
        cur.execute("SELECT pg_database_size(current_database())::BIGINT AS s")
        db_size_mb = cur.fetchone()["s"] / (1024 * 1024)
        cur.execute("SELECT COUNT(*)::INTEGER AS c FROM pg_stat_activity WHERE state = 'active'")
        db_conns = cur.fetchone()["c"]

    send_message(
        f"\U0001f5a5 <b>Server</b>\n\n"
        f"RAM: {mem['used_gb']:.1f} / {mem['total_gb']:.1f} GB ({mem['percent']}%)\n"
        f"Swap: {mem['swap_used_gb']:.1f} / {mem['swap_total_gb']:.1f} GB ({mem['swap_percent']}%)\n"
        f"Disk: {disk}\n"
        f"DB: {db_size_mb:.0f} MB, {db_conns} active connections\n"
        f"API: {api_health}",
        chat_id=chat_id,
    )


def _cmd_tasks(chat_id: str, _args: str):
    from crate.db.core import get_db_ctx

    with get_db_ctx() as cur:
        cur.execute("""
            SELECT id, type, status, substring(progress for 120) as progress,
                   created_at, updated_at
            FROM tasks
            WHERE status IN ('running', 'pending')
            ORDER BY status, created_at
            LIMIT 15
        """)
        rows = cur.fetchall()

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
    from crate.db.core import get_db_ctx

    with get_db_ctx() as cur:
        cur.execute("""
            SELECT
                ph.user_id,
                u.username,
                u.display_name,
                ph.artist,
                ph.album,
                ph.title,
                t.format,
                t.bit_depth,
                t.sample_rate,
                ph.played_at
            FROM play_history ph
            LEFT JOIN users u ON u.id = ph.user_id
            LEFT JOIN library_tracks t ON t.id = ph.track_id
            WHERE ph.played_at > now() - INTERVAL '10 minutes'
            ORDER BY ph.played_at DESC
        """)
        rows = cur.fetchall()

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

    from crate.db.core import get_db_ctx
    with get_db_ctx() as cur:
        cur.execute("""
            SELECT DISTINCT ON (a.id)
                a.artist, a.name, a.year,
                a.track_count, a.formats_json
            FROM library_albums a
            ORDER BY a.id DESC
            LIMIT %s
        """, (limit,))
        rows = cur.fetchall()

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

    from crate.db import create_task
    task_id = create_task("tidal_download", {"url": url, "quality": "max"})
    send_message(f"\U0001f4e5 Download queued\n<code>{task_id[:8]}</code>\n{url}", chat_id=chat_id)


def _cmd_cancel(chat_id: str, args: str):
    task_id_prefix = args.strip()
    if not task_id_prefix:
        send_message("\u26a0\ufe0f Usage: /cancel &lt;task_id&gt; (first 8 chars are enough)", chat_id=chat_id)
        return

    from crate.db.core import get_db_ctx
    from crate.db.tasks import update_task

    with get_db_ctx() as cur:
        cur.execute(
            "SELECT id, type, status FROM tasks WHERE id LIKE %s AND status IN ('running', 'pending') LIMIT 1",
            (f"{task_id_prefix}%",),
        )
        row = cur.fetchone()

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


# ── Health check alerts ───────────────────────────────────────────

def _check_alerts():
    mem = _memory_info()

    if mem["swap_percent"] > 50:
        send_alert("swap", f"\u26a0\ufe0f <b>High swap usage</b>: {mem['swap_used_gb']:.1f} / {mem['swap_total_gb']:.1f} GB ({mem['swap_percent']}%)")

    if mem["percent"] > 90:
        send_alert("ram", f"\u26a0\ufe0f <b>High memory usage</b>: {mem['used_gb']:.1f} / {mem['total_gb']:.1f} GB ({mem['percent']}%)")

    try:
        usage = shutil.disk_usage("/music")
        free_gb = usage.free / (1024 ** 3)
        if free_gb < 100:
            send_alert("disk", f"\u26a0\ufe0f <b>Low disk space</b>: {free_gb:.0f} GB free")
    except Exception:
        pass

    api_status = _api_health()
    if "unreachable" in api_status or "unhealthy" in api_status:
        send_alert("api", f"\u26a0\ufe0f <b>API {api_status}</b>")


# ── Command router ────────────────────────────────────────────────

_COMMANDS: dict[str, callable] = {
    "start": _cmd_start,
    "help": _cmd_start,
    "status": _cmd_status,
    "server": _cmd_server,
    "tasks": _cmd_tasks,
    "cancel": _cmd_cancel,
    "playing": _cmd_playing,
    "recent": _cmd_recent,
    "download": _cmd_download,
    "search": _cmd_search,
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
            if result:
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
