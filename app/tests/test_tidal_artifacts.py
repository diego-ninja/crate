from pathlib import Path

from crate.m4a_fix import repair_tidal_artifacts
from crate.worker_handlers.acquisition import _tidal_download_inner


def _write_mp4_header(path: Path) -> None:
    path.write_bytes(b"\x00\x00\x00\x18ftypisom" + b"\x00" * 64)


def test_repair_tidal_artifacts_recovers_raw_flac_and_deletes_temp(tmp_path):
    album_dir = tmp_path / "Terror" / "Still Suffer"
    album_dir.mkdir(parents=True)
    raw_flac = album_dir / "Promised Only Lies.m4a"
    raw_flac.write_bytes(b"fLaC" + b"\x00" * 128)
    temp_file = album_dir / "tmpdeadbeef"
    temp_file.write_bytes(b"")

    summary = repair_tidal_artifacts(tmp_path)

    assert summary["renamed_to_flac"] == 1
    assert summary["deleted"] == 1
    assert (album_dir / "Promised Only Lies.flac").exists()
    assert not raw_flac.exists()
    assert not temp_file.exists()
    assert summary["unrecoverable"] == 0


def test_repair_tidal_artifacts_normalizes_named_aac_to_m4a(tmp_path, monkeypatch):
    album_dir = tmp_path / "Terror" / "Still Suffer"
    album_dir.mkdir(parents=True)
    invalid_flac = album_dir / "Promised Only Lies.flac"
    _write_mp4_header(invalid_flac)

    monkeypatch.setattr("crate.m4a_fix._probe_audio_codec", lambda _path: "aac")

    summary = repair_tidal_artifacts(tmp_path, allow_lossy_rename=True)

    assert summary["renamed_to_m4a"] == 1
    assert (album_dir / "Promised Only Lies.m4a").exists()
    assert not invalid_flac.exists()
    assert summary["lossy_files"] == ["Terror/Still Suffer/Promised Only Lies.flac"]
    assert summary["unrecoverable"] == 0


def test_repair_tidal_artifacts_marks_temp_aac_unrecoverable(tmp_path, monkeypatch):
    album_dir = tmp_path / "Terror" / "Still Suffer"
    album_dir.mkdir(parents=True)
    temp_mp4 = album_dir / "tmpcafebabe"
    _write_mp4_header(temp_mp4)

    monkeypatch.setattr("crate.m4a_fix._probe_audio_codec", lambda _path: "aac")

    summary = repair_tidal_artifacts(tmp_path, allow_lossy_rename=True)

    assert summary["deleted"] == 0
    assert summary["unrecoverable"] == 1
    assert summary["lossy_files"] == ["Terror/Still Suffer/tmpcafebabe"]


def test_tidal_download_inner_falls_back_to_normal_for_unrecoverable_lossless_tree(tmp_path, monkeypatch):
    initial_dir = tmp_path / "initial" / "Terror" / "Still Suffer"
    initial_dir.mkdir(parents=True)
    _write_mp4_header(initial_dir / "Promised Only Lies.flac")
    (initial_dir / "tmpdeadbeef").write_bytes(b"")

    fallback_dir = tmp_path / "fallback" / "Terror" / "Still Suffer"
    fallback_dir.mkdir(parents=True)
    for idx in range(10):
        (fallback_dir / f"{idx + 1:02d} - Track {idx + 1}.m4a").write_bytes(b"fake-aac")

    download_calls: list[str] = []

    def _fake_download(_url: str, quality: str = "max", task_id: str = "", progress_callback=None):
        download_calls.append(quality)
        path = initial_dir.parent.parent if quality == "max" else fallback_dir.parent.parent
        return {
            "success": True,
            "path": str(path),
            "file_count": 2 if quality == "max" else 10,
            "audio_file_count": 0 if quality == "max" else 10,
            "invalid_audio_files": [],
            "temp_artifact_files": [],
            "errors": [],
        }

    class _DummySync:
        def __init__(self, _config):
            pass

        def sync_artist(self, _path):
            return None

    monkeypatch.setattr("crate.m4a_fix._probe_audio_codec", lambda _path: "aac")
    monkeypatch.setattr("crate.tidal.download", _fake_download)
    monkeypatch.setattr("crate.tidal.ensure_auth", lambda: True)
    monkeypatch.setattr("crate.tidal.get_album_track_count", lambda _album_id: 10)
    monkeypatch.setattr("crate.tidal.get_album_tracks", lambda _album_id: [{"id": str(i)} for i in range(10)])
    monkeypatch.setattr("crate.tidal.move_to_library", lambda _path, _lib: ["Terror"])
    monkeypatch.setattr("crate.library_sync.LibrarySync", _DummySync)
    monkeypatch.setattr("crate.worker_handlers.acquisition.emit_task_event", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.emit_progress", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.emit_item_event", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.delete_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.update_tidal_download", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition._resolve_tidal_preferred_artist_name", lambda *args, **kwargs: "Terror")
    monkeypatch.setattr("crate.worker_handlers.acquisition._align_tidal_staged_artist_dirs", lambda *args, **kwargs: ["Terror"])
    monkeypatch.setattr("crate.worker_handlers.acquisition.resolve_artist_dir", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.get_library_artist", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.get_library_album", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.start_scan", lambda: None)
    monkeypatch.setattr("crate.content.queue_process_new_content_if_needed", lambda *args, **kwargs: None)

    result = _tidal_download_inner(
        "task-1",
        {"artist": "Terror", "album": "Still Suffer", "content_type": "album"},
        {"library_path": str(tmp_path / "library")},
        "https://tidal.com/album/493246888",
        "max",
        38,
        tmp_path / "library",
    )

    assert result["success"] is True
    assert result["files"] == 10
    assert result["quality"] == "normal"
    assert download_calls == ["max", "max", "normal"]
