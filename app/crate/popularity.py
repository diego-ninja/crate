"""Track/album popularity signals and consolidated scoring helpers."""

from __future__ import annotations

import logging
import math
import re
import time
import unicodedata
from collections import defaultdict

import requests

from crate.db.jobs.popularity import (
    bulk_update_album_popularity_scores,
    bulk_update_artist_popularity_scores,
    bulk_update_lastfm_top_track_signals,
    bulk_update_spotify_track_signals,
    bulk_update_track_popularity_scores,
    get_albums_without_popularity,
    get_artist_track_popularity_context,
    get_popularity_scales,
    list_albums_for_popularity_scoring,
    list_artists_for_popularity_scoring,
    list_tracks_for_popularity_scoring,
    normalize_popularity_scores,
    reset_track_popularity_signals,
    update_album_lastfm,
)
from crate.db.repositories.library import get_library_artists
from crate.lastfm import get_top_tracks as get_lastfm_top_tracks
from crate.spotify import get_top_tracks as get_spotify_top_tracks

log = logging.getLogger(__name__)

LASTFM_BASE = "http://ws.audioscrobbler.com/2.0/"
LASTFM_TOP_TRACK_LIMIT = 250
LASTFM_RANK_MAX = 250
SPOTIFY_RANK_MAX = 10


def _api_key() -> str | None:
    import os
    return os.environ.get("LASTFM_APIKEY")


def _lastfm_get(method: str, **params) -> dict | None:
    key = _api_key()
    if not key:
        return None
    try:
        resp = requests.get(
            LASTFM_BASE,
            params={"method": method, "api_key": key, "format": "json", **params},
            timeout=10,
        )
        if resp.status_code == 200:
            return resp.json()
    except Exception:
        pass
    return None


def _parse_int(val) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return 0


def _normalize_track_title(value: str) -> str:
    title = unicodedata.normalize("NFKC", (value or "").lower())
    title = title.replace("&", " and ")
    title = title.replace("’", "'").replace("`", "'")
    title = re.sub(r"\bfeat(?:uring)?\.?\s+[^-()\[\]]+", " ", title)
    title = re.sub(r"\((.*?)\)|\[(.*?)\]", " ", title)
    title = re.sub(r"[-_/]", " ", title)
    title = re.sub(r"[^a-z0-9\s']", " ", title)
    title = re.sub(r"\s+", " ", title).strip()
    return title


def _rank_signal(rank: int | None, rank_max: int) -> float:
    if rank is None or rank <= 0:
        return 0.0
    capped = min(rank, rank_max)
    return max(0.0, 1.0 - (math.log1p(capped - 1) / math.log1p(rank_max)))


def _log_norm(value: int | float | None, scale: int | float | None) -> float:
    if value is None or value <= 0:
        return 0.0
    safe_scale = max(float(scale or 0), 1.0)
    return max(0.0, min(1.0, math.log1p(float(value)) / math.log1p(safe_scale)))


def _percent_score(value: int | float | None) -> float:
    if value is None:
        return 0.0
    return max(0.0, min(1.0, float(value) / 100.0))


def _artist_signal(row: dict, scales: dict) -> float:
    return (
        0.35 * _log_norm(row.get("artist_lastfm_playcount"), scales.get("artist_playcount_p95"))
        + 0.30 * _log_norm(row.get("artist_lastfm_listeners"), scales.get("artist_listeners_p95"))
        + 0.20 * _percent_score(row.get("artist_spotify_popularity"))
        + 0.15 * _log_norm(row.get("artist_spotify_followers"), scales.get("artist_followers_p95"))
    )


def _build_title_index(tracks: list[dict]) -> dict[str, list[dict]]:
    title_index: dict[str, list[dict]] = defaultdict(list)
    for track in tracks:
        normalized = _normalize_track_title(track.get("title") or "")
        if normalized:
            title_index[normalized].append(track)
    return title_index


def _match_remote_track_ids(title_index: dict[str, list[dict]], remote_title: str) -> list[int]:
    normalized = _normalize_track_title(remote_title)
    if not normalized:
        return []

    exact = title_index.get(normalized)
    if exact:
        return [int(track["id"]) for track in exact]

    partial_ids: list[int] = []
    for candidate_title, tracks in title_index.items():
        if (
            candidate_title.startswith(normalized)
            or normalized.startswith(candidate_title)
            or normalized in candidate_title
        ):
            partial_ids.extend(int(track["id"]) for track in tracks)

    seen: set[int] = set()
    deduped: list[int] = []
    for track_id in partial_ids:
        if track_id not in seen:
            seen.add(track_id)
            deduped.append(track_id)
    return deduped


def refresh_artist_track_popularity_signals(artist_name: str) -> dict:
    """Refresh Last.fm/Spotify track-level signals for one artist.

    Returns counts of matched local tracks from each source.
    """
    ctx = get_artist_track_popularity_context(artist_name)
    artist = ctx.get("artist")
    tracks = ctx.get("tracks") or []
    if not artist or not tracks:
        return {"lastfm_matches": 0, "spotify_matches": 0}

    title_index = _build_title_index(tracks)
    reset_track_popularity_signals(artist_name)

    lastfm_updates: list[dict] = []
    spotify_updates: list[dict] = []
    seen_lastfm_ids: set[int] = set()
    seen_spotify_ids: set[int] = set()

    lastfm_top_tracks = get_lastfm_top_tracks(artist_name, limit=LASTFM_TOP_TRACK_LIMIT) or []
    for rank, item in enumerate(lastfm_top_tracks, start=1):
        matched_ids = _match_remote_track_ids(title_index, item.get("title", ""))
        if not matched_ids:
            continue
        listeners = _parse_int(item.get("listeners", 0))
        playcount = _parse_int(item.get("playcount", 0))
        for track_id in matched_ids:
            lastfm_updates.append(
                {
                    "id": track_id,
                    "lastfm_top_rank": rank,
                    "lastfm_listeners": listeners or None,
                    "lastfm_playcount": playcount or None,
                }
            )
            seen_lastfm_ids.add(track_id)

    if lastfm_updates:
        bulk_update_lastfm_top_track_signals(lastfm_updates)

    spotify_id = artist.get("spotify_id")
    if spotify_id:
        spotify_top_tracks = get_spotify_top_tracks(spotify_id) or []
        for rank, item in enumerate(spotify_top_tracks, start=1):
            matched_ids = _match_remote_track_ids(title_index, item.get("name", ""))
            if not matched_ids:
                continue
            popularity = _parse_int(item.get("popularity", 0))
            for track_id in matched_ids:
                spotify_updates.append(
                    {
                        "id": track_id,
                        "spotify_track_popularity": popularity or None,
                        "spotify_top_rank": rank,
                    }
                )
                seen_spotify_ids.add(track_id)

    if spotify_updates:
        bulk_update_spotify_track_signals(spotify_updates)

    return {
        "lastfm_matches": len(seen_lastfm_ids),
        "spotify_matches": len(seen_spotify_ids),
    }


def recompute_track_popularity_scores(artist_names: list[str] | None = None) -> dict:
    """Compute consolidated 0-1 and 0-100 popularity for tracks."""
    scales = get_popularity_scales()
    rows = list_tracks_for_popularity_scoring(artist_names)
    updates: list[dict] = []

    for row in rows:
        lastfm_track_signal = (
            0.6 * _log_norm(row.get("lastfm_playcount"), scales.get("track_playcount_p95"))
            + 0.4 * _log_norm(row.get("lastfm_listeners"), scales.get("track_listeners_p95"))
        )
        lastfm_rank_signal = _rank_signal(row.get("lastfm_top_rank"), LASTFM_RANK_MAX)

        spotify_track_signal = 0.0
        if row.get("spotify_track_popularity") is not None:
            spotify_track_signal = (
                0.75 * max(0.0, min(1.0, float(row.get("spotify_track_popularity") or 0) / 100.0))
                + 0.25 * _rank_signal(row.get("spotify_top_rank"), SPOTIFY_RANK_MAX)
            )

        album_signal = (
            0.55 * _log_norm(row.get("album_lastfm_playcount"), scales.get("album_playcount_p95"))
            + 0.45 * _log_norm(row.get("album_lastfm_listeners"), scales.get("album_listeners_p95"))
        )

        artist_signal = _artist_signal(row, scales)

        has_track_level = lastfm_track_signal > 0.0
        has_rank_signal = lastfm_rank_signal > 0.0 or spotify_track_signal > 0.0

        if has_track_level:
            raw_score = (
                0.68 * lastfm_track_signal
                + 0.12 * lastfm_rank_signal
                + 0.06 * spotify_track_signal
                + 0.09 * album_signal
                + 0.05 * artist_signal
            )
            confidence = 0.95 if lastfm_track_signal >= 0.35 else 0.88
        elif has_rank_signal:
            raw_score = (
                0.30 * lastfm_rank_signal
                + 0.26 * spotify_track_signal
                + 0.16 * album_signal
                + 0.10 * artist_signal
            )
            confidence = 0.74
        elif album_signal > 0.0 or artist_signal > 0.0:
            raw_score = 0.48 * album_signal + 0.22 * artist_signal
            confidence = 0.52 if album_signal > 0.0 else 0.38
        else:
            raw_score = 0.0
            confidence = 0.0

        popularity_score = round(max(0.0, min(1.0, raw_score)), 6)
        popularity = int(round(popularity_score * 100)) if popularity_score > 0 else 0
        updates.append(
            {
                "id": int(row["id"]),
                "popularity_score": popularity_score,
                "popularity": popularity,
                "popularity_confidence": round(confidence, 4),
            }
        )

    if updates:
        bulk_update_track_popularity_scores(updates)

    return {"tracks_scored": len(updates)}


def recompute_album_popularity_scores(artist_names: list[str] | None = None) -> dict:
    """Compute consolidated 0-1 and 0-100 popularity for albums."""
    scales = get_popularity_scales()
    rows = list_albums_for_popularity_scoring(artist_names)
    updates: list[dict] = []

    for row in rows:
        album_signal = (
            0.58 * _log_norm(row.get("lastfm_playcount"), scales.get("album_playcount_p95"))
            + 0.42 * _log_norm(row.get("lastfm_listeners"), scales.get("album_listeners_p95"))
        )
        track_signal = (
            0.6 * max(0.0, float(row.get("max_track_popularity_score") or 0.0))
            + 0.4 * max(0.0, float(row.get("avg_track_popularity_score") or 0.0))
        )
        artist_signal = _artist_signal(row, scales)

        if album_signal > 0.0:
            raw_score = 0.60 * album_signal + 0.25 * track_signal + 0.15 * artist_signal
            confidence = 0.93 if album_signal >= 0.35 else 0.84
        elif track_signal > 0.0:
            raw_score = 0.72 * track_signal + 0.28 * artist_signal
            confidence = 0.71 if int(row.get("scored_tracks") or 0) >= 2 else 0.62
        elif artist_signal > 0.0:
            raw_score = 0.68 * artist_signal
            confidence = 0.4
        else:
            raw_score = 0.0
            confidence = 0.0

        popularity_score = round(max(0.0, min(1.0, raw_score)), 6)
        popularity = int(round(popularity_score * 100)) if popularity_score > 0 else 0
        updates.append(
            {
                "id": int(row["id"]),
                "popularity_score": popularity_score,
                "popularity": popularity,
                "popularity_confidence": round(confidence, 4),
            }
        )

    if updates:
        bulk_update_album_popularity_scores(updates)

    return {"albums_scored": len(updates)}


def recompute_artist_popularity_scores(artist_names: list[str] | None = None) -> dict:
    """Compute consolidated 0-1 and 0-100 popularity for artists."""
    scales = get_popularity_scales()
    rows = list_artists_for_popularity_scoring(artist_names)
    updates: list[dict] = []

    for row in rows:
        artist_base_signal = _artist_signal(row, scales)
        album_catalog_signal = (
            0.58 * max(0.0, float(row.get("max_album_popularity_score") or 0.0))
            + 0.42 * max(0.0, float(row.get("avg_album_popularity_score") or 0.0))
        )
        track_catalog_signal = (
            0.58 * max(0.0, float(row.get("max_track_popularity_score") or 0.0))
            + 0.42 * max(0.0, float(row.get("avg_track_popularity_score") or 0.0))
        )

        if artist_base_signal > 0.0:
            raw_score = (
                0.72 * artist_base_signal
                + 0.18 * album_catalog_signal
                + 0.10 * track_catalog_signal
            )
            has_lastfm = (row.get("artist_lastfm_listeners") or 0) > 0 or (row.get("artist_lastfm_playcount") or 0) > 0
            has_spotify = (row.get("artist_spotify_popularity") or 0) > 0 or (row.get("artist_spotify_followers") or 0) > 0
            confidence = 0.95 if has_lastfm and has_spotify else 0.86
        elif album_catalog_signal > 0.0 or track_catalog_signal > 0.0:
            raw_score = 0.62 * album_catalog_signal + 0.38 * track_catalog_signal
            confidence = 0.58
        else:
            raw_score = 0.0
            confidence = 0.0

        popularity_score = round(max(0.0, min(1.0, raw_score)), 6)
        popularity = int(round(popularity_score * 100)) if popularity_score > 0 else 0
        updates.append(
            {
                "id": int(row["id"]),
                "popularity_score": popularity_score,
                "popularity": popularity,
                "popularity_confidence": round(confidence, 4),
            }
        )

    if updates:
        bulk_update_artist_popularity_scores(updates)

    return {"artists_scored": len(updates)}


def compute_popularity(progress_callback=None) -> dict:
    """Refresh album signals, track-level remote ranks, then recompute scores."""
    albums_fetched = 0
    lastfm_track_matches = 0
    spotify_track_matches = 0

    albums = get_albums_without_popularity()
    total_albums = len(albums)
    for index, album in enumerate(albums):
        artist = album["artist"]
        album_name = album.get("tag_album") or album["name"]
        album_name = re.sub(r"^\d{4}\s*-\s*", "", album_name)

        if progress_callback and index % 10 == 0:
            progress_callback({"phase": "albums", "done": index, "total": total_albums})

        data = _lastfm_get("album.getinfo", artist=artist, album=album_name, autocorrect=1)
        if data and "album" in data:
            info = data["album"]
            listeners = _parse_int(info.get("listeners", 0))
            playcount = _parse_int(info.get("playcount", 0))
            if listeners > 0 or playcount > 0:
                update_album_lastfm(album["id"], listeners, playcount)
                albums_fetched += 1
        time.sleep(0.25)

    all_artists, _total_artists = get_library_artists(per_page=10000)
    artist_list = sorted({artist["name"] for artist in all_artists if artist.get("name")})
    total_artists = len(artist_list)
    for index, artist_name in enumerate(artist_list):
        if progress_callback and index % 5 == 0:
            progress_callback({"phase": "tracks", "done": index, "total": total_artists})
        result = refresh_artist_track_popularity_signals(artist_name)
        lastfm_track_matches += result.get("lastfm_matches", 0)
        spotify_track_matches += result.get("spotify_matches", 0)

    if progress_callback:
        progress_callback({"phase": "normalizing"})

    _normalize_popularity()

    return {
        "albums_fetched": albums_fetched,
        "lastfm_track_matches": lastfm_track_matches,
        "spotify_track_matches": spotify_track_matches,
        "total_albums": total_albums,
        "total_artists": total_artists,
    }


def _normalize_popularity(artist_names: list[str] | None = None):
    """Recompute consolidated popularity for artists, albums, and tracks."""
    normalize_popularity_scores()
    recompute_track_popularity_scores(artist_names)
    recompute_album_popularity_scores(artist_names)
    recompute_artist_popularity_scores(artist_names)
