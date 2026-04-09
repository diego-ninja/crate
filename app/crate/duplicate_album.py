"""Classify and resolve duplicate album folders.

Context: a common pathology in the library is having the same album under
two directories — a loose folder at ``/Artist/AlbumName`` plus a canonical
entry under ``/Artist/YYYY/AlbumName``. The health check surfaces the loose
copy as an ``unindexed_files`` issue, but calling sync_artist on it fails
with a UNIQUE(artist, name) conflict against the already-indexed canonical
album.

This module provides:

 - :func:`classify_duplicate_album` — decides what to do with a suspected
   loose duplicate directory (delete / merge / promote / leave for manual
   review).
 - :func:`apply_duplicate_resolution` — executes the decision on disk and
   returns a structured result dict the repair pipeline can log.

The classification is based on normalized track title comparison, not file
hashes: filenames and encoders differ between duplicates (one folder has
``01. Song.flac`` while the other has ``Song.flac``), so track-title
matching is the most reliable signal.
"""

from __future__ import annotations

import logging
import re
import shutil
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

from crate.audio import read_tags
from crate.utils import AUDIO_EXTENSIONS

log = logging.getLogger(__name__)

_TRACK_NUM_PREFIX_RE = re.compile(r"^\s*\d{1,3}\s*[\.\-_)\s]+\s*")
_PUNCT_RE = re.compile(r"[^\w\s]")
_WS_RE = re.compile(r"\s+")
_YEAR_PREFIX_RE = re.compile(r"^\d{4}\s*[-–]\s*(.+)$")


@dataclass(frozen=True)
class AlbumTrack:
    path: Path
    title_key: str  # normalized title for matching
    size: int
    raw_title: str


@dataclass
class AlbumComparison:
    loose: list[AlbumTrack]
    canonical: list[AlbumTrack]
    loose_only: set[str] = field(default_factory=set)
    canonical_only: set[str] = field(default_factory=set)
    common: set[str] = field(default_factory=set)

    @property
    def loose_is_subset(self) -> bool:
        """All loose titles are present in canonical (with at least one common)."""
        return bool(self.loose) and not self.loose_only and bool(self.common)

    @property
    def canonical_is_subset(self) -> bool:
        """All canonical titles are present in loose (with at least one common)."""
        return bool(self.canonical) and not self.canonical_only and bool(self.common)

    @property
    def identical(self) -> bool:
        return self.loose_is_subset and self.canonical_is_subset

    @property
    def disjoint(self) -> bool:
        return not self.common


@dataclass
class DuplicateVerdict:
    action: str  # "delete_loose" | "merge_into_canonical" | "promote_loose" | "manual"
    canonical_dir: Optional[Path]
    loose_dir: Path
    reason: str
    comparison: AlbumComparison


def _normalize_title(title: str) -> str:
    """Aggressive title normalization so `01. Song Name` == `song name`."""
    if not title:
        return ""
    t = unicodedata.normalize("NFKC", title).casefold().strip()
    t = _TRACK_NUM_PREFIX_RE.sub("", t)
    t = _PUNCT_RE.sub(" ", t)
    t = _WS_RE.sub(" ", t).strip()
    return t


def _strip_trailing_parens(name: str) -> str:
    """Drop trailing parenthetical like ``(TRUST Edition)`` or ``(Remastered)``."""
    return re.sub(r"\s*[\(\[].*?[\)\]]\s*$", "", name).strip()


def _normalize_album_name(name: str) -> str:
    """Normalize an album folder name for sibling matching."""
    n = unicodedata.normalize("NFKC", name)
    m = _YEAR_PREFIX_RE.match(n)
    if m:
        n = m.group(1)
    n = re.sub(r"[®™©]", "", n)
    n = _PUNCT_RE.sub(" ", n)
    n = _WS_RE.sub(" ", n).strip().casefold()
    return n


def _read_album_tracks(album_dir: Path) -> list[AlbumTrack]:
    """Return one ``AlbumTrack`` per audio file in ``album_dir``.

    If tags can't be read, falls back to the filename stem.
    """
    tracks: list[AlbumTrack] = []
    if not album_dir.is_dir():
        return tracks
    for f in sorted(album_dir.iterdir()):
        if not f.is_file() or f.suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        tags = read_tags(f)
        raw_title = tags.get("title") or f.stem
        title_key = _normalize_title(raw_title)
        if not title_key:
            title_key = _normalize_title(f.stem)
        try:
            size = f.stat().st_size
        except OSError:
            size = 0
        tracks.append(AlbumTrack(path=f, title_key=title_key, size=size, raw_title=raw_title))
    return tracks


def _compare_albums(loose_dir: Path, canonical_dir: Path) -> AlbumComparison:
    loose_tracks = _read_album_tracks(loose_dir)
    canonical_tracks = _read_album_tracks(canonical_dir)
    loose_keys = {t.title_key for t in loose_tracks if t.title_key}
    canonical_keys = {t.title_key for t in canonical_tracks if t.title_key}
    return AlbumComparison(
        loose=loose_tracks,
        canonical=canonical_tracks,
        loose_only=loose_keys - canonical_keys,
        canonical_only=canonical_keys - loose_keys,
        common=loose_keys & canonical_keys,
    )


def _find_sibling_candidates(loose_dir: Path, library_path: Path) -> Iterable[Path]:
    """Yield year-subdir albums under the same artist that could be the
    canonical twin of ``loose_dir``.

    Only candidates whose normalized name matches the loose folder's
    normalized name are returned. Year subdirectories (4-digit names) are
    scanned because the canonical layout is ``Artist/YYYY/AlbumName``.
    """
    try:
        rel = loose_dir.relative_to(library_path)
    except ValueError:
        return []
    parts = rel.parts
    if len(parts) < 2:
        return []
    artist_dir = library_path / parts[0]
    if not artist_dir.is_dir():
        return []

    loose_key = _normalize_album_name(loose_dir.name)
    loose_key_stripped = _normalize_album_name(_strip_trailing_parens(loose_dir.name))
    candidates: list[Path] = []
    for child in sorted(artist_dir.iterdir()):
        if not child.is_dir():
            continue
        if child == loose_dir:
            continue
        # Canonical structure: year subdir
        if re.fullmatch(r"\d{4}", child.name):
            for grand in sorted(child.iterdir()):
                if grand.is_dir() and grand != loose_dir:
                    gkey = _normalize_album_name(grand.name)
                    if gkey and (gkey == loose_key or gkey == loose_key_stripped):
                        candidates.append(grand)
        else:
            # Sibling loose folder (pattern C: unicode variant of same name)
            ckey = _normalize_album_name(child.name)
            if ckey and (ckey == loose_key or ckey == loose_key_stripped):
                candidates.append(child)
    return candidates


def classify_duplicate_album(loose_dir: Path, library_path: Path) -> DuplicateVerdict:
    """Decide what to do with ``loose_dir`` given the rest of the library.

    Returns a verdict describing the suggested action. Callers should then
    call :func:`apply_duplicate_resolution` to execute it.
    """
    empty_cmp = AlbumComparison(loose=[], canonical=[])

    candidates = list(_find_sibling_candidates(loose_dir, library_path))
    if not candidates:
        return DuplicateVerdict(
            action="manual",
            canonical_dir=None,
            loose_dir=loose_dir,
            reason="no canonical sibling with matching normalized name",
            comparison=empty_cmp,
        )

    loose_key = _normalize_album_name(loose_dir.name)

    # Prefer, in order:
    #  1) Exact normalized-name match (so "Group Sex (TRUST Edition)" beats
    #     "Group Sex" when both are siblings of the loose "Group Sex
    #     (TRUST Edition)" folder).
    #  2) Candidates already under a year subdir (organized).
    #  3) Candidates with more audio files (better-populated album).
    def rank(c: Path) -> tuple[int, int, int]:
        exact = 0 if _normalize_album_name(c.name) == loose_key else 1
        year_bucket = 0 if re.fullmatch(r"\d{4}", c.parent.name) else 1
        audio_count = sum(
            1 for f in c.iterdir() if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS
        )
        return (exact, year_bucket, -audio_count)

    candidates.sort(key=rank)
    canonical = candidates[0]

    comparison = _compare_albums(loose_dir, canonical)

    if not comparison.loose:
        return DuplicateVerdict(
            action="manual",
            canonical_dir=canonical,
            loose_dir=loose_dir,
            reason="loose folder has no readable audio tracks",
            comparison=comparison,
        )

    if comparison.disjoint:
        return DuplicateVerdict(
            action="manual",
            canonical_dir=canonical,
            loose_dir=loose_dir,
            reason=(
                "loose and canonical share no track titles — likely distinct "
                "releases (edition/remix/live) that need a manual decision"
            ),
            comparison=comparison,
        )

    if comparison.identical:
        return DuplicateVerdict(
            action="delete_loose",
            canonical_dir=canonical,
            loose_dir=loose_dir,
            reason="identical track list — loose folder is redundant",
            comparison=comparison,
        )

    if comparison.loose_is_subset:
        return DuplicateVerdict(
            action="delete_loose",
            canonical_dir=canonical,
            loose_dir=loose_dir,
            reason="loose tracks are a subset of the canonical album",
            comparison=comparison,
        )

    if comparison.canonical_is_subset:
        # Loose has MORE tracks than canonical — copy the missing ones over
        # rather than promoting the loose folder (we don't want to rewrite
        # the DB path).
        return DuplicateVerdict(
            action="merge_into_canonical",
            canonical_dir=canonical,
            loose_dir=loose_dir,
            reason="loose folder has extra tracks missing from the canonical album",
            comparison=comparison,
        )

    # Partial overlap both ways — leave for manual review.
    return DuplicateVerdict(
        action="manual",
        canonical_dir=canonical,
        loose_dir=loose_dir,
        reason=(
            f"partial overlap: {len(comparison.common)} shared, "
            f"{len(comparison.loose_only)} loose-only, "
            f"{len(comparison.canonical_only)} canonical-only"
        ),
        comparison=comparison,
    )


def apply_duplicate_resolution(verdict: DuplicateVerdict, *, dry_run: bool = False) -> dict:
    """Execute ``verdict`` on disk. Returns a dict describing what happened."""
    result: dict = {
        "action": verdict.action,
        "loose": str(verdict.loose_dir),
        "canonical": str(verdict.canonical_dir) if verdict.canonical_dir else None,
        "reason": verdict.reason,
        "applied": False,
        "fs_write": False,
        "loose_tracks": len(verdict.comparison.loose),
        "canonical_tracks": len(verdict.comparison.canonical),
        "common_tracks": len(verdict.comparison.common),
    }

    if verdict.action == "manual":
        return result

    if verdict.action == "delete_loose":
        result["fs_write"] = True
        if not dry_run:
            shutil.rmtree(str(verdict.loose_dir))
            log.info("Deleted duplicate loose folder: %s", verdict.loose_dir)
            result["applied"] = True
        return result

    if verdict.action == "merge_into_canonical":
        assert verdict.canonical_dir is not None  # narrow type
        result["fs_write"] = True
        moved: list[str] = []
        if not dry_run:
            # Copy each loose-only track into the canonical dir, then remove
            # the loose folder.
            loose_keys_only = verdict.comparison.loose_only
            for track in verdict.comparison.loose:
                if track.title_key in loose_keys_only:
                    dest = verdict.canonical_dir / track.path.name
                    if dest.exists():
                        # Fall back to a numbered suffix so we never clobber.
                        base = dest.stem
                        ext = dest.suffix
                        counter = 2
                        while dest.exists():
                            dest = verdict.canonical_dir / f"{base} ({counter}){ext}"
                            counter += 1
                    shutil.move(str(track.path), str(dest))
                    moved.append(dest.name)
            shutil.rmtree(str(verdict.loose_dir))
            log.info(
                "Merged %d tracks from %s into %s",
                len(moved),
                verdict.loose_dir,
                verdict.canonical_dir,
            )
            result["applied"] = True
            result["moved"] = moved
        return result

    # Unknown action — shouldn't reach here but fail safe.
    result["reason"] = f"unsupported action: {verdict.action}"
    return result
