import base64

from crate.playlist_covers import persist_playlist_cover_data
from crate.worker_handlers.management import _handle_persist_playlist_cover


def _cover_data_url(fmt: str, payload: bytes) -> str:
    encoded = base64.b64encode(payload).decode()
    return f"data:image/{fmt};base64,{encoded}"


def test_persist_playlist_cover_data_preserves_supported_extension(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    filename = persist_playlist_cover_data(42, _cover_data_url("png", b"cover-bytes"))

    assert filename == "playlist-42.png"
    assert (tmp_path / "playlist-covers" / filename).read_bytes() == b"cover-bytes"


def test_persist_playlist_cover_worker_uses_common_writer(tmp_path, monkeypatch):
    class FakeRedis:
        def __init__(self):
            self.data = {"cover:staging:7": _cover_data_url("webp", b"new-cover")}
            self.deleted: list[str] = []

        def get(self, key: str):
            return self.data.get(key)

        def delete(self, key: str):
            self.deleted.append(key)
            self.data.pop(key, None)

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    old_cover = tmp_path / "playlist-covers" / "old.jpg"
    old_cover.parent.mkdir(parents=True)
    old_cover.write_bytes(b"old-cover")

    redis = FakeRedis()
    updates: list[tuple[int, dict]] = []
    monkeypatch.setattr("crate.worker_handlers.management._get_redis", lambda: redis)
    monkeypatch.setattr("crate.worker_handlers.management.get_playlist", lambda playlist_id: {"cover_path": "old.jpg"})
    monkeypatch.setattr(
        "crate.worker_handlers.management.update_playlist",
        lambda playlist_id, **kwargs: updates.append((playlist_id, kwargs)),
    )
    monkeypatch.setattr("crate.worker_handlers.management.emit_task_event", lambda *args, **kwargs: None)

    result = _handle_persist_playlist_cover("task-1", {"playlist_id": 7}, {})

    assert result == {"cover_path": "playlist-7.webp"}
    assert (tmp_path / "playlist-covers" / "playlist-7.webp").read_bytes() == b"new-cover"
    assert not old_cover.exists()
    assert redis.deleted == ["cover:staging:7"]
    assert updates == [(7, {"cover_path": "playlist-7.webp", "cover_data_url": None})]
