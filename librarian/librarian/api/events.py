import asyncio
import json

from fastapi import APIRouter
from starlette.responses import StreamingResponse

from librarian.db import list_tasks, get_latest_scan
from librarian.api._deps import get_config
from librarian.importer import ImportQueue

router = APIRouter()


async def _event_stream():
    while True:
        running = list_tasks(status="running", limit=5)
        latest = get_latest_scan()
        recent_completed = list_tasks(status="completed", limit=5)

        config = get_config()
        queue = ImportQueue(config)
        pending_imports = len(queue.scan_pending())

        def _parse_progress(raw):
            try:
                return json.loads(raw) if raw else {}
            except (json.JSONDecodeError, TypeError):
                return {"message": raw} if raw else {}

        data = {
            "tasks": [
                {
                    "id": t["id"], "type": t["type"], "status": t["status"],
                    "progress": _parse_progress(t["progress"]),
                }
                for t in running
            ],
            "last_scan": latest["scanned_at"] if latest else None,
            "issue_count": len(latest["issues"]) if latest else 0,
            "pending_imports": pending_imports,
            "recent_completed": [
                {"id": t["id"], "type": t["type"], "updated_at": t["updated_at"]}
                for t in recent_completed
            ],
        }

        yield f"data: {json.dumps(data)}\n\n"
        await asyncio.sleep(2)


@router.get("/api/events")
async def api_events():
    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
