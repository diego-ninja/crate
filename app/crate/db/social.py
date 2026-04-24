"""Legacy compatibility shim for social access.

New runtime code should import from ``crate.db.repositories.social`` for
mutations/composed operations and ``crate.db.queries.social`` for read-only
queries. This module remains only to keep the deprecated compat surface and
older tests/scripts working while the backend migration finishes.
"""

from crate.db.queries.social import (
    get_followers,
    get_following,
    get_public_playlists_for_user,
    get_public_user_profile,
    get_public_user_profile_by_username,
    get_relationship_state,
    search_users,
)
from crate.db.repositories.social import (
    follow_user,
    get_affinity,
    get_me_social,
    unfollow_user,
)

__all__ = [
    "follow_user",
    "get_affinity",
    "get_followers",
    "get_following",
    "get_me_social",
    "get_public_playlists_for_user",
    "get_public_user_profile",
    "get_public_user_profile_by_username",
    "get_relationship_state",
    "search_users",
    "unfollow_user",
]
