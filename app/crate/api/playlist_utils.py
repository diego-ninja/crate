from crate.db.repositories.playlists import execute_smart_rules
from crate.playlist_covers import delete_playlist_cover, persist_playlist_cover_data


def apply_playlist_cover_payload(
    playlist_id: int,
    cover_data_url: str | None,
    existing_cover_path: str | None = None,
) -> dict | None:
    if cover_data_url is None:
        return None
    if cover_data_url == "":
        delete_playlist_cover(existing_cover_path)
        return {"cover_data_url": None, "cover_path": None}
    if cover_data_url.startswith("data:image/"):
        new_cover_path = persist_playlist_cover_data(playlist_id, cover_data_url)
        if existing_cover_path and existing_cover_path != new_cover_path:
            delete_playlist_cover(existing_cover_path)
        return {"cover_data_url": None, "cover_path": new_cover_path}
    return {"cover_data_url": cover_data_url}
