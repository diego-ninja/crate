"""DB functions for enrichment worker handlers."""

from crate.db.core import get_db_ctx


def get_albums_without_mbid() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            "SELECT * FROM library_albums WHERE musicbrainz_albumid IS NULL OR musicbrainz_albumid = ''"
        )
        return [dict(row) for row in cur.fetchall()]


def update_album_mbid(album_id: int, mbid: str) -> None:
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_albums SET musicbrainz_albumid = %s WHERE id = %s",
            (mbid, album_id),
        )


def update_album_release_group_id(album_id: int, release_group_id: str) -> None:
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_albums SET musicbrainz_releasegroupid = %s WHERE id = %s",
            (release_group_id, album_id),
        )


def update_track_mbids(track_id: int, album_mbid: str, track_mbid: str) -> None:
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_tracks SET musicbrainz_albumid = %s, musicbrainz_trackid = %s "
            "WHERE id = %s",
            (album_mbid, track_mbid, track_id),
        )


def persist_album_release_mbids(album_id: int, tracks_db: list[dict], release: dict) -> None:
    release_mbid = release["mbid"]
    release_group_id = release.get("release_group_id", "")
    mb_tracks = release.get("tracks", [])

    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_albums SET musicbrainz_albumid = %s WHERE id = %s",
            (release_mbid, album_id),
        )
        if release_group_id:
            cur.execute(
                "UPDATE library_albums SET musicbrainz_releasegroupid = %s WHERE id = %s",
                (release_group_id, album_id),
            )
        for index, db_track in enumerate(tracks_db):
            if index >= len(mb_tracks):
                break
            track_mbid = mb_tracks[index].get("mbid", "")
            if track_mbid:
                cur.execute(
                    "UPDATE library_tracks SET musicbrainz_albumid = %s, musicbrainz_trackid = %s "
                    "WHERE id = %s",
                    (release_mbid, track_mbid, db_track["id"]),
                )


def update_album_mbid_and_propagate(album_id: int, mbid: str) -> None:
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_albums SET musicbrainz_albumid = %s WHERE id = %s",
            (mbid, album_id),
        )
        cur.execute(
            "UPDATE library_tracks SET musicbrainz_albumid = %s "
            "WHERE album_id = %s AND (musicbrainz_albumid IS NULL OR musicbrainz_albumid = '')",
            (mbid, album_id),
        )


def update_album_popularity(album_id: int, listeners: int, playcount: int) -> None:
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_albums SET lastfm_listeners = %s, lastfm_playcount = %s WHERE id = %s",
            (listeners, playcount, album_id),
        )


def update_track_popularity(track_id: int, listeners: int, playcount: int) -> None:
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_tracks SET lastfm_listeners = %s, lastfm_playcount = %s "
            "WHERE id = %s",
            (listeners, playcount, track_id),
        )


def update_album_has_cover(album_id: int) -> None:
    with get_db_ctx() as cur:
        cur.execute("UPDATE library_albums SET has_cover = 1 WHERE id = %s", (album_id,))


def update_album_path_after_reorganize(old_path: str, new_path: str, clean_name: str) -> None:
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_albums SET name = %s, path = %s WHERE path = %s",
            (clean_name, new_path, old_path),
        )
        cur.execute(
            "UPDATE library_tracks SET path = REPLACE(path, %s, %s) WHERE path LIKE %s",
            (old_path, new_path, old_path + "%"),
        )


def update_artist_content_hash(artist_name: str, content_hash: str) -> None:
    with get_db_ctx() as cur:
        cur.execute(
            "UPDATE library_artists SET content_hash = %s WHERE name = %s",
            (content_hash, artist_name),
        )


def get_artists_with_mbid() -> list[dict]:
    with get_db_ctx() as cur:
        cur.execute(
            """
            SELECT id, slug, name, mbid, album_count, has_photo, listeners
            FROM library_artists
            WHERE mbid IS NOT NULL AND mbid != ''
            ORDER BY name
            """
        )
        return [dict(row) for row in cur.fetchall()]


def get_album_names_for_artist(artist_name: str) -> set[str]:
    with get_db_ctx() as cur:
        cur.execute("SELECT name FROM library_albums WHERE artist = %s", (artist_name,))
        return {row["name"].lower() for row in cur.fetchall()}
