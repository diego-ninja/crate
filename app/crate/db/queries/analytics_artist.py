from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_artist_format_distribution(artist_name: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT t.format, COUNT(*) AS cnt FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                WHERE a.artist = :artist_name AND t.format IS NOT NULL
                GROUP BY t.format ORDER BY cnt DESC
                """
            ),
            {"artist_name": artist_name},
        ).mappings().all()
        return [{"id": r["format"], "value": r["cnt"]} for r in rows]


def get_artist_albums_timeline(artist_name: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT name, year, track_count, total_duration, lastfm_listeners, popularity
                FROM library_albums WHERE artist = :artist_name ORDER BY year
                """
            ),
            {"artist_name": artist_name},
        ).mappings().all()
        return [dict(r) for r in rows]


def get_artist_audio_by_album(artist_name: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT a.name AS album,
                       AVG(t.bpm) AS avg_bpm,
                       AVG(t.energy) AS avg_energy,
                       AVG(t.danceability) AS avg_danceability,
                       AVG(t.valence) AS avg_valence,
                       AVG(t.acousticness) AS avg_acousticness,
                       AVG(t.loudness) AS avg_loudness
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                WHERE a.artist = :artist_name AND t.bpm IS NOT NULL
                GROUP BY a.name, a.year ORDER BY a.year
                """
            ),
            {"artist_name": artist_name},
        ).mappings().all()
        results = []
        for r in rows:
            d = dict(r)
            for k in ("avg_bpm", "avg_energy", "avg_danceability", "avg_valence", "avg_acousticness", "avg_loudness"):
                if d.get(k) is not None:
                    d[k] = round(d[k], 2)
            results.append(d)
        return results


def get_artist_top_tracks(artist_name: str, limit: int = 10) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT
                    t.title,
                    t.album,
                    t.duration,
                    t.popularity,
                    t.popularity_score,
                    t.lastfm_listeners,
                    t.bpm,
                    t.energy
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                WHERE a.artist = :artist_name AND (t.popularity_score IS NOT NULL OR t.popularity IS NOT NULL)
                ORDER BY t.popularity_score DESC NULLS LAST, t.popularity DESC NULLS LAST LIMIT :limit
                """
            ),
            {"artist_name": artist_name, "limit": limit},
        ).mappings().all()
        return [dict(r) for r in rows]


def get_artist_genre_tags(artist_name: str) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT g.name, ag.weight FROM artist_genres ag
                JOIN genres g ON ag.genre_id = g.id
                WHERE ag.artist_name = :artist_name ORDER BY ag.weight DESC
                """
            ),
            {"artist_name": artist_name},
        ).mappings().all()
        return [{"name": r["name"], "weight": round(r["weight"], 2)} for r in rows]


__all__ = [
    "get_artist_albums_timeline",
    "get_artist_audio_by_album",
    "get_artist_format_distribution",
    "get_artist_genre_tags",
    "get_artist_top_tracks",
]
