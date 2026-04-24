"""Legacy compatibility shim for show access.

New runtime code should import from ``crate.db.repositories.shows`` for writes
and ``crate.db.queries.shows`` for reads. This module remains only to keep the
deprecated compat surface and older tests/scripts working while the backend
migration finishes.
"""

from crate.db.queries.shows import (
    get_all_shows,
    get_attending_show_ids,
    get_show_cities,
    get_show_countries,
    get_show_reminders,
    get_unique_user_cities,
    get_upcoming_show_counts,
    get_upcoming_shows,
    get_upcoming_shows_near,
)
from crate.db.repositories.shows import (
    attend_show,
    consolidate_show,
    create_show_reminder,
    delete_past_shows,
    unattend_show,
    upsert_show,
)

__all__ = [
    "attend_show",
    "consolidate_show",
    "create_show_reminder",
    "delete_past_shows",
    "get_all_shows",
    "get_attending_show_ids",
    "get_show_cities",
    "get_show_countries",
    "get_show_reminders",
    "get_unique_user_cities",
    "get_upcoming_show_counts",
    "get_upcoming_shows",
    "get_upcoming_shows_near",
    "unattend_show",
    "upsert_show",
]
