"""Project domain events into persisted UI snapshots."""

from __future__ import annotations

import logging

from crate.db.domain_events import list_domain_events, mark_domain_events_processed
from crate.db.home import get_cached_home_discovery
from crate.db.ops_snapshot import get_cached_ops_snapshot
from crate.db.queries.tasks import has_inflight_acquisition_for_artist
from crate.content import queue_process_new_content_if_needed

log = logging.getLogger(__name__)

_OPS_EVENT_TYPES = {
    "library.import_queue.changed",
    "library.scan.completed",
    "track.analysis.updated",
    "track.bliss.updated",
    "snapshot.built",
}

_HOME_EVENT_TYPES = {
    "user.follows.changed",
    "user.likes.changed",
    "user.listening_aggregates.updated",
    "user.play_event.recorded",
    "user.saved_albums.changed",
}

_OPS_INVALIDATION_SCOPES = {
    "library",
    "shows",
    "upcoming",
    "curation",
    "playlists",
}


def _refreshes_ops_from_invalidation(scope: str) -> bool:
    return scope in _OPS_INVALIDATION_SCOPES or scope.startswith(("artist:", "album:", "playlist:"))


def _queue_post_acquisition_processing(payload: dict) -> bool:
    artist_name = str(payload.get("artist") or "").strip()
    if not artist_name:
        return True

    if has_inflight_acquisition_for_artist(artist_name):
        return False

    queue_process_new_content_if_needed(artist_name, force=True)
    return True


def process_domain_events(*, limit: int = 100) -> dict[str, int]:
    """Consume a small batch of domain events and warm affected snapshots."""
    events = list_domain_events(limit=max(1, min(limit, 1000)), unprocessed_only=True)
    if not events:
        return {"processed": 0, "ops_refreshes": 0, "home_refreshes": 0}

    refresh_ops = False
    refresh_home_users: set[int] = set()
    event_ids: list = []

    for event in events:
        event_type = event.get("event_type")
        scope = event.get("scope") or ""
        payload = event.get("payload_json") or {}

        if event_type in _OPS_EVENT_TYPES or scope.startswith("pipeline:") or scope == "ops":
            refresh_ops = True

        if event_type == "library.acquisition.completed":
            try:
                if not _queue_post_acquisition_processing(payload):
                    continue
            except Exception:
                log.debug("Failed to queue post-acquisition processing", exc_info=True)

        event_ids.append(event["id"])

        if scope == "home:discovery":
            try:
                refresh_home_users.add(int(event.get("subject_key")))
            except (TypeError, ValueError):
                pass
        elif event_type in _HOME_EVENT_TYPES:
            try:
                refresh_home_users.add(int(payload.get("user_id") or event.get("subject_key")))
            except (TypeError, ValueError, AttributeError):
                pass
        elif scope == "ui.invalidate":
            invalidation_scope = str(payload.get("scope") or event.get("subject_key") or "")
            if _refreshes_ops_from_invalidation(invalidation_scope):
                refresh_ops = True
            if invalidation_scope.startswith("home:user:"):
                try:
                    refresh_home_users.add(int(invalidation_scope.split(":")[-1]))
                except (TypeError, ValueError):
                    pass

    ops_refreshes = 0
    home_refreshes = 0

    if refresh_ops:
        get_cached_ops_snapshot(fresh=True)
        ops_refreshes = 1

    for user_id in sorted(refresh_home_users):
        get_cached_home_discovery(user_id, fresh=True)
        home_refreshes += 1

    if event_ids:
        mark_domain_events_processed(event_ids)
    log.debug(
        "Processed %d domain events (ops=%d, home=%d)",
        len(event_ids),
        ops_refreshes,
        home_refreshes,
    )
    return {
        "processed": len(event_ids),
        "ops_refreshes": ops_refreshes,
        "home_refreshes": home_refreshes,
    }
