"""Persistence for editorial artist-hero artwork profiles."""

from __future__ import annotations

import json
from collections.abc import Mapping

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope


def get_artist_hero_artwork(artist_id: int, *, session=None) -> dict | None:
    def _read(active_session) -> dict | None:
        row = (
            active_session.execute(
                text(
                    """
                    SELECT artist_id, provenance, review_status, source_width,
                           source_height, desktop_source_width,
                           desktop_source_height, desktop_source_origin,
                           mobile_source_width, mobile_source_height,
                           mobile_source_origin, desktop_recipe, mobile_recipe,
                           desktop_enabled, mobile_enabled, revision,
                           render_manifest, updated_at
                    FROM artist_hero_artwork
                    WHERE artist_id = :artist_id
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


def upsert_artist_hero_artwork(
    *,
    artist_id: int,
    provenance: str,
    review_status: str,
    source_width: int,
    source_height: int,
    desktop_recipe: dict,
    mobile_recipe: dict,
    revision: str,
    desktop_source_width: int | None = None,
    desktop_source_height: int | None = None,
    desktop_source_origin: str | None = None,
    mobile_source_width: int | None = None,
    mobile_source_height: int | None = None,
    mobile_source_origin: str | None = None,
    desktop_enabled: bool | None = None,
    mobile_enabled: bool | None = None,
    render_manifest: dict | None = None,
    expected_revision: str | None = None,
    session=None,
) -> bool:
    def _record_render_manifest_history(
        active_session, manifest: Mapping[str, object] | None
    ) -> None:
        if not isinstance(manifest, Mapping):
            return
        artifacts = manifest.get("artifacts")
        if not isinstance(artifacts, Mapping):
            return
        editorial_revision = str(manifest.get("editorial_revision") or "")
        for composition in ("desktop", "mobile"):
            artifact = artifacts.get(composition)
            if not isinstance(artifact, Mapping):
                continue
            render_revision = str(artifact.get("render_revision") or "")
            if not render_revision:
                continue
            metadata = {
                "editorial_revision": editorial_revision,
                "renderer_version": str(artifact.get("renderer_version") or ""),
                "source_fingerprint": str(artifact.get("source_fingerprint") or ""),
                "recipe_hash": str(artifact.get("recipe_hash") or ""),
                "relative_path": str(artifact.get("relative_path") or ""),
            }
            existing = (
                active_session.execute(
                    text(
                        """
                        SELECT editorial_revision, renderer_version,
                               source_fingerprint, recipe_hash, relative_path
                        FROM artist_hero_render_revisions
                        WHERE artist_id = :artist_id
                          AND composition = :composition
                          AND render_revision = :render_revision
                        FOR UPDATE
                        """
                    ),
                    {
                        "artist_id": artist_id,
                        "composition": composition,
                        "render_revision": render_revision,
                    },
                )
                .mappings()
                .first()
            )
            if existing is not None:
                if any(existing[key] != value for key, value in metadata.items()):
                    raise ValueError(
                        "Artist hero render revision metadata conflict: "
                        f"{artist_id}:{composition}:{render_revision}"
                    )
                continue
            active_session.execute(
                text(
                    """
                    INSERT INTO artist_hero_render_revisions (
                        artist_id, composition, render_revision,
                        editorial_revision, renderer_version,
                        source_fingerprint, recipe_hash, relative_path
                    ) VALUES (
                        :artist_id, :composition, :render_revision,
                        :editorial_revision, :renderer_version,
                        :source_fingerprint, :recipe_hash, :relative_path
                    )
                    """
                ),
                {
                    "artist_id": artist_id,
                    "composition": composition,
                    "render_revision": render_revision,
                    **metadata,
                },
            )

    def _write(active_session) -> bool:
        if expected_revision is not None:
            current = (
                active_session.execute(
                    text(
                        """
                        SELECT revision
                        FROM artist_hero_artwork
                        WHERE artist_id = :artist_id
                        FOR UPDATE
                        """
                    ),
                    {"artist_id": artist_id},
                )
                .mappings()
                .first()
            )
            if current is None or current["revision"] != expected_revision:
                return False

        active_session.execute(
            text(
                """
                INSERT INTO artist_hero_artwork (
                    artist_id, provenance, review_status, source_width,
                    source_height, desktop_source_width,
                    desktop_source_height, desktop_source_origin,
                    mobile_source_width, mobile_source_height,
                    mobile_source_origin, desktop_recipe, mobile_recipe,
                    desktop_enabled, mobile_enabled, revision,
                    render_manifest, updated_at
                ) VALUES (
                    :artist_id, :provenance, :review_status, :source_width,
                    :source_height, :desktop_source_width,
                    :desktop_source_height, :desktop_source_origin,
                    :mobile_source_width, :mobile_source_height,
                    :mobile_source_origin, CAST(:desktop_recipe AS JSONB),
                    CAST(:mobile_recipe AS JSONB),
                    COALESCE(
                        :desktop_enabled,
                        (SELECT desktop_enabled FROM artist_hero_artwork
                         WHERE artist_id = :artist_id),
                        TRUE
                    ),
                    COALESCE(
                        :mobile_enabled,
                        (SELECT mobile_enabled FROM artist_hero_artwork
                         WHERE artist_id = :artist_id),
                        TRUE
                    ),
                    :revision,
                    COALESCE(
                        CAST(:render_manifest AS JSONB),
                        (SELECT render_manifest FROM artist_hero_artwork
                         WHERE artist_id = :artist_id)
                    ),
                    NOW()
                )
                ON CONFLICT (artist_id) DO UPDATE SET
                    provenance = EXCLUDED.provenance,
                    review_status = EXCLUDED.review_status,
                    source_width = EXCLUDED.source_width,
                    source_height = EXCLUDED.source_height,
                    desktop_source_width = EXCLUDED.desktop_source_width,
                    desktop_source_height = EXCLUDED.desktop_source_height,
                    desktop_source_origin = EXCLUDED.desktop_source_origin,
                    mobile_source_width = EXCLUDED.mobile_source_width,
                    mobile_source_height = EXCLUDED.mobile_source_height,
                    mobile_source_origin = EXCLUDED.mobile_source_origin,
                    desktop_recipe = EXCLUDED.desktop_recipe,
                    mobile_recipe = EXCLUDED.mobile_recipe,
                    desktop_enabled = EXCLUDED.desktop_enabled,
                    mobile_enabled = EXCLUDED.mobile_enabled,
                    revision = EXCLUDED.revision,
                    render_manifest = EXCLUDED.render_manifest,
                    updated_at = NOW()
                """
            ),
            {
                "artist_id": artist_id,
                "provenance": provenance,
                "review_status": review_status,
                "source_width": source_width,
                "source_height": source_height,
                "desktop_source_width": desktop_source_width,
                "desktop_source_height": desktop_source_height,
                "desktop_source_origin": desktop_source_origin,
                "mobile_source_width": mobile_source_width,
                "mobile_source_height": mobile_source_height,
                "mobile_source_origin": mobile_source_origin,
                "desktop_enabled": desktop_enabled,
                "mobile_enabled": mobile_enabled,
                "desktop_recipe": json.dumps(desktop_recipe),
                "mobile_recipe": json.dumps(mobile_recipe),
                "revision": revision,
                "render_manifest": (
                    json.dumps(render_manifest) if render_manifest is not None else None
                ),
            },
        )
        _record_render_manifest_history(active_session, render_manifest)
        return True

    if session is not None:
        return _write(session)
    with transaction_scope() as active_session:
        return _write(active_session)


def list_artist_hero_render_revisions(
    artist_id: int, *, composition: str | None = None, session=None
) -> list[dict]:
    if composition is not None and composition not in {"desktop", "mobile"}:
        raise ValueError("Invalid artist hero composition")

    def _read(active_session) -> list[dict]:
        rows = (
            active_session.execute(
                text(
                    """
                    SELECT artist_id, composition, render_revision,
                           editorial_revision, renderer_version,
                           source_fingerprint, recipe_hash, relative_path,
                           created_at
                    FROM artist_hero_render_revisions
                    WHERE artist_id = :artist_id
                      AND (:composition IS NULL OR composition = :composition)
                    ORDER BY composition, created_at DESC, render_revision DESC
                    """
                ),
                {"artist_id": artist_id, "composition": composition},
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]

    if session is not None:
        return _read(session)
    with read_scope() as active_session:
        return _read(active_session)


def list_artist_hero_render_revision_artists(*, limit: int = 1000) -> list[dict]:
    capped_limit = max(1, min(int(limit), 10_000))
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT DISTINCT artist.id AS artist_id, artist.entity_uid
                    FROM artist_hero_render_revisions history
                    JOIN library_artists artist ON artist.id = history.artist_id
                    WHERE artist.entity_uid IS NOT NULL
                    ORDER BY artist.id
                    LIMIT :limit
                    """
                ),
                {"limit": capped_limit},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def update_artist_hero_review_status(
    artist_id: int, review_status: str, *, session=None
) -> bool:
    def _write(active_session) -> bool:
        result = active_session.execute(
            text(
                """
                UPDATE artist_hero_artwork
                SET review_status = :review_status,
                    revision = SUBSTRING(
                        MD5(
                            revision || ':' || :review_status || ':' ||
                            clock_timestamp()::text
                        ),
                        1,
                        16
                    ),
                    updated_at = NOW()
                WHERE artist_id = :artist_id
                """
            ),
            {"artist_id": artist_id, "review_status": review_status},
        )
        if result.rowcount > 0:
            from crate.db.repositories.featured_artists import (
                clear_featured_if_not_ready,
            )

            clear_featured_if_not_ready(artist_id, session=active_session)
        return result.rowcount > 0

    if session is not None:
        return _write(session)
    with transaction_scope() as active_session:
        return _write(active_session)


def delete_artist_hero_composition(
    artist_id: int, composition: str, *, session=None
) -> dict | None:
    """Disable one persisted composition and update Featured eligibility."""

    if composition not in {"desktop", "mobile"}:
        raise ValueError("Invalid artist hero composition")

    other = "mobile" if composition == "desktop" else "desktop"
    enabled_column = f"{composition}_enabled"
    width_column = f"{composition}_source_width"
    height_column = f"{composition}_source_height"
    origin_column = f"{composition}_source_origin"

    def _write(active_session) -> dict | None:
        row = (
            active_session.execute(
                text(
                    f"""
                    SELECT {enabled_column}, {other}_enabled
                    FROM artist_hero_artwork
                    WHERE artist_id = :artist_id
                    FOR UPDATE
                    """
                ),
                {"artist_id": artist_id},
            )
            .mappings()
            .first()
        )
        if row is None:
            return None

        active_session.execute(
            text(
                f"""
                UPDATE artist_hero_artwork
                SET {enabled_column} = FALSE,
                    {width_column} = NULL,
                    {height_column} = NULL,
                    {origin_column} = NULL,
                    revision = SUBSTRING(
                        MD5(
                            revision || ':delete:{composition}:' ||
                            clock_timestamp()::text
                        ), 1, 16
                    ),
                    updated_at = NOW()
                WHERE artist_id = :artist_id
                """
            ),
            {"artist_id": artist_id},
        )

        from crate.db.repositories.featured_artists import (
            clear_featured_if_not_ready,
        )

        clear_featured_if_not_ready(artist_id, session=active_session)
        return {"remaining_compositions": [other] if row[f"{other}_enabled"] else []}

    if session is not None:
        return _write(session)
    with transaction_scope() as active_session:
        return _write(active_session)


def list_artist_hero_backfill_candidates(
    *, after_id: int = 0, limit: int = 25
) -> list[dict]:
    capped_limit = max(1, min(int(limit), 100))
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT artist.id, artist.name, artist.entity_uid
                    FROM library_artists artist
                    LEFT JOIN artist_hero_artwork hero
                      ON hero.artist_id = artist.id
                    WHERE artist.id > :after_id
                      AND artist.name NOT LIKE '.%'
                      AND COALESCE(artist.folder_name, '') NOT LIKE '.%'
                      AND (hero.artist_id IS NULL OR hero.provenance <> 'manual')
                    ORDER BY artist.id
                    LIMIT :limit
                    """
                ),
                {"after_id": max(0, int(after_id)), "limit": capped_limit},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def list_artist_hero_migration_candidates(
    *, after_id: int = 0, limit: int = 25
) -> list[dict]:
    """List approved manual heroes eligible for the publication canary."""

    capped_limit = max(1, min(int(limit), 100))
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT artist.id, artist.name, artist.entity_uid
                    FROM library_artists artist
                    JOIN artist_hero_artwork hero ON hero.artist_id = artist.id
                    WHERE artist.id > :after_id
                      AND artist.name NOT LIKE '.%'
                      AND COALESCE(artist.folder_name, '') NOT LIKE '.%'
                      AND hero.provenance = 'manual'
                      AND hero.review_status = 'approved'
                    ORDER BY artist.id
                    LIMIT :limit
                    """
                ),
                {"after_id": max(0, int(after_id)), "limit": capped_limit},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]
