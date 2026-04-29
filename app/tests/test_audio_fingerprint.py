from pathlib import Path
from subprocess import CompletedProcess


def test_compute_audio_fingerprint_prefers_chromaprint_when_fpcalc_succeeds(monkeypatch, tmp_path):
    track = tmp_path / "track.flac"
    track.write_bytes(b"not-real-audio")

    def fake_run(*args, **kwargs):
        return CompletedProcess(
            args=args[0],
            returncode=0,
            stdout='{"fingerprint":"AQAAE0mUaEkSZSoAAAAAAAA"}',
            stderr="",
        )

    monkeypatch.setattr("crate.audio_fingerprint.subprocess.run", fake_run)

    from crate.audio_fingerprint import CHROMAPRINT_V1, compute_audio_fingerprint_with_source

    payload = compute_audio_fingerprint_with_source(track)

    assert payload == (f"{CHROMAPRINT_V1}:AQAAE0mUaEkSZSoAAAAAAAA", CHROMAPRINT_V1)


def test_compute_audio_fingerprint_falls_back_to_pcm_when_fpcalc_missing(monkeypatch, tmp_path):
    track = tmp_path / "track.flac"
    track.write_bytes(b"not-real-audio")

    def fake_run(*args, **kwargs):
        raise FileNotFoundError

    monkeypatch.setattr("crate.audio_fingerprint.subprocess.run", fake_run)
    monkeypatch.setattr(
        "crate.audio_fingerprint._compute_pcm16_md5",
        lambda path, timeout_seconds=300: ("pcm16-md5-v1:abc123", "pcm16-md5-v1"),
    )

    from crate.audio_fingerprint import compute_audio_fingerprint_with_source

    payload = compute_audio_fingerprint_with_source(track)

    assert payload == ("pcm16-md5-v1:abc123", "pcm16-md5-v1")


def test_backfill_track_audio_fingerprints_handler_stores_successful_rows(monkeypatch):
    from crate.worker_handlers.analysis import _handle_backfill_track_audio_fingerprints

    stored: list[tuple[int, str, str]] = []
    monkeypatch.setattr(
        "crate.worker_handlers.analysis.list_tracks_missing_audio_fingerprints",
        lambda limit=5000: [
            {"id": 1, "path": "/music/a.flac", "artist": "Terror", "album": "Keepers", "title": "01"},
            {"id": 2, "path": "/music/b.flac", "artist": "Terror", "album": "Keepers", "title": "02"},
        ],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.analysis.compute_audio_fingerprint_with_source",
        lambda path: ("chromaprint-v1:good", "chromaprint-v1") if Path(path).name == "a.flac" else None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.analysis.store_track_audio_fingerprint",
        lambda track_id, fingerprint, fingerprint_source: stored.append((track_id, fingerprint, fingerprint_source)),
    )
    monkeypatch.setattr("crate.worker_handlers.analysis.emit_progress", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.analysis.emit_task_event", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.analysis.is_cancelled", lambda task_id: False)

    result = _handle_backfill_track_audio_fingerprints("task-1", {"limit": 10}, {})

    assert result == {
        "processed": 2,
        "fingerprinted": 1,
        "failed": 1,
        "remaining": 0,
    }
    assert stored == [(1, "chromaprint-v1:good", "chromaprint-v1")]
