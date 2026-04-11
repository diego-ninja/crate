from fastapi import APIRouter, HTTPException, Query, Request

from crate.api.auth import _require_auth
from crate.db import (
    follow_user,
    unfollow_user,
    get_relationship_state,
    get_followers,
    get_following,
    search_users,
    get_public_user_profile_by_username,
    get_public_user_profile,
    get_public_playlists_for_user,
    get_me_social,
    get_affinity,
)

router = APIRouter(tags=["social"])


@router.get("/api/me/social")
def my_social(request: Request):
    user = _require_auth(request)
    profile = get_public_user_profile(user["id"])
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        **get_me_social(user["id"]),
        "profile": profile,
    }


@router.get("/api/users/search")
def social_search(request: Request, q: str = Query("", min_length=1), limit: int = Query(20, ge=1, le=50)):
    _require_auth(request)
    return search_users(q, limit=limit)


@router.get("/api/users/{username}")
def social_profile(request: Request, username: str):
    viewer = _require_auth(request)
    profile = get_public_user_profile_by_username(username)
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    target_user_id = profile["id"]
    profile["public_playlists"] = get_public_playlists_for_user(target_user_id)
    profile["relationship_state"] = get_relationship_state(viewer["id"], target_user_id)
    profile.update(get_affinity(viewer["id"], target_user_id))
    return profile


@router.get("/api/users/{username}/followers")
def social_followers(request: Request, username: str, limit: int = Query(100, ge=1, le=250)):
    _require_auth(request)
    profile = get_public_user_profile_by_username(username)
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    return get_followers(profile["id"], limit=limit)


@router.get("/api/users/{username}/following")
def social_following(request: Request, username: str, limit: int = Query(100, ge=1, le=250)):
    _require_auth(request)
    profile = get_public_user_profile_by_username(username)
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    return get_following(profile["id"], limit=limit)


@router.post("/api/users/{user_id}/follow")
def social_follow(request: Request, user_id: int):
    viewer = _require_auth(request)
    target = get_public_user_profile(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    added = follow_user(viewer["id"], user_id)
    return {
        "ok": True,
        "added": added,
        "relationship_state": get_relationship_state(viewer["id"], user_id),
    }


@router.delete("/api/users/{user_id}/follow")
def social_unfollow(request: Request, user_id: int):
    viewer = _require_auth(request)
    target = get_public_user_profile(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    removed = unfollow_user(viewer["id"], user_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Not following this user")
    return {
        "ok": True,
        "relationship_state": get_relationship_state(viewer["id"], user_id),
    }
