"""Database queries for library_sync — filesystem to DB synchronization."""

from crate.db.tx import transaction_scope
from sqlalchemy import text


def get_album_track_count(album_id: int) -> int:
    """Count actual library_tracks rows for an album."""
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT COUNT(*) AS cnt FROM library_tracks WHERE album_id = :album_id"),
            {"album_id": album_id},
        ).mappings().first()
        return int(row["cnt"] or 0)


def get_album_id_by_path(path: str) -> int | None:
    """Return album ID by path, or None."""
    with transaction_scope() as session:
        row = session.execute(
            text("SELECT id FROM library_albums WHERE path = :path"),
            {"path": path},
        ).mappings().first()
        return row["id"] if row else None


def get_tracks_by_album_id(album_id: int) -> dict[str, dict]:
    """Return existing tracks keyed by path for an album."""
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT * FROM library_tracks WHERE album_id = :album_id"),
            {"album_id": album_id},
        ).mappings().all()
        return {r["path"]: dict(r) for r in rows}


def delete_track_by_path(path: str):
    """Delete a single track by path."""
    with transaction_scope() as session:
        session.execute(text("DELETE FROM library_tracks WHERE path = :path"), {"path": path})


def get_all_artist_names_and_counts() -> list[dict]:
    """Return all artists with name, album_count, track_count."""
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT name, album_count, track_count FROM library_artists")
        ).mappings().all()
        return [dict(row) for row in rows]


def merge_artist_into(source: str, target: str):
    """Move all albums and tracks from source artist to target, then delete source."""
    with transaction_scope() as session:
        conflicts = session.execute(text("""
            SELECT s.id AS source_id, t.id AS target_id
            FROM library_albums s
            JOIN library_albums t ON LOWER(s.name) = LOWER(t.name) AND t.artist = :target
            WHERE s.artist = :source
        """), {"target": target, "source": source}).mappings().all()

        for c in conflicts:
            session.execute(
                text("UPDATE library_tracks SET album_id = :target_id, artist = :target WHERE album_id = :source_id"),
                {"target_id": c["target_id"], "target": target, "source_id": c["source_id"]},
            )
            session.execute(
                text("DELETE FROM library_albums WHERE id = :id"),
                {"id": c["source_id"]},
            )

        session.execute(text("UPDATE library_albums SET artist = :target WHERE artist = :source"),
                        {"target": target, "source": source})
        session.execute(text("UPDATE library_tracks SET artist = :target WHERE artist = :source"),
                        {"target": target, "source": source})
        session.execute(text("DELETE FROM library_artists WHERE name = :source"),
                        {"source": source})


def get_album_paths_for_artist(artist_name: str) -> list[str]:
    """Return album paths for an artist."""
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT path FROM library_albums WHERE artist = :artist"),
            {"artist": artist_name},
        ).mappings().all()
        return [r["path"] for r in rows]


def get_all_album_paths() -> list[dict]:
    """Return all album paths with artist."""
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT path, artist FROM library_albums")
        ).mappings().all()
        return [dict(row) for row in rows]
