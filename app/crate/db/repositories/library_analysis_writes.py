"""Analysis write helpers for the library repository."""

from __future__ import annotations

import json

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryTrack
from crate.db.tx import optional_scope


def update_track_analysis(
    path: str,
    bpm: float | None,
    key: str | None,
    scale: str | None,
    energy: float | None,
    mood: dict | None,
    danceability: float | None = None,
    valence: float | None = None,
    acousticness: float | None = None,
    instrumentalness: float | None = None,
    loudness: float | None = None,
    dynamic_range: float | None = None,
    spectral_complexity: float | None = None,
    *,
    session: Session | None = None,
) -> None:
    def _impl(s: Session) -> None:
        track = s.execute(select(LibraryTrack).where(LibraryTrack.path == path).limit(1)).scalar_one_or_none()
        if track is None:
            return

        track.bpm = bpm
        track.audio_key = key
        track.audio_scale = scale
        track.energy = energy
        track.mood_json = mood
        track.danceability = danceability
        track.valence = valence
        track.acousticness = acousticness
        track.instrumentalness = instrumentalness
        track.loudness = loudness
        track.dynamic_range = dynamic_range
        track.spectral_complexity = spectral_complexity

        s.execute(
            text(
                """
                INSERT INTO track_analysis_features (
                    track_id,
                    bpm,
                    audio_key,
                    audio_scale,
                    energy,
                    mood_json,
                    danceability,
                    valence,
                    acousticness,
                    instrumentalness,
                    loudness,
                    dynamic_range,
                    spectral_complexity,
                    updated_at
                )
                VALUES (
                    :track_id,
                    :bpm,
                    :audio_key,
                    :audio_scale,
                    :energy,
                    CAST(:mood_json AS jsonb),
                    :danceability,
                    :valence,
                    :acousticness,
                    :instrumentalness,
                    :loudness,
                    :dynamic_range,
                    :spectral_complexity,
                    NOW()
                )
                ON CONFLICT (track_id) DO UPDATE SET
                    bpm = EXCLUDED.bpm,
                    audio_key = EXCLUDED.audio_key,
                    audio_scale = EXCLUDED.audio_scale,
                    energy = EXCLUDED.energy,
                    mood_json = EXCLUDED.mood_json,
                    danceability = EXCLUDED.danceability,
                    valence = EXCLUDED.valence,
                    acousticness = EXCLUDED.acousticness,
                    instrumentalness = EXCLUDED.instrumentalness,
                    loudness = EXCLUDED.loudness,
                    dynamic_range = EXCLUDED.dynamic_range,
                    spectral_complexity = EXCLUDED.spectral_complexity,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "track_id": track.id,
                "bpm": bpm,
                "audio_key": key,
                "audio_scale": scale,
                "energy": energy,
                "mood_json": None if mood is None else json.dumps(mood),
                "danceability": danceability,
                "valence": valence,
                "acousticness": acousticness,
                "instrumentalness": instrumentalness,
                "loudness": loudness,
                "dynamic_range": dynamic_range,
                "spectral_complexity": spectral_complexity,
            },
        )

    with optional_scope(session) as s:
        _impl(s)


__all__ = ["update_track_analysis"]
