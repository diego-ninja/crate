from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal


RepairSupport = Literal["automatic", "manual", "scan_only"]
RepairRisk = Literal["safe", "caution", "destructive"]
RepairScope = Literal["db", "filesystem", "hybrid"]


@dataclass(frozen=True)
class RepairCatalogEntry:
    check_type: str
    scanner_method: str
    fixer_method: str | None
    support: RepairSupport
    risk: RepairRisk
    scope: RepairScope
    requires_confirmation: bool = False
    supports_batch: bool = True
    supports_artist_scope: bool = True
    supports_global_scope: bool = True

    @property
    def auto_fixable(self) -> bool:
        return self.support == "automatic" and bool(self.fixer_method)

    @property
    def globally_runnable(self) -> bool:
        return self.auto_fixable and self.supports_global_scope


REPAIR_CATALOG: tuple[RepairCatalogEntry, ...] = (
    RepairCatalogEntry(
        "duplicate_folders",
        "_check_duplicate_folders",
        "_fix_duplicate_folders",
        "automatic",
        "caution",
        "filesystem",
        requires_confirmation=True,
        supports_global_scope=False,
    ),
    RepairCatalogEntry(
        "canonical_mismatch",
        "_check_canonical_mismatch",
        "_fix_canonical_mismatch",
        "automatic",
        "caution",
        "hybrid",
        requires_confirmation=True,
        supports_global_scope=False,
    ),
    RepairCatalogEntry(
        "artist_layout_fix",
        "_check_artist_layout_fix",
        "_fix_artist_layout",
        "automatic",
        "caution",
        "hybrid",
        requires_confirmation=True,
        supports_global_scope=False,
    ),
    RepairCatalogEntry(
        "fk_orphan_albums",
        "_check_fk_orphan_albums",
        "_fix_fk_orphans",
        "automatic",
        "destructive",
        "db",
        requires_confirmation=True,
        supports_global_scope=False,
    ),
    RepairCatalogEntry(
        "fk_orphan_tracks",
        "_check_fk_orphan_tracks",
        "_fix_fk_orphan_tracks",
        "automatic",
        "destructive",
        "db",
        requires_confirmation=True,
        supports_global_scope=False,
    ),
    RepairCatalogEntry(
        "stale_artists",
        "_check_stale_artists",
        "_fix_stale_entries",
        "automatic",
        "caution",
        "db",
        requires_confirmation=True,
        supports_global_scope=False,
    ),
    RepairCatalogEntry(
        "stale_albums",
        "_check_stale_albums",
        "_fix_stale_albums",
        "automatic",
        "caution",
        "db",
        requires_confirmation=True,
        supports_global_scope=False,
    ),
    RepairCatalogEntry(
        "stale_tracks",
        "_check_stale_tracks",
        "_fix_stale_tracks",
        "automatic",
        "safe",
        "db",
    ),
    RepairCatalogEntry(
        "zombie_artists",
        "_check_zombie_artists",
        "_fix_zombie_artists",
        "automatic",
        "caution",
        "db",
        requires_confirmation=True,
        supports_global_scope=False,
    ),
    RepairCatalogEntry(
        "has_photo_desync",
        "_check_has_photo_desync",
        "_fix_has_photo_desync",
        "automatic",
        "safe",
        "db",
    ),
    RepairCatalogEntry(
        "duplicate_albums",
        "_check_duplicate_albums",
        "_fix_duplicate_albums",
        "automatic",
        "destructive",
        "hybrid",
        requires_confirmation=True,
        supports_global_scope=False,
    ),
    RepairCatalogEntry(
        "duplicate_tracks",
        "_check_duplicate_tracks",
        "_fix_duplicate_tracks",
        "automatic",
        "destructive",
        "hybrid",
        requires_confirmation=True,
        supports_global_scope=False,
    ),
    RepairCatalogEntry(
        "unindexed_files",
        "_check_unindexed_files",
        "_fix_unindexed_files",
        "automatic",
        "caution",
        "hybrid",
        requires_confirmation=True,
        supports_global_scope=False,
    ),
    RepairCatalogEntry(
        "tag_mismatch",
        "_check_tag_mismatch",
        "_fix_tag_mismatch",
        "automatic",
        "safe",
        "db",
    ),
    RepairCatalogEntry(
        "folder_naming",
        "_check_folder_naming",
        "_fix_folder_naming",
        "automatic",
        "caution",
        "filesystem",
        requires_confirmation=True,
        supports_global_scope=False,
    ),
    RepairCatalogEntry(
        "missing_cover",
        "_check_missing_covers",
        "_fix_missing_cover",
        "automatic",
        "safe",
        "filesystem",
    ),
)

REPAIR_CATALOG_BY_CHECK: dict[str, RepairCatalogEntry] = {
    entry.check_type: entry for entry in REPAIR_CATALOG
}


def repair_catalog_payload() -> list[dict[str, str | bool | None]]:
    return [
        {
            **asdict(entry),
            "auto_fixable": entry.auto_fixable,
        }
        for entry in REPAIR_CATALOG
    ]


__all__ = [
    "REPAIR_CATALOG",
    "REPAIR_CATALOG_BY_CHECK",
    "RepairCatalogEntry",
    "repair_catalog_payload",
]
