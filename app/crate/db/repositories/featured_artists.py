"""Persistence rules for editorially featured artists."""

from __future__ import annotations

from sqlalchemy import text

from crate.artist_hero_contract import artist_hero_profile_ready_compositions
from crate.db.tx import read_scope, transaction_scope


def set_artist_featured(
    artist_id: int, is_featured: bool, *, session=None
) -> dict | None:
    """Set Featured Artist state after validating the canonical Hero profile."""

    def _write(active_session) -> dict | None:
        row = (
            active_session.execute(
                text(
                    """
                    SELECT artist.id, artist.is_featured,
                           hero.provenance, hero.review_status,
                           hero.source_width, hero.source_height,
                           hero.desktop_source_width,
                           hero.desktop_source_height,
                           hero.mobile_source_width,
                           hero.mobile_source_height,
                           hero.desktop_recipe, hero.mobile_recipe,
                           hero.desktop_enabled, hero.mobile_enabled,
                           hero.revision, hero.render_manifest
                    FROM library_artists artist
                    LEFT JOIN artist_hero_artwork hero
                      ON hero.artist_id = artist.id
                    WHERE artist.id = :artist_id
                    FOR UPDATE OF artist
                    """
                ),
                {"artist_id": artist_id},
            )
            .mappings()
            .first()
        )
        if row is None:
            return None

        ready_compositions = artist_hero_profile_ready_compositions(row)
        if is_featured:
            if not ready_compositions:
                return {
                    "status": "rejected",
                    "reason": "approved_hero_required",
                    "featured_devices": (),
                }

        active_session.execute(
            text(
                """
                UPDATE library_artists
                SET is_featured = :is_featured
                WHERE id = :artist_id
                """
            ),
            {"artist_id": artist_id, "is_featured": is_featured},
        )
        return {
            "status": "updated",
            "is_featured": is_featured,
            "featured_devices": ready_compositions if is_featured else (),
        }

    if session is not None:
        return _write(session)
    with transaction_scope() as active_session:
        return _write(active_session)


def get_artist_featured_state(artist_id: int, *, session=None) -> dict | None:
    def _read(active_session) -> dict | None:
        row = (
            active_session.execute(
                text(
                    """
                    SELECT id, is_featured
                    FROM library_artists
                    WHERE id = :artist_id
                    """
                ),
                {"artist_id": artist_id},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    if session is not None:
        return _read(session)
    with read_scope() as active_session:
        return _read(active_session)


def clear_featured_if_not_ready(artist_id: int, *, session=None) -> bool:
    """Remove Featured Artist state when no approved canonical hero remains."""

    def _write(active_session) -> bool:
        row = (
            active_session.execute(
                text(
                    """
                    SELECT artist.id, artist.is_featured,
                           hero.provenance, hero.review_status,
                           hero.source_width, hero.source_height,
                           hero.desktop_source_width,
                           hero.desktop_source_height,
                           hero.mobile_source_width,
                           hero.mobile_source_height,
                           hero.desktop_recipe, hero.mobile_recipe,
                           hero.desktop_enabled, hero.mobile_enabled,
                           hero.revision, hero.render_manifest
                    FROM library_artists artist
                    LEFT JOIN artist_hero_artwork hero
                      ON hero.artist_id = artist.id
                    WHERE artist.id = :artist_id
                    FOR UPDATE OF artist
                    """
                ),
                {"artist_id": artist_id},
            )
            .mappings()
            .first()
        )
        if row is None or not row["is_featured"]:
            return False
        if artist_hero_profile_ready_compositions(row):
            return False
        active_session.execute(
            text(
                """
                UPDATE library_artists
                SET is_featured = FALSE
                WHERE id = :artist_id
                """
            ),
            {"artist_id": artist_id},
        )
        return True

    if session is not None:
        return _write(session)
    with transaction_scope() as active_session:
        return _write(active_session)
