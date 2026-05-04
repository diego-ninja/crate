from __future__ import annotations


def test_library_watcher_queues_scoped_sync_instead_of_syncing_inline(monkeypatch, tmp_path):
    from crate.library_watcher import LibraryWatcher

    library_path = tmp_path / "music"
    album_dir = library_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)

    captured: dict[str, object] = {}

    def fake_create_task_dedup(task_type, params, *, dedup_key):
        captured["task_type"] = task_type
        captured["params"] = params
        captured["dedup_key"] = dedup_key
        return "task-1"

    monkeypatch.setattr("crate.db.repositories.tasks.create_task_dedup", fake_create_task_dedup)

    watcher = LibraryWatcher({"library_path": str(library_path)}, sync=object())
    watcher._sync_album(album_dir, "Artist", True)

    assert captured["task_type"] == "library_sync"
    assert captured["params"] == {
        "artist": "Artist",
        "album_dir": str(album_dir),
        "is_new_file": True,
    }
    assert captured["dedup_key"] == f"library-sync:album:{str(album_dir).lower()}"
