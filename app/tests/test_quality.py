from __future__ import annotations

from collections import Counter
from types import SimpleNamespace


def _write_file(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"test")


def test_quality_report_detects_album_issues_without_rescanning_albums(tmp_path, monkeypatch):
    from crate.audio import get_audio_files as real_get_audio_files
    from crate import quality

    artist_dir = tmp_path / "Converge"
    lossy_dir = artist_dir / "Jane Doe (AAC)"
    lossless_dir = artist_dir / "Jane Doe (FLAC)"
    mixed_dir = artist_dir / "You Fail Me"

    lossy_track = lossy_dir / "01 - Concubine.m4a"
    lossless_track = lossless_dir / "01 - Concubine.flac"
    mixed_flac = mixed_dir / "01 - First.flac"
    mixed_mp3 = mixed_dir / "02 - Second.mp3"

    for path in [lossy_track, lossless_track, mixed_flac, mixed_mp3]:
        _write_file(path)

    audio_file_calls = Counter()
    tag_calls = Counter()

    def fake_get_audio_files(directory, extensions):
        audio_file_calls[str(directory)] += 1
        return real_get_audio_files(directory, list(extensions))

    def fake_read_tags(filepath):
        tag_calls[str(filepath.parent)] += 1
        if filepath.parent in {lossy_dir, lossless_dir}:
            return {"album": "Jane Doe"}
        return {"album": "You Fail Me"}

    def fake_mutagen_file(filepath):
        bitrate = {
            lossy_track: 128000,
            lossless_track: 0,
            mixed_flac: 0,
            mixed_mp3: 256000,
        }[filepath]
        return SimpleNamespace(info=SimpleNamespace(length=180.0, bitrate=bitrate))

    monkeypatch.setattr(quality, "get_audio_files", fake_get_audio_files)
    monkeypatch.setattr(quality, "read_tags", fake_read_tags)
    monkeypatch.setattr(quality.mutagen, "File", fake_mutagen_file)

    report = quality.quality_report(tmp_path, {".flac", ".m4a", ".mp3"})

    assert report["low_bitrate_count"] == 1
    assert report["mixed_format_count"] == 1
    assert report["lossy_with_lossless_count"] == 1
    assert report["lossy_with_lossless"][0]["lossy_album"] == "Jane Doe (AAC)"
    assert report["lossy_with_lossless"][0]["lossless_album"] == "Jane Doe (FLAC)"
    assert audio_file_calls == Counter(
        {
            str(lossy_dir): 1,
            str(lossless_dir): 1,
            str(mixed_dir): 1,
        }
    )
    assert tag_calls == Counter(
        {
            str(lossy_dir): 1,
            str(lossless_dir): 1,
            str(mixed_dir): 1,
        }
    )


def test_quality_report_marks_unreadable_files_as_corrupt(tmp_path, monkeypatch):
    from crate import quality

    artist_dir = tmp_path / "Botch"
    album_dir = artist_dir / "We Are the Romans"
    broken_track = album_dir / "01 - To Our Friends In The Great White North.flac"
    _write_file(broken_track)

    monkeypatch.setattr(quality, "read_tags", lambda filepath: {"album": filepath.parent.name})
    monkeypatch.setattr(quality.mutagen, "File", lambda filepath: None)

    report = quality.quality_report(tmp_path, {".flac"})

    assert report["corrupt_count"] == 1
    assert report["corrupt"][0]["artist"] == "Botch"
    assert report["corrupt"][0]["album"] == "We Are the Romans"
    assert report["corrupt"][0]["reason"] == "Cannot read file"
