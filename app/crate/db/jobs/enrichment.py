"""DB functions for enrichment worker handlers."""

from crate.db.tx import transaction_scope
from sqlalchemy import text


def get_albums_without_mbid() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT * FROM library_albums WHERE musicbrainz_albumid IS NULL OR musicbrainz_albumid = ''")
        ).mappings().all()
        return [dict(row) for row in rows]


def update_album_mbid(album_id: int, mbid: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET musicbrainz_albumid = :mbid WHERE id = :id"),
            {"mbid": mbid, "id": album_id},
        )


def update_album_release_group_id(album_id: int, release_group_id: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET musicbrainz_releasegroupid = :rgid WHERE id = :id"),
            {"rgid": release_group_id, "id": album_id},
        )


def update_track_mbids(track_id: int, album_mbid: str, track_mbid: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET musicbrainz_albumid = :album_mbid, musicbrainz_trackid = :track_mbid "
                 "WHERE id = :id"),
            {"album_mbid": album_mbid, "track_mbid": track_mbid, "id": track_id},
        )


def persist_album_release_mbids(album_id: int, tracks_db: list[dict], release: dict) -> None:
    release_mbid = release["mbid"]
    release_group_id = release.get("release_group_id", "")
    mb_tracks = release.get("tracks", [])

    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET musicbrainz_albumid = :mbid WHERE id = :id"),
            {"mbid": release_mbid, "id": album_id},
        )
        if release_group_id:
            session.execute(
                text("UPDATE library_albums SET musicbrainz_releasegroupid = :rgid WHERE id = :id"),
                {"rgid": release_group_id, "id": album_id},
            )
        for index, db_track in enumerate(tracks_db):
            if index >= len(mb_tracks):
                break
            track_mbid = mb_tracks[index].get("mbid", "")
            if track_mbid:
                session.execute(
                    text("UPDATE library_tracks SET musicbrainz_albumid = :album_mbid, musicbrainz_trackid = :track_mbid "
                         "WHERE id = :id"),
                    {"album_mbid": release_mbid, "track_mbid": track_mbid, "id": db_track["id"]},
                )


def update_album_mbid_and_propagate(album_id: int, mbid: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET musicbrainz_albumid = :mbid WHERE id = :id"),
            {"mbid": mbid, "id": album_id},
        )
        session.execute(
            text("UPDATE library_tracks SET musicbrainz_albumid = :mbid "
                 "WHERE album_id = :album_id AND (musicbrainz_albumid IS NULL OR musicbrainz_albumid = '')"),
            {"mbid": mbid, "album_id": album_id},
        )


def update_album_popularity(album_id: int, listeners: int, playcount: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET lastfm_listeners = :listeners, lastfm_playcount = :playcount WHERE id = :id"),
            {"listeners": listeners, "playcount": playcount, "id": album_id},
        )


def update_track_popularity(track_id: int, listeners: int, playcount: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET lastfm_listeners = :listeners, lastfm_playcount = :playcount "
                 "WHERE id = :id"),
            {"listeners": listeners, "playcount": playcount, "id": track_id},
        )


def update_album_has_cover(album_id: int) -> None:
    with transaction_scope() as session:
        session.execute(text("UPDATE library_albums SET has_cover = 1 WHERE id = :id"), {"id": album_id})


def update_album_path_after_reorganize(old_path: str, new_path: str, clean_name: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET name = :name, path = :new_path WHERE path = :old_path"),
            {"name": clean_name, "new_path": new_path, "old_path": old_path},
        )
        session.execute(
            text("UPDATE library_tracks SET path = REPLACE(path, :old_path, :new_path) WHERE path LIKE :pattern"),
            {"old_path": old_path, "new_path": new_path, "pattern": old_path + "%"},
        )


def update_artist_content_hash(artist_name: str, content_hash: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_artists SET content_hash = :hash WHERE name = :name"),
            {"hash": content_hash, "name": artist_name},
        )


def get_artists_with_mbid() -> list[dict]:
    with transaction_scope() as session:
        rows = session.execute(text(
            """
            SELECT id, slug, name, mbid, album_count, has_photo, listeners
            FROM library_artists
            WHERE mbid IS NOT NULL AND mbid != ''
            ORDER BY name
            """
        )).mappings().all()
        return [dict(row) for row in rows]


def get_album_names_for_artist(artist_name: str) -> set[str]:
    with transaction_scope() as session:
        rows = session.execute(
            text("SELECT name FROM library_albums WHERE artist = :artist"),
            {"artist": artist_name},
        ).mappings().all()
        return {row["name"].lower() for row in rows}
