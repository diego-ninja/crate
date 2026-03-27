from fastapi import APIRouter, HTTPException, Request

from crate.api.auth import _require_auth, _require_admin
from crate.db import get_all_genres, get_genre_detail, create_task

router = APIRouter(prefix="/api/genres", tags=["genres"])


@router.get("")
def list_genres(request: Request):
    _require_auth(request)
    return get_all_genres()


@router.get("/{slug}")
def genre_detail(request: Request, slug: str):
    _require_auth(request)
    genre = get_genre_detail(slug)
    if not genre:
        raise HTTPException(status_code=404, detail="Genre not found")
    return genre


@router.post("/index")
def reindex_genres(request: Request):
    _require_admin(request)
    task_id = create_task("index_genres")
    return {"task_id": task_id}
