from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.queries.social import (
    _cache_key,
    get_affinity_overlap_counts,
    get_cached_affinity,
    get_public_user_profile,
)
from crate.db.tx import optional_scope


def follow_user(follower_user_id: int, followed_user_id: int, *, session=None) -> bool:
    if follower_user_id == followed_user_id:
        return False
    with optional_scope(session) as s:
        result = s.execute(
            text(
                """
                INSERT INTO user_relationships (follower_user_id, followed_user_id, created_at)
                VALUES (:follower, :followed, :now)
                ON CONFLICT (follower_user_id, followed_user_id) DO NOTHING
                """
            ),
            {
                "follower": follower_user_id,
                "followed": followed_user_id,
                "now": datetime.now(timezone.utc).isoformat(),
            },
        )
        return result.rowcount > 0


def unfollow_user(follower_user_id: int, followed_user_id: int, *, session=None) -> bool:
    with optional_scope(session) as s:
        result = s.execute(
            text(
                """
                DELETE FROM user_relationships
                WHERE follower_user_id = :follower AND followed_user_id = :followed
                """
            ),
            {"follower": follower_user_id, "followed": followed_user_id},
        )
        return result.rowcount > 0


def _store_affinity(
    user_a_id: int,
    user_b_id: int,
    *,
    score: int,
    band: str,
    reasons: list[str],
    session=None,
) -> None:
    pair_a, pair_b = _cache_key(user_a_id, user_b_id)
    with optional_scope(session) as s:
        s.execute(
            text(
                """
                INSERT INTO user_affinity_cache (
                    user_a_id,
                    user_b_id,
                    affinity_score,
                    affinity_band,
                    reasons_json,
                    computed_at
                )
                VALUES (:pair_a, :pair_b, :score, :band, :reasons, :now)
                ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET
                    affinity_score = EXCLUDED.affinity_score,
                    affinity_band = EXCLUDED.affinity_band,
                    reasons_json = EXCLUDED.reasons_json,
                    computed_at = EXCLUDED.computed_at
                """
            ),
            {
                "pair_a": pair_a,
                "pair_b": pair_b,
                "score": score,
                "band": band,
                "reasons": json.dumps(reasons),
                "now": datetime.now(timezone.utc).isoformat(),
            },
        )


def get_me_social(user_id: int) -> dict:
    profile = get_public_user_profile(user_id) or {
        "followers_count": 0,
        "following_count": 0,
        "friends_count": 0,
    }
    return {
        "followers_count": profile["followers_count"],
        "following_count": profile["following_count"],
        "friends_count": profile["friends_count"],
    }


def get_affinity(user_a_id: int, user_b_id: int) -> dict:
    if user_a_id == user_b_id:
        return {
            "affinity_score": 100,
            "affinity_band": "very_high",
            "affinity_reasons": ["Same user"],
        }

    cached = get_cached_affinity(user_a_id, user_b_id)
    if cached:
        return cached

    overlap = get_affinity_overlap_counts(user_a_id, user_b_id)
    reasons: list[str] = []
    score = 0

    score += min(overlap["shared_followed_artists"] * 4, 20)
    if overlap["shared_followed_artists"]:
        reasons.append(f"{overlap['shared_followed_artists']} shared followed artists")

    score += min(overlap["shared_likes"] * 3, 15)
    if overlap["shared_likes"]:
        reasons.append(f"{overlap['shared_likes']} shared liked tracks")

    score += min(overlap["shared_top_artists"] * 4, 20)
    if overlap["shared_top_artists"]:
        reasons.append(f"{overlap['shared_top_artists']} similar recent top artists")

    score += min(overlap["shared_top_albums"] * 4, 15)
    if overlap["shared_top_albums"]:
        reasons.append(f"{overlap['shared_top_albums']} overlapping top albums")

    score += min(overlap["shared_top_tracks"] * 5, 15)
    if overlap["shared_top_tracks"]:
        reasons.append(f"{overlap['shared_top_tracks']} overlapping top tracks")

    score += min(overlap["shared_recent_artists"] * 3, 10)

    score += min(overlap["shared_discovery"] * 5, 5)
    if overlap["shared_discovery"]:
        reasons.append(f"{overlap['shared_discovery']} shared recent discoveries")

    score = max(0, min(100, score))
    if score >= 80:
        band = "very_high"
    elif score >= 55:
        band = "high"
    elif score >= 30:
        band = "medium"
    else:
        band = "low"

    if not reasons:
        reasons = ["Limited overlap so far"]

    trimmed_reasons = reasons[:4]
    _store_affinity(user_a_id, user_b_id, score=score, band=band, reasons=trimmed_reasons)
    return {
        "affinity_score": score,
        "affinity_band": band,
        "affinity_reasons": trimmed_reasons,
    }
