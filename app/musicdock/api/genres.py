from fastapi import APIRouter, HTTPException

from musicdock.db import get_all_genres, get_genre_detail, create_task

router = APIRouter(prefix="/api/genres", tags=["genres"])


@router.get("")
def list_genres():
    return get_all_genres()


@router.get("/{slug}")
def genre_detail(slug: str):
    genre = get_genre_detail(slug)
    if not genre:
        raise HTTPException(status_code=404, detail="Genre not found")
    return genre


@router.post("/index")
def reindex_genres():
    task_id = create_task("index_genres")
    return {"task_id": task_id}
