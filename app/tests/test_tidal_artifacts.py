import json
from pathlib import Path
from types import SimpleNamespace

from crate import tidal
from crate.m4a_fix import repair_tidal_artifacts
from crate.worker_handlers.acquisition import _tidal_download_inner


def _write_mp4_header(path: Path) -> None:
    path.write_bytes(b"\x00\x00\x00\x18ftypisom" + b"\x00" * 64)


def test_tidal_download_uses_collision_safe_output_template(tmp_path, monkeypatch):
    captured: list[list[str]] = []

    class FakeProc:
        def __init__(self, cmd, **_kwargs):
            captured.append(cmd)
            processing_dir = Path(cmd[cmd.index("--path") + 1])
            album_dir = processing_dir / "KNEECAP" / "H.O.O.D 2025"
            album_dir.mkdir(parents=True)
            (album_dir / "01-01 - H.O.O.D (2025 Mix).m4a").write_bytes(b"fake-aac")
            self.stdout = iter([
                "Total downloads: 1\n",
                "Downloaded H.O.O.D  123 /tmp/out\n",
            ])
            self.returncode = 0

        def wait(self, timeout=None):
            return 0

        def kill(self):
            return None

    monkeypatch.setattr(tidal, "PROCESSING_DIR", str(tmp_path))
    monkeypatch.setattr(tidal.subprocess, "Popen", FakeProc)

    result = tidal.download(
        "https://tidal.com/album/413046494",
        quality="normal",
        task_id="task-hood",
    )

    assert result["success"] is True
    assert result["audio_file_count"] == 1
    cmd = captured[0]
    assert cmd[cmd.index("--output") + 1] == tidal.TIDDL_OUTPUT_TEMPLATE
    assert "{item.number:02d}" in tidal.TIDDL_OUTPUT_TEMPLATE
    assert "{item.title_version}" in tidal.TIDDL_OUTPUT_TEMPLATE


def test_get_album_tracks_preserves_tidal_version_metadata(monkeypatch):
    class FakeResponse:
        status_code = 200

        def json(self):
            return {
                "items": [
                    {
                        "id": 413046496,
                        "title": "H.O.O.D",
                        "version": "2025 Mix",
                        "trackNumber": 1,
                        "volumeNumber": 1,
                        "duration": 173,
                        "isrc": "GBPVV2400717",
                        "artist": {"name": "KNEECAP"},
                        "mediaMetadata": {"tags": ["LOSSLESS", "HIRES_LOSSLESS"]},
                    }
                ]
            }

    monkeypatch.setattr(tidal, "get_auth_token", lambda: "token")
    monkeypatch.setattr(tidal, "get_setting", lambda _key, default=None: default)
    monkeypatch.setattr(
        tidal.requests,
        "get",
        lambda *_args, **_kwargs: FakeResponse(),
    )

    tracks = tidal.get_album_tracks("413046494")

    assert tracks == [
        {
            "id": "413046496",
            "title": "H.O.O.D",
            "version": "2025 Mix",
            "display_title": "H.O.O.D (2025 Mix)",
            "artist": "KNEECAP",
            "track_number": 1,
            "volume_number": 1,
            "duration": 173,
            "isrc": "GBPVV2400717",
            "url": "https://tidal.com/track/413046496",
            "quality": ["LOSSLESS", "HIRES_LOSSLESS"],
        }
    ]


def test_refresh_token_falls_back_to_raw_client_when_tiddl_cli_model_fails(tmp_path, monkeypatch):
    auth_dir = tmp_path / ".tiddl"
    auth_dir.mkdir()
    auth_file = auth_dir / "auth.json"
    auth_file.write_text(json.dumps({
        "token": "expired-token",
        "refresh_token": "refresh-token",
        "expires_at": 1,
        "user_id": "old-user",
        "country_code": "US",
    }))

    monkeypatch.setattr(tidal, "TIDDL_CONFIG_DIR", str(auth_dir))
    monkeypatch.setattr(
        tidal.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(returncode=1, stdout="", stderr="ValidationError: user.facebookUid"),
    )
    monkeypatch.setattr(
        tidal,
        "_raw_tidal_refresh",
        lambda refresh: {
            "access_token": "fresh-token",
            "expires_in": 3600,
            "user_id": 9,
            "user": {"userId": 9, "countryCode": "ES"},
        },
    )

    assert tidal.refresh_token() is True

    refreshed = json.loads(auth_file.read_text())
    assert refreshed["token"] == "fresh-token"
    assert refreshed["refresh_token"] == "refresh-token"
    assert refreshed["user_id"] == "9"
    assert refreshed["country_code"] == "ES"
    assert refreshed["expires_at"] > 1


def test_refresh_token_keeps_tiddl_cli_success_path(tmp_path, monkeypatch):
    auth_dir = tmp_path / ".tiddl"
    auth_dir.mkdir()
    (auth_dir / "auth.json").write_text(json.dumps({"token": "token", "refresh_token": "refresh"}))

    monkeypatch.setattr(tidal, "TIDDL_CONFIG_DIR", str(auth_dir))
    monkeypatch.setattr(tidal.subprocess, "run", lambda *_args, **_kwargs: SimpleNamespace(returncode=0))
    monkeypatch.setattr(
        tidal,
        "_raw_tidal_refresh",
        lambda _refresh: (_ for _ in ()).throw(AssertionError("fallback should not run")),
    )

    assert tidal.refresh_token() is True


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

        def sync_album(self, _album_dir, _artist_name):
            return None

    monkeypatch.setattr("crate.m4a_fix._probe_audio_codec", lambda _path: "aac")
    monkeypatch.setattr("crate.tidal.download", _fake_download)
    monkeypatch.setattr("crate.tidal.ensure_auth", lambda: True)
    monkeypatch.setattr("crate.tidal.get_album_track_count", lambda _album_id: 10)
    monkeypatch.setattr("crate.tidal.get_album_tracks", lambda _album_id: [{"id": str(i)} for i in range(10)])
    monkeypatch.setattr(
        "crate.tidal.move_to_library_detailed",
        lambda _path, _lib: [{"artist": "Terror", "album": "Still Suffer", "path": str(tmp_path / "library" / "Terror" / "Still Suffer"), "moved": 10}],
    )
    monkeypatch.setattr("crate.library_sync.LibrarySync", _DummySync)
    monkeypatch.setattr("crate.worker_handlers.acquisition.emit_task_event", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.emit_progress", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.emit_item_event", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.delete_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.append_domain_event", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition.update_tidal_download", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.acquisition._resolve_tidal_preferred_artist_name", lambda *args, **kwargs: "Terror")
    monkeypatch.setattr("crate.worker_handlers.acquisition._align_tidal_staged_artist_dirs", lambda *args, **kwargs: ["Terror"])
    monkeypatch.setattr("crate.worker_handlers.acquisition.start_scan", lambda: None)
    (tmp_path / "library" / "Terror" / "Still Suffer").mkdir(parents=True, exist_ok=True)

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
