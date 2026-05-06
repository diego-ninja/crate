from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_compare_module():
    script_path = Path(__file__).resolve().parents[2] / "scripts" / "compare_rust_scan.py"
    spec = importlib.util.spec_from_file_location("compare_rust_scan", script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_discover_python_audio_files_matches_album_flac_preference(tmp_path):
    compare = _load_compare_module()
    album_dir = tmp_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    flac = album_dir / "01 - Track.flac"
    m4a = album_dir / "01 - Track.m4a"
    mp3 = album_dir / "02 - Other.mp3"
    flac.write_bytes(b"flac")
    m4a.write_bytes(b"m4a")
    mp3.write_bytes(b"mp3")

    files = compare.discover_python_audio_files(tmp_path, "flac,m4a,mp3")
    names = [path.name for path in files]

    assert names == ["01 - Track.flac", "02 - Other.mp3"]


def test_discover_python_audio_files_ignores_hidden_album_entries(tmp_path):
    compare = _load_compare_module()
    album_dir = tmp_path / "Artist" / "Album"
    hidden_dir = album_dir / ".download"
    hidden_dir.mkdir(parents=True)
    visible = album_dir / "01 - Visible.flac"
    hidden = hidden_dir / "02 - Hidden.flac"
    visible.write_bytes(b"visible")
    hidden.write_bytes(b"hidden")

    files = compare.discover_python_audio_files(tmp_path, "flac")

    assert files == [visible]


def test_compare_indexes_reports_path_and_field_diffs():
    compare = _load_compare_module()
    python_index = {
        "Artist/Album/01.flac": {"title": "One", "duration_ms": 1000},
        "Artist/Album/02.flac": {"title": "Two"},
    }
    rust_index = {
        "Artist/Album/01.flac": {"title": "One", "duration_ms": 1400},
        "Artist/Album/03.flac": {"title": "Three"},
        "_meta": {"crate_identity_track_uids": 1},
    }

    summary = compare.compare_indexes(python_index, rust_index)

    assert summary["python_tracks"] == 2
    assert summary["rust_tracks"] == 2
    assert summary["common_tracks"] == 1
    assert summary["missing_in_rust"] == ["Artist/Album/02.flac"]
    assert summary["extra_in_rust"] == ["Artist/Album/03.flac"]
    assert summary["field_diffs"] == []
    assert summary["crate_identity_track_uids"] == 1


def test_compare_indexes_reports_non_tolerated_field_diffs():
    compare = _load_compare_module()
    python_index = {"Artist/Album/01.flac": {"title": "One", "duration_ms": 1000}}
    rust_index = {
        "Artist/Album/01.flac": {"title": "Uno", "duration_ms": 3000},
        "_meta": {},
    }

    summary = compare.compare_indexes(python_index, rust_index)

    assert {
        "path": "Artist/Album/01.flac",
        "field": "title",
        "python": "One",
        "rust": "Uno",
    } in summary["field_diffs"]
    assert {
        "path": "Artist/Album/01.flac",
        "field": "duration_ms",
        "python": 1000,
        "rust": 3000,
    } in summary["field_diffs"]
