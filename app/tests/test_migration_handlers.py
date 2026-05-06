from pathlib import Path

from crate.worker_handlers.migration import _handle_fix_artist, build_artist_layout_fix_issue, preview_fix_artist


def test_fix_artist_consolidates_legacy_artist_dir_and_resyncs(monkeypatch, tmp_path):
    library_root = tmp_path / "library"
    legacy_artist_dir = library_root / "Terror"
    legacy_album_dir = legacy_artist_dir / "One With The Underdogs"
    legacy_album_dir.mkdir(parents=True)
    (legacy_artist_dir / "artist.jpg").write_bytes(b"art")
    (legacy_album_dir / "01 - Intro.flac").write_bytes(b"audio")

    artist_uid = "30a0374c-54dc-5f41-b1ed-95c7fd4ec386"
    album_uid = "2f155aea-6c22-5844-8d87-f97ec8b68ab3"
    target_artist_dir = library_root / artist_uid
    target_album_dir = target_artist_dir / album_uid

    update_calls: list[tuple[str, str]] = []
    sync_calls: list[tuple[str, list[Path]]] = []

    class FakeSync:
        def __init__(self, config):
            self.config = config

        def sync_artist_dirs(self, artist_name, artist_dirs):
            sync_calls.append((artist_name, artist_dirs))
            return 12

    monkeypatch.setattr(
        "crate.worker_handlers.migration.get_library_artist",
        lambda name: {
            "name": "Terror",
            "entity_uid": artist_uid,
            "folder_name": artist_uid,
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.migration.update_artist_folder_name",
        lambda artist_name, folder_name: update_calls.append((artist_name, folder_name)),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.migration.get_artist_album_paths",
        lambda artist_name, limit=5000: [],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.migration.infer_album_identity",
        lambda album_dir, fallback_artist="": ("Terror", "One With The Underdogs"),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.migration._resolve_fix_album_target",
        lambda library_root, artist, artist_name, album_name: target_album_dir,
    )
    monkeypatch.setattr("crate.worker_handlers.migration.LibrarySync", FakeSync)
    monkeypatch.setattr("crate.worker_handlers.migration.emit_task_event", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.migration.set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.migration.delete_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.migration.is_cancelled", lambda task_id: False)

    result = _handle_fix_artist(
        "task-fix-artist-1",
        {"artist": "Terror"},
        {"library_path": str(library_root), "audio_extensions": [".flac", ".mp3"]},
    )

    assert result["status"] == "fixed"
    assert result["albums_fixed"] == 1
    assert result["synced_tracks"] == 12
    assert (target_artist_dir / "artist.jpg").exists()
    assert target_album_dir.is_dir()
    assert len(list(target_album_dir.glob("*.flac"))) == 1
    assert not legacy_artist_dir.exists()
    assert sync_calls == [("Terror", [target_artist_dir])]
    assert update_calls == [("Terror", artist_uid), ("Terror", artist_uid)]


def test_fix_artist_discovers_tag_matched_legacy_dir_when_folder_name_already_points_to_empty_target(monkeypatch, tmp_path):
    library_root = tmp_path / "library"
    artist_uid = "695179a0-3863-50c2-9302-61f5cf144daa"
    album_uid = "564b0e79-0978-40ad-b764-059bf15410ff"
    target_artist_dir = library_root / artist_uid
    target_artist_dir.mkdir(parents=True)
    (target_artist_dir / "artist.jpg").write_bytes(b"art")

    legacy_artist_dir = library_root / "6e7e3e43-7834-4677-8192-8fd9fc47bf5e"
    legacy_album_dir = legacy_artist_dir / "You, Me & the Violence"
    legacy_album_dir.mkdir(parents=True)
    (legacy_album_dir / "01 - Pilori.flac").write_bytes(b"audio")

    target_album_dir = target_artist_dir / album_uid

    sync_calls: list[tuple[str, list[Path]]] = []

    class FakeSync:
        def __init__(self, config):
            self.config = config

        def sync_artist_dirs(self, artist_name, artist_dirs):
            sync_calls.append((artist_name, artist_dirs))
            return 11

    monkeypatch.setattr(
        "crate.worker_handlers.migration.get_library_artist",
        lambda name: {
            "name": "Birds In Row",
            "entity_uid": artist_uid,
            "folder_name": artist_uid,
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.migration.get_artist_album_paths",
        lambda artist_name, limit=5000: [],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.migration.update_artist_folder_name",
        lambda artist_name, folder_name: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.migration.infer_album_identity",
        lambda album_dir, fallback_artist="": ("Birds In Row", "You, Me & the Violence"),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.migration._resolve_fix_album_target",
        lambda library_root, artist, artist_name, album_name: target_album_dir,
    )
    monkeypatch.setattr("crate.worker_handlers.migration.LibrarySync", FakeSync)
    monkeypatch.setattr("crate.worker_handlers.migration.emit_task_event", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.migration.set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.migration.delete_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.migration.is_cancelled", lambda task_id: False)

    result = _handle_fix_artist(
        "task-fix-artist-2",
        {"artist": "Birds In Row"},
        {"library_path": str(library_root), "audio_extensions": [".flac", ".mp3"]},
    )

    assert result["status"] == "fixed"
    assert result["albums_fixed"] == 1
    assert result["synced_tracks"] == 11
    assert target_album_dir.is_dir()
    assert len(list(target_album_dir.glob("*.flac"))) == 1
    assert not legacy_artist_dir.exists()
    assert sync_calls == [("Birds In Row", [target_artist_dir])]


def test_preview_fix_artist_reports_legacy_album_moves(monkeypatch, tmp_path):
    library_root = tmp_path / "library"
    artist_uid = "b81635c8-3132-57d2-8d22-920251dc2627"
    target_artist_dir = library_root / artist_uid
    target_artist_dir.mkdir(parents=True)

    legacy_artist_dir = library_root / "2baea7c0-cb7e-459b-af0c-ee1791de85b7"
    legacy_album_dir = legacy_artist_dir / "Slip"
    legacy_album_dir.mkdir(parents=True)
    (legacy_album_dir / "01 - Dine Alone.flac").write_bytes(b"audio")

    target_album_dir = target_artist_dir / "7ed07c07-1754-5db2-9922-e324ad124f3f"

    artist = {
        "name": "Quicksand",
        "entity_uid": artist_uid,
        "folder_name": artist_uid,
        "album_count": 4,
    }

    monkeypatch.setattr(
        "crate.worker_handlers.migration.get_artist_album_paths",
        lambda artist_name, limit=5000: [{"path": str(legacy_album_dir)}],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.migration.infer_album_identity",
        lambda album_dir, fallback_artist="": ("Quicksand", "Slip"),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.migration._resolve_fix_album_target",
        lambda library_root, artist, artist_name, album_name: target_album_dir,
    )

    preview = preview_fix_artist(library_root, artist, {"library_path": str(library_root)})

    assert preview["status"] == "needs_fix"
    assert preview["applicable"] is True
    assert preview["album_moves"] == [
        {
            "album": "Slip",
            "source": str(legacy_album_dir),
            "target": str(target_album_dir),
        }
    ]


def test_preview_fix_artist_does_not_scan_unrelated_library_dirs(monkeypatch, tmp_path):
    from crate.worker_handlers import migration

    library_root = tmp_path / "library"
    artist_uid = "b81635c8-3132-57d2-8d22-920251dc2627"
    target_artist_dir = library_root / artist_uid
    target_album_dir = target_artist_dir / "7ed07c07-1754-5db2-9922-e324ad124f3f"
    target_album_dir.mkdir(parents=True)
    (target_album_dir / "01 - Dine Alone.flac").write_bytes(b"audio")

    unrelated_album_dir = library_root / "Other Artist" / "Other Album"
    unrelated_album_dir.mkdir(parents=True)
    (unrelated_album_dir / "01 - Other.flac").write_bytes(b"audio")

    artist = {
        "name": "Quicksand",
        "entity_uid": artist_uid,
        "folder_name": artist_uid,
        "album_count": 1,
    }

    monkeypatch.setattr(
        "crate.worker_handlers.migration.get_artist_album_paths",
        lambda artist_name, limit=5000: [{"path": str(target_album_dir)}],
    )

    def fail_on_unrelated(album_dir, fallback_artist=""):
        if album_dir == unrelated_album_dir:
            raise AssertionError("repair preview should not inspect unrelated library dirs")
        return ("Quicksand", "Slip")

    monkeypatch.setattr(migration, "infer_album_identity", fail_on_unrelated)

    preview = preview_fix_artist(library_root, artist, {"library_path": str(library_root)})

    assert preview["status"] == "already_canonical"
    assert preview["album_moves"] == []
    assert str(library_root / "Other Artist") not in preview["candidate_dirs"]


def test_build_artist_layout_fix_issue_from_preview():
    preview = {
        "status": "needs_fix",
        "artist": "Quicksand",
        "target_artist_dir": "/music/b81635c8-3132-57d2-8d22-920251dc2627",
        "candidate_dirs": ["/music/2baea7c0-cb7e-459b-af0c-ee1791de85b7"],
        "album_moves": [{"album": "Slip"}],
        "artist_files": ["artist.jpg"],
        "folder_name_mismatch": False,
        "skipped_existing": 1,
        "skipped_foreign": 0,
        "preview_errors": [],
    }

    issue = build_artist_layout_fix_issue(preview, issue_id=42)

    assert issue == {
        "id": 42,
        "check": "artist_layout_fix",
        "severity": "high",
        "description": "Artist layout fix needed for Quicksand",
        "auto_fixable": True,
        "details": {
            "artist": "Quicksand",
            "target_artist_dir": "/music/b81635c8-3132-57d2-8d22-920251dc2627",
            "candidate_dirs": ["/music/2baea7c0-cb7e-459b-af0c-ee1791de85b7"],
            "album_move_count": 1,
            "artist_file_count": 1,
            "folder_name_mismatch": False,
            "skipped_existing": 1,
            "skipped_foreign": 0,
            "preview_errors": [],
        },
    }
