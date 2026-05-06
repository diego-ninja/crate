from __future__ import annotations


def _unchanged_diff(root: str) -> dict:
    return {
        "available": True,
        "root": root,
        "initialized": False,
        "has_previous": True,
        "tracks": 1,
        "diff": {
            "added_count": 0,
            "removed_count": 0,
            "moved_count": 0,
            "changed_count": 0,
            "unchanged_count": 1,
        },
    }


def test_library_sync_album_can_skip_when_native_diff_is_unchanged(monkeypatch, tmp_path):
    from crate.worker_handlers.library import _handle_library_sync

    library_root = tmp_path / "music"
    album_dir = library_root / "Artist" / "Album"
    album_dir.mkdir(parents=True)

    class FakeSync:
        def __init__(self, config):
            self.library_path = library_root
            self.extensions = {".flac"}

        def _canonical_artist_name(self, artist_dir, fallback):
            return fallback

        def sync_album(self, *args, **kwargs):
            raise AssertionError("album sync should be skipped")

        def sync_artist(self, *args, **kwargs):
            raise AssertionError("artist sync should be skipped")

    monkeypatch.setattr("crate.worker_handlers.library.LibrarySync", FakeSync)
    monkeypatch.setattr("crate.native_scan.maybe_compare_native_scan_file_set", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        "crate.native_scan.maybe_update_native_scan_diff_snapshot",
        lambda root, *args, **kwargs: _unchanged_diff(str(root)),
    )
    monkeypatch.setattr("crate.worker_handlers.library.emit_task_event", lambda *args, **kwargs: None)

    result = _handle_library_sync(
        "task-1",
        {
            "album_dir": str(album_dir),
            "artist": "Artist",
            "native_scan_diff_skip_unchanged": True,
        },
        {"library_path": str(library_root), "audio_extensions": [".flac"]},
    )

    assert result["skipped"] == "native_scan_diff_unchanged"
    assert result["mode"] == "album"
    assert result["native_scan_diff_shadow"]["diff"]["unchanged_count"] == 1


def test_library_sync_full_can_skip_when_native_diff_is_unchanged(monkeypatch, tmp_path):
    from crate.worker_handlers.library import _handle_library_sync

    library_root = tmp_path / "music"
    library_root.mkdir()

    class FakeSync:
        def __init__(self, config):
            self.library_path = library_root
            self.extensions = {".flac"}

        def full_sync(self, *args, **kwargs):
            raise AssertionError("full sync should be skipped")

    monkeypatch.setattr("crate.worker_handlers.library.LibrarySync", FakeSync)
    monkeypatch.setattr("crate.native_scan.maybe_compare_native_scan_file_set", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        "crate.native_scan.maybe_update_native_scan_diff_snapshot",
        lambda root, *args, **kwargs: _unchanged_diff(str(root)),
    )
    monkeypatch.setattr("crate.worker_handlers.library.emit_task_event", lambda *args, **kwargs: None)

    result = _handle_library_sync(
        "task-1",
        {"native_scan_diff_source": "native"},
        {"library_path": str(library_root), "audio_extensions": [".flac"]},
    )

    assert result["skipped"] == "native_scan_diff_unchanged"
    assert result["native_scan_diff_shadow"]["diff"]["unchanged_count"] == 1
