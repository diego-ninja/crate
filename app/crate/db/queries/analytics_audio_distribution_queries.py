from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_insights_bpm_distribution() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT FLOOR(bpm / 10) * 10 AS bucket, COUNT(*) AS cnt
                FROM library_tracks WHERE bpm IS NOT NULL
                GROUP BY bucket ORDER BY bucket
                """
            )
        ).mappings().all()
    return [{"bpm": f"{int(row['bucket'])}-{int(row['bucket'])+9}", "count": row["cnt"]} for row in rows]


def get_insights_key_distribution() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT audio_key, audio_scale, COUNT(*) AS cnt
                FROM library_tracks WHERE audio_key IS NOT NULL AND audio_key != ''
                GROUP BY audio_key, audio_scale ORDER BY cnt DESC
                """
            )
        ).mappings().all()
    return [{"key": f"{row['audio_key']} {row['audio_scale'] or ''}".strip(), "count": row["cnt"]} for row in rows]


def get_insights_bitrate_distribution() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT CASE
                    WHEN bitrate IS NULL THEN 'Unknown'
                    WHEN bitrate > 900000 THEN 'Lossless'
                    WHEN bitrate > 256000 THEN '320k'
                    WHEN bitrate > 192000 THEN '256k'
                    WHEN bitrate > 128000 THEN '192k'
                    ELSE '128k-'
                END AS bracket, COUNT(*) AS cnt
                FROM library_tracks GROUP BY bracket ORDER BY cnt DESC
                """
            )
        ).mappings().all()
    return [{"id": row["bracket"], "value": row["cnt"]} for row in rows]


def get_insights_loudness_distribution() -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT FLOOR(loudness / 3) * 3 AS bucket, COUNT(*) AS cnt
                FROM library_tracks WHERE loudness IS NOT NULL
                GROUP BY bucket ORDER BY bucket
                """
            )
        ).mappings().all()
    return [{"db": f"{int(row['bucket'])} dB", "count": row["cnt"]} for row in rows]


__all__ = [
    "get_insights_bitrate_distribution",
    "get_insights_bpm_distribution",
    "get_insights_key_distribution",
    "get_insights_loudness_distribution",
]
