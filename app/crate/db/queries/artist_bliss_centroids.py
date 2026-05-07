from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_artist_bliss_centroid(artist_ref: str) -> dict | None:
    if not artist_ref:
        return None

    with read_scope() as session:
        row = session.execute(
            text(
                """
                SELECT
                    c.artist_id,
                    c.artist_name,
                    c.track_count,
                    c.bliss_vector,
                    c.updated_at
                FROM artist_bliss_centroids c
                JOIN library_artists ar ON ar.id = c.artist_id
                WHERE CAST(ar.id AS TEXT) = :artist_ref
                   OR (ar.entity_uid IS NOT NULL AND CAST(ar.entity_uid AS TEXT) = :artist_ref)
                   OR LOWER(ar.name) = LOWER(:artist_ref)
                   OR LOWER(c.artist_name) = LOWER(:artist_ref)
                ORDER BY
                    CASE
                        WHEN CAST(ar.id AS TEXT) = :artist_ref THEN 0
                        WHEN ar.entity_uid IS NOT NULL AND CAST(ar.entity_uid AS TEXT) = :artist_ref THEN 1
                        ELSE 2
                    END
                LIMIT 1
                """
            ),
            {"artist_ref": artist_ref},
        ).mappings().first()

    if not row:
        return None
    data = dict(row)
    data["bliss_vector"] = list(data["bliss_vector"])
    return data


__all__ = ["get_artist_bliss_centroid"]
