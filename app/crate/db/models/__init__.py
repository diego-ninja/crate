"""Typed output models for the Crate data layer.

These replace the raw ``dict`` returns from ``db/*.py`` functions with
Pydantic v2 models, giving consumers compile-time key safety, IDE
autocomplete, and automatic JSON serialization.

Adoption is gradual: as each db module is touched, its return types
migrate from ``dict | None`` to the appropriate model. Callers that
still destructure by key keep working (Pydantic models support
``model["key"]`` via ``model_config = ConfigDict(from_attributes=True)``
and ``.model_dump()`` for dict conversion).

Naming convention: ``{Domain}Row`` for single-row returns (maps to one
DB row), ``{Domain}Summary`` for projected/aggregated shapes.
"""

from crate.db.models.genre import GenreDetail, GenreRow
from crate.db.models.library import AlbumRow, ArtistRow, LibraryStats, TrackRow
from crate.db.models.playlist import PlaylistRow, PlaylistSummary, PlaylistTrackRow
from crate.db.models.settings import SettingRow
from crate.db.models.task import ScanResultRow, TaskRow, TaskSummary
from crate.db.models.user import AuthInviteRow, SessionRow, UserRow

__all__ = [
    # Genre
    "GenreDetail",
    "GenreRow",
    # Library
    "AlbumRow",
    "ArtistRow",
    "LibraryStats",
    "TrackRow",
    # Playlist
    "PlaylistRow",
    "PlaylistSummary",
    "PlaylistTrackRow",
    # Settings
    "SettingRow",
    # Task
    "ScanResultRow",
    "TaskRow",
    "TaskSummary",
    # User / Auth
    "AuthInviteRow",
    "SessionRow",
    "UserRow",
]
