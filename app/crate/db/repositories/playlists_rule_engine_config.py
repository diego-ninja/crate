from __future__ import annotations


FIELD_COLUMNS: dict[str, str] = {
    "genre": "t.genre",
    "artist": "t.artist",
    "album": "a.name",
    "title": "t.title",
    "year": "t.year",
    "format": "t.format",
    "audio_key": "t.audio_key",
    "bpm": "t.bpm",
    "energy": "t.energy",
    "danceability": "t.danceability",
    "valence": "t.valence",
    "acousticness": "t.acousticness",
    "instrumentalness": "t.instrumentalness",
    "loudness": "t.loudness",
    "dynamic_range": "t.dynamic_range",
    "rating": "t.rating",
    "bit_depth": "t.bit_depth",
    "sample_rate": "t.sample_rate",
    "duration": "t.duration",
    "popularity": "t.popularity",
}

TEXT_FIELDS = {"genre", "artist", "album", "title", "format", "audio_key"}

SORT_MAP: dict[str, str] = {
    "random": "RANDOM()",
    "popularity": (
        "CASE WHEN t.popularity_score IS NULL AND t.lastfm_playcount IS NULL "
        "AND t.lastfm_listeners IS NULL AND t.popularity IS NULL "
        "THEN 1 ELSE 0 END ASC, "
        "COALESCE(t.popularity_score, -1) DESC, "
        "COALESCE(t.lastfm_playcount, 0) DESC, "
        "COALESCE(t.lastfm_listeners, 0) DESC, "
        "COALESCE(t.lastfm_top_rank, 999999) ASC, "
        "COALESCE(t.popularity, 0) DESC, "
        "RANDOM()"
    ),
    "bpm": "t.bpm ASC NULLS LAST",
    "energy": "t.energy DESC NULLS LAST",
    "title": "t.title ASC",
}


__all__ = [
    "FIELD_COLUMNS",
    "SORT_MAP",
    "TEXT_FIELDS",
]
