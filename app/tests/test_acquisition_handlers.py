from pathlib import Path
from unittest.mock import patch

from crate.worker_handlers.acquisition import (
    _handle_tidal_download,
    _handle_library_upload,
    _locate_soulseek_download_file,
    _select_soulseek_task_downloads,
)


def test_select_soulseek_task_downloads_scopes_to_expected_full_paths():
    downloads = [
        {
            "username": "peer-a",
            "fullPath": "music/Terror/One With The Underdogs/01 - One with the Underdogs.flac",
            "filename": "01 - One with the Underdogs.flac",
        },
        {
            "username": "peer-a",
            "fullPath": "music/Terror/Lowest of the Low/01 - Better Off Without You.flac",
            "filename": "01 - Better Off Without You.flac",
        },
        {
            "username": "peer-b",
            "fullPath": "music/Terror/One With The Underdogs/02 - Keep Your Mouth Shut.flac",
            "filename": "02 - Keep Your Mouth Shut.flac",
        },
    ]

    selected = _select_soulseek_task_downloads(
        downloads,
        username="peer-a",
        expected_files=[
            "music/Terror/One With The Underdogs/01 - One with the Underdogs.flac",
        ],
    )

    assert selected == [downloads[0]]


def test_locate_soulseek_download_file_prefers_exact_path_suffix(tmp_path):
    root = tmp_path / "soulseek"
    wanted = root / "incoming" / "music" / "Terror" / "One With The Underdogs"
    other = root / "incoming" / "music" / "Terror" / "Lowest of the Low"
    wanted.mkdir(parents=True)
    other.mkdir(parents=True)

    wanted_file = wanted / "01 - Intro.flac"
    other_file = other / "01 - Intro.flac"
    wanted_file.write_bytes(b"a")
    other_file.write_bytes(b"b")

    match = _locate_soulseek_download_file(
        root,
        {
            "directory": "music/Terror/One With The Underdogs",
            "fullPath": "music/Terror/One With The Underdogs/01 - Intro.flac",
            "filename": "01 - Intro.flac",
        },
    )

    assert isinstance(match, Path)
    assert match == wanted_file


def test_library_upload_syncs_each_album_and_emits_grouped_completion(monkeypatch, tmp_path):
    staging_dir = tmp_path / "staging"
    raw_dir = staging_dir / "raw"
    extracted_dir = staging_dir / "extracted"
    grouped_dir = staging_dir / "grouped"
    raw_dir.mkdir(parents=True)
    extracted_dir.mkdir()
    grouped_dir.mkdir()

    source_a = extracted_dir / "terror-a"
    source_b = extracted_dir / "terror-b"
    source_a.mkdir()
    source_b.mkdir()

    library_root = tmp_path / "library"
    album_a = library_root / "Terror" / "One With The Underdogs"
    album_b = library_root / "Terror" / "Lowest of the Low"
    album_a.mkdir(parents=True)
    album_b.mkdir(parents=True)
    (album_a / "01 - Intro.flac").write_bytes(b"a")
    (album_b / "01 - Better Off Without You.flac").write_bytes(b"b")

    imported = {
        str(source_a): {"status": "imported", "dest": str(album_a)},
        str(source_b): {"status": "imported", "dest": str(album_b)},
    }

    class FakeQueue:
        def __init__(self, config):
            self.config = config

        def import_item(self, source_path):
            return imported[source_path]

    sync_calls: list[tuple[Path, str]] = []

    class FakeSync:
        def __init__(self, config):
            self.config = config

        def sync_artist(self, artist_dir):
            raise AssertionError("library_upload should sync albums individually, not whole artists")

        def sync_album(self, album_dir, artist_name):
            sync_calls.append((album_dir, artist_name))

    completed_events: list[dict] = []

    monkeypatch.setattr("crate.importer.ImportQueue", FakeQueue)
    monkeypatch.setattr("crate.library_sync.LibrarySync", FakeSync)
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._find_album_dirs_recursive",
        lambda root, extensions: [source_a, source_b],
    )
    monkeypatch.setattr("crate.worker_handlers.acquisition._group_loose_audio_files", lambda raw, grouped, ext: 0)
    monkeypatch.setattr("crate.worker_handlers.acquisition._seed_uploaded_library", lambda user_id, imported_albums: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.emit_task_event", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.emit_progress", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.emit_item_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._emit_acquisition_completed_for_albums",
        lambda **kwargs: completed_events.append(kwargs),
    )
    monkeypatch.setattr("crate.worker_handlers.acquisition.start_scan", lambda: None)

    result = _handle_library_upload(
        "task-upload-1",
        {"staging_dir": str(staging_dir), "uploader_user_id": 1},
        {"library_path": str(library_root), "audio_extensions": [".flac", ".mp3"]},
    )

    assert result["success"] is True
    assert sync_calls == [(album_a, "Terror"), (album_b, "Terror")]
    assert completed_events == [
        {
            "task_id": "task-upload-1",
            "source": "upload",
            "entity_type": "album",
            "moved_albums": [
                {
                    "artist": "Terror",
                    "album": "One With The Underdogs",
                    "path": str(album_a),
                    "moved": 1,
                },
                {
                    "artist": "Terror",
                    "album": "Lowest of the Low",
                    "path": str(album_b),
                    "moved": 1,
                },
            ],
        }
    ]


def test_tidal_download_task_raises_when_inner_returns_error(monkeypatch, tmp_path):
    library_root = tmp_path / "library"
    library_root.mkdir()
    status_updates: list[dict] = []

    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._tidal_download_inner",
        lambda *args, **kwargs: {"error": "Partial Tidal download: got 0/4 tracks", "phase": "download"},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.update_tidal_download",
        lambda download_id, **kwargs: status_updates.append({"download_id": download_id, **kwargs}),
    )

    try:
        _handle_tidal_download(
            "task-tidal-1",
            {
                "url": "https://tidal.com/album/123",
                "download_id": 99,
                "quality": "max",
            },
            {"library_path": str(library_root)},
        )
    except RuntimeError as exc:
        assert "Partial Tidal download: got 0/4 tracks" in str(exc)
        assert "phase: download" in str(exc)
    else:
        raise AssertionError("Expected _handle_tidal_download to raise for error results")

    assert status_updates == [
        {"download_id": 99, "status": "downloading", "task_id": "task-tidal-1"},
        {"download_id": 99, "status": "failed", "error": "Partial Tidal download: got 0/4 tracks (phase: download)"},
    ]
