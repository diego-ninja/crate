from __future__ import annotations

from types import SimpleNamespace


def test_read_audio_quality_prefers_native_probe(monkeypatch, tmp_path):
    from crate import audio

    track = tmp_path / "track.flac"
    track.write_bytes(b"audio")

    monkeypatch.setattr(
        "crate.crate_cli.run_quality",
        lambda **kwargs: {
            "tracks": [
                {
                    "ok": True,
                    "duration": 1.25,
                    "bitrate": 1411000,
                    "sample_rate": 44100,
                    "bit_depth": 16,
                }
            ]
        },
    )
    monkeypatch.setattr(audio.mutagen, "File", lambda _path: None)

    assert audio.read_audio_quality(track) == {
        "duration": 1.25,
        "bitrate": 1411000,
        "sample_rate": 44100,
        "bit_depth": 16,
    }


def test_read_audio_quality_falls_back_to_mutagen(monkeypatch, tmp_path):
    from crate import audio

    track = tmp_path / "track.flac"
    track.write_bytes(b"audio")

    monkeypatch.setattr("crate.crate_cli.run_quality", lambda **kwargs: None)
    monkeypatch.setattr(
        audio.mutagen,
        "File",
        lambda _path: SimpleNamespace(
            info=SimpleNamespace(
                length=2.5,
                bitrate=960000,
                sample_rate=48000,
                bits_per_sample=24,
            )
        ),
    )

    assert audio.read_audio_quality(track) == {
        "duration": 2.5,
        "bitrate": 960000,
        "sample_rate": 48000,
        "bit_depth": 24,
    }
