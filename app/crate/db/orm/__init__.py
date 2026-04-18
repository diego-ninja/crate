"""SQLAlchemy ORM-mapped table models for Crate.

These are the tables that benefit from ORM treatment — simple CRUD
domains where relationships, identity tracking, and typed access
outweigh the cost of hydration.

Complex query domains (analytics, browse, bliss, tasks claiming with
FOR UPDATE SKIP LOCKED) stay on Core / ``text()`` in ``db/queries/``
and ``db/jobs/``. See the refactor plan for the rationale.
"""

from crate.db.orm.genre import GenreTaxonomyAlias, GenreTaxonomyEdge, GenreTaxonomyNode
from crate.db.orm.health import HealthIssue
from crate.db.orm.releases import NewRelease
from crate.db.orm.settings import Setting
from crate.db.orm.tidal import TidalDownload, TidalMonitoredArtist
from crate.db.orm.user import AuthInvite, Session, User, UserExternalIdentity

__all__ = [
    "AuthInvite",
    "GenreTaxonomyAlias",
    "GenreTaxonomyEdge",
    "GenreTaxonomyNode",
    "HealthIssue",
    "NewRelease",
    "Session",
    "Setting",
    "TidalDownload",
    "TidalMonitoredArtist",
    "User",
    "UserExternalIdentity",
]
