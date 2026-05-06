from __future__ import annotations

from pathlib import Path


def _track_payload(path: Path) -> dict:
    return {"path": str(path), "filename": path.name, "size": path.stat().st_size, "tags": {"format": path.suffix[1:]}}


def test_native_scan_compare_matches_python_file_discovery(tmp_path, monkeypatch):
    from crate import native_scan

    album_dir = tmp_path / "Artist" / "Album"
    hidden_dir = album_dir / ".download"
    hidden_dir.mkdir(parents=True)
    flac = album_dir / "01 - Track.flac"
    m4a = album_dir / "01 - Track.m4a"
    hidden = hidden_dir / "02 - Hidden.flac"
    flac.write_bytes(b"flac")
    m4a.write_bytes(b"m4a")
    hidden.write_bytes(b"hidden")

    monkeypatch.setattr(
        native_scan.crate_cli,
        "run_scan",
        lambda *args, **kwargs: {
            "artists": [
                {
                    "name": "Artist",
                    "albums": [{"name": "Album", "tracks": [_track_payload(flac)]}],
                }
            ]
        },
    )

    summary = native_scan.compare_native_scan_file_set(tmp_path, {".flac", ".m4a"})

    assert summary["ok"] is True
    assert summary["python_tracks"] == 1
    assert summary["native_tracks"] == 1
    assert summary["missing_in_native"] == []
    assert summary["extra_in_native"] == []


def test_native_scan_compare_reports_extra_and_missing_paths(tmp_path, monkeypatch):
    from crate import native_scan

    album_dir = tmp_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    expected = album_dir / "01 - Expected.flac"
    extra = album_dir / "02 - Extra.flac"
    expected.write_bytes(b"expected")
    extra.write_bytes(b"extra")

    monkeypatch.setattr(
        native_scan.crate_cli,
        "run_scan",
        lambda *args, **kwargs: {
            "artists": [
                {
                    "name": "Artist",
                    "albums": [{"name": "Album", "tracks": [_track_payload(extra)]}],
                }
            ]
        },
    )

    summary = native_scan.compare_native_scan_file_set(tmp_path, {".flac"})

    assert summary["ok"] is False
    assert summary["missing_in_native"] == ["Artist/Album/01 - Expected.flac"]
    assert summary["extra_in_native"] == []
    assert summary["missing_count"] == 1


def test_native_scan_shadow_can_be_enabled_from_config(tmp_path, monkeypatch):
    from crate import native_scan

    album_dir = tmp_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    track = album_dir / "01 - Track.flac"
    track.write_bytes(b"flac")

    monkeypatch.setattr(
        native_scan.crate_cli,
        "run_scan",
        lambda *args, **kwargs: {
            "artists": [
                {
                    "name": "Artist",
                    "albums": [{"name": "Album", "tracks": [_track_payload(track)]}],
                }
            ]
        },
    )

    assert native_scan.maybe_compare_native_scan_file_set(tmp_path, {".flac"}, {}) is None
    summary = native_scan.maybe_compare_native_scan_file_set(
        tmp_path,
        {".flac"},
        {"native_scan_shadow": True},
    )

    assert summary and summary["ok"] is True


def test_compare_album_payloads_accepts_matching_projection(tmp_path):
    from crate import native_scan

    album_dir = tmp_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    track = album_dir / "01.flac"
    track.write_bytes(b"audio")

    python_album = {
        "name": "Album",
        "track_count": 1,
        "total_size": 5,
        "total_duration": 120.0,
        "formats": ["flac"],
        "year": "2024",
        "genre": "Hardcore",
        "has_cover": 1,
        "musicbrainz_albumid": "mb-album",
        "tag_album": "Album",
    }
    python_tracks = [{
        "path": str(track),
        "filename": "01.flac",
        "title": "Track",
        "artist": "Artist",
        "album": "Album",
        "track_number": 1,
        "disc_number": 1,
        "format": "flac",
        "bitrate": 1411000,
        "sample_rate": 44100,
        "bit_depth": 16,
        "duration": 120.0,
        "size": 5,
        "year": "2024",
        "genre": "Hardcore",
        "albumartist": "Artist",
        "musicbrainz_albumid": "mb-album",
        "musicbrainz_trackid": "mb-track",
    }]
    native_projection = {
        "album_payload": dict(python_album),
        "track_payloads": [dict(python_tracks[0], duration=120.4, bitrate=1411500)],
    }

    summary = native_scan.compare_album_payloads(album_dir, python_album, python_tracks, native_projection)

    assert summary["ok"] is True
    assert summary["album_field_diffs"] == []
    assert summary["track_field_diffs"] == []


def test_compare_album_payloads_reports_field_diffs(tmp_path):
    from crate import native_scan

    album_dir = tmp_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    track = album_dir / "01.flac"
    track.write_bytes(b"audio")

    python_album = {
        "name": "Album",
        "track_count": 1,
        "total_size": 5,
        "total_duration": 120.0,
        "formats": ["flac"],
        "year": "2024",
        "genre": "Hardcore",
        "has_cover": 0,
        "musicbrainz_albumid": None,
        "tag_album": "Album",
    }
    python_tracks = [{
        "path": str(track),
        "filename": "01.flac",
        "title": "Track",
        "artist": "Artist",
        "album": "Album",
        "track_number": 1,
        "disc_number": 1,
        "format": "flac",
        "duration": 120.0,
        "size": 5,
    }]
    native_projection = {
        "album_payload": dict(python_album, name="Different Album"),
        "track_payloads": [dict(python_tracks[0], title="Different Track")],
    }

    summary = native_scan.compare_album_payloads(album_dir, python_album, python_tracks, native_projection)

    assert summary["ok"] is False
    assert summary["album_field_diffs"] == [{
        "field": "name",
        "python": "Album",
        "native": "Different Album",
    }]
    assert summary["track_field_diffs"] == [{
        "path": "01.flac",
        "field": "title",
        "python": "Track",
        "native": "Different Track",
    }]


def test_maybe_compare_native_album_payload_builds_projection_from_scan(tmp_path, monkeypatch):
    from crate import native_scan

    album_dir = tmp_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    track = album_dir / "01.flac"
    track.write_bytes(b"audio")

    monkeypatch.setattr(
        native_scan.crate_cli,
        "run_scan",
        lambda *args, **kwargs: {
            "artists": [{
                "name": "Artist",
                "albums": [{
                    "name": "Album",
                    "path": str(album_dir),
                    "has_cover": False,
                    "has_embedded_art": False,
                    "tracks": [{
                        "path": str(track),
                        "filename": "01.flac",
                        "size": 5,
                        "tags": {
                            "title": "Track",
                            "artist": "Artist",
                            "album": "Album",
                            "track_number": 1,
                            "duration_ms": 120000,
                            "format": "flac",
                            "bitrate": 1411000,
                            "sample_rate": 44100,
                            "bit_depth": 16,
                        },
                    }],
                }],
            }]
        },
    )

    summary = native_scan.maybe_compare_native_album_payload(
        album_dir,
        "Artist",
        {
            "name": "Album",
            "track_count": 1,
            "total_size": 5,
            "total_duration": 120.0,
            "formats": ["flac"],
            "year": None,
            "genre": None,
            "has_cover": 0,
            "musicbrainz_albumid": None,
            "tag_album": "Album",
        },
        [{
            "path": str(track),
            "filename": "01.flac",
            "title": "Track",
            "artist": "Artist",
            "album": "Album",
            "track_number": 1,
            "disc_number": 1,
            "format": "flac",
            "bitrate": 1411000,
            "sample_rate": 44100,
            "bit_depth": 16,
            "duration": 120.0,
            "size": 5,
            "albumartist": "Artist",
        }],
        {".flac"},
        {"native_scan_payload_shadow": True},
    )

    assert summary and summary["ok"] is True


def test_adopt_native_album_projection_strips_internal_fields(tmp_path):
    from crate import native_scan

    album_dir = tmp_path / "Artist" / "Album"
    track = album_dir / "01.flac"
    album_dir.mkdir(parents=True)
    track.write_bytes(b"audio")

    python_album = {
        "name": "Album",
        "entity_uid": "python-album-uid",
        "path": str(album_dir),
        "track_count": 1,
        "total_size": 5,
        "total_duration": 120.0,
        "formats": ["flac"],
        "dir_mtime": 123.0,
    }
    native_projection = {
        "album_payload": {
            "name": "Album",
            "entity_uid": "native-album-uid",
            "path": "/native/path",
            "track_count": 1,
            "total_size": 5,
            "total_duration": 120.0,
            "formats": ["flac"],
        },
        "track_payloads": [{
            "path": str(track),
            "filename": "01.flac",
            "artist": "Artist",
            "album": "Album",
            "entity_uid": "native-track-uid",
            "_crate_identity_tagged": True,
        }],
    }

    album_payload, track_payloads = native_scan.adopt_native_album_projection(python_album, native_projection)

    assert album_payload["entity_uid"] == "python-album-uid"
    assert album_payload["path"] == str(album_dir)
    assert album_payload["dir_mtime"] == 123.0
    assert track_payloads[0]["entity_uid"] == "native-track-uid"
    assert "_crate_identity_tagged" not in track_payloads[0]


def test_native_payload_prefer_can_be_enabled_from_source_config():
    from crate import native_scan

    assert native_scan.payload_prefer_enabled({"native_scan_payload_source": "prefer"}) is True
    assert native_scan.payload_prefer_enabled({"native_scan_payload_source": "python"}) is False


def test_native_scan_diff_snapshot_initializes_without_previous(tmp_path, monkeypatch):
    from crate import native_scan

    root = tmp_path / "music"
    root.mkdir()
    snapshot_dir = tmp_path / "snapshots"

    monkeypatch.setattr(
        native_scan.crate_cli,
        "run_scan",
        lambda *args, **kwargs: {"artists": [], "total_files": 0, "total_size": 0},
    )
    monkeypatch.setattr(
        native_scan.crate_cli,
        "run_diff",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("diff should not run")),
    )

    summary = native_scan.update_native_scan_diff_snapshot(
        root,
        {".flac"},
        {"native_scan_snapshot_dir": str(snapshot_dir)},
    )

    assert summary["available"] is True
    assert summary["initialized"] is True
    assert summary["has_previous"] is False
    assert summary["tracks"] == 0
    assert snapshot_dir.exists()
    assert list(snapshot_dir.glob("*.json"))


def test_native_scan_diff_snapshot_diffs_against_previous(tmp_path, monkeypatch):
    from crate import native_scan

    root = tmp_path / "music"
    root.mkdir()
    snapshot_dir = tmp_path / "snapshots"
    payloads = [
        {"artists": [], "total_files": 1, "total_size": 10},
        {"artists": [], "total_files": 2, "total_size": 20},
    ]
    diff_calls: list[tuple[str, str]] = []

    def fake_scan(*args, **kwargs):
        return payloads.pop(0)

    def fake_diff(before, after, **kwargs):
        diff_calls.append((before, after))
        return {
            "before_tracks": 1,
            "after_tracks": 2,
            "added_count": 1,
            "removed_count": 0,
            "moved_count": 0,
            "changed_count": 0,
            "unchanged_count": 1,
            "added": [{"path": "/music/new.flac"}],
            "removed": [],
            "moved": [],
            "changed": [],
        }

    monkeypatch.setattr(native_scan.crate_cli, "run_scan", fake_scan)
    monkeypatch.setattr(native_scan.crate_cli, "run_diff", fake_diff)

    native_scan.update_native_scan_diff_snapshot(
        root,
        {".flac"},
        {"native_scan_snapshot_dir": str(snapshot_dir)},
    )
    summary = native_scan.update_native_scan_diff_snapshot(
        root,
        {".flac"},
        {"native_scan_snapshot_dir": str(snapshot_dir)},
    )

    assert summary["initialized"] is False
    assert summary["has_previous"] is True
    assert summary["tracks"] == 2
    assert summary["diff"]["added_count"] == 1
    assert summary["diff"]["added"] == [{"path": "/music/new.flac"}]
    assert len(diff_calls) == 1
    before, after = diff_calls[0]
    assert before.endswith(".json")
    assert after.endswith(".current")


def test_maybe_update_native_scan_diff_snapshot_can_be_enabled_from_config(tmp_path, monkeypatch):
    from crate import native_scan

    root = tmp_path / "music"
    root.mkdir()

    monkeypatch.setattr(
        native_scan.crate_cli,
        "run_scan",
        lambda *args, **kwargs: {"artists": [], "total_files": 0, "total_size": 0},
    )

    assert native_scan.maybe_update_native_scan_diff_snapshot(root, {".flac"}, {}) is None
    summary = native_scan.maybe_update_native_scan_diff_snapshot(
        root,
        {".flac"},
        {
            "native_scan_diff_shadow": True,
            "native_scan_snapshot_dir": str(tmp_path / "snapshots"),
        },
    )

    assert summary and summary["available"] is True


def test_native_scan_diff_skip_unchanged_requires_clean_existing_diff():
    from crate import native_scan

    assert native_scan.diff_skip_unchanged_enabled({"native_scan_diff_source": "native"}) is True
    assert native_scan.native_scan_diff_is_unchanged({
        "available": True,
        "initialized": False,
        "has_previous": True,
        "diff": {
            "added_count": 0,
            "removed_count": 0,
            "moved_count": 0,
            "changed_count": 0,
        },
    }) is True
    assert native_scan.native_scan_diff_is_unchanged({
        "available": True,
        "initialized": True,
        "has_previous": False,
        "diff": {
            "added_count": 0,
            "removed_count": 0,
            "moved_count": 0,
            "changed_count": 0,
        },
    }) is False
    assert native_scan.native_scan_diff_is_unchanged({
        "available": True,
        "initialized": False,
        "has_previous": True,
        "diff": {
            "added_count": 1,
            "removed_count": 0,
            "moved_count": 0,
            "changed_count": 0,
        },
    }) is False
