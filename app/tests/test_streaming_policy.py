from pathlib import Path

from crate.db.repositories.streaming import _track_path_candidates
from crate.streaming.service import _source_quality, prepare_playback, resolve_playback
from crate.streaming.policy import bitrate_to_kbps, decide_delivery, normalize_policy


def test_normalize_policy_accepts_known_modes():
    assert normalize_policy("balanced") == "balanced"
    assert normalize_policy("data-saver") == "data_saver"
    assert normalize_policy("wat") == "original"


def test_bitrate_to_kbps_accepts_bps_and_kbps():
    assert bitrate_to_kbps(192000) == 192
    assert bitrate_to_kbps(320) == 320
    assert bitrate_to_kbps(None) is None


def test_balanced_transcodes_lossless_sources():
    decision = decide_delivery(
        {"format": "flac", "bitrate": 1010000, "sample_rate": 44100},
        Path("/music/artist/track.flac"),
        "balanced",
    )

    assert decision.passthrough is False
    assert decision.preset is not None
    assert decision.preset.bitrate_kbps == 192


def test_balanced_passthroughs_reasonable_mobile_sources():
    decision = decide_delivery(
        {"format": "m4a", "bitrate": 192000, "sample_rate": 44100},
        Path("/music/artist/track.m4a"),
        "balanced",
    )

    assert decision.passthrough is True
    assert decision.effective_policy == "original"


def test_track_path_candidates_do_not_suffix_match(monkeypatch):
    monkeypatch.setattr("crate.db.repositories.streaming.load_config", lambda: {"library_path": "/music"})

    assert _track_path_candidates("Artist/Album/track.flac") == [
        "Artist/Album/track.flac",
        "/music/Artist/Album/track.flac",
    ]


def test_source_quality_backfills_missing_track_metadata(monkeypatch):
    monkeypatch.setattr("crate.streaming.service.read_audio_quality", lambda _path: {
        "duration": 240.0,
        "bitrate": 900000,
        "sample_rate": 44100,
        "bit_depth": 16,
    })

    quality = _source_quality(
        {"format": "flac", "bitrate": None, "sample_rate": None, "bit_depth": None},
        Path("/music/artist/track.flac"),
        type("Stat", (), {"st_size": 1024})(),
    )

    assert quality["bitrate"] == 900
    assert quality["sample_rate"] == 44100
    assert quality["bit_depth"] == 16


def test_prepare_playback_queues_variant_without_reading_source_quality(monkeypatch, tmp_path):
    library = tmp_path / "music"
    track_path = library / "Artist" / "Album" / "track.flac"
    track_path.parent.mkdir(parents=True)
    track_path.write_bytes(b"fake flac")
    marked: list[tuple[str, str | None]] = []

    def fail_quality(_path):
        raise AssertionError("prepare endpoint should not inspect audio quality")

    def fake_ensure_variant_record(payload: dict) -> dict:
        return {
            **payload,
            "status": "pending",
            "task_id": None,
            "bytes": None,
            "error": None,
        }

    monkeypatch.setattr("crate.streaming.service.library_path", lambda: library)
    monkeypatch.setattr("crate.streaming.service.read_audio_quality", fail_quality)
    monkeypatch.setattr("crate.streaming.service.ensure_variant_record", fake_ensure_variant_record)
    monkeypatch.setattr("crate.streaming.service.create_task_dedup", lambda *_args, **_kwargs: "task-1")
    monkeypatch.setattr(
        "crate.streaming.service.mark_variant_task",
        lambda cache_key, task_id: marked.append((cache_key, task_id)),
    )

    resolution = prepare_playback(
        {
            "id": 1,
            "entity_uid": None,
            "path": str(track_path),
            "format": "flac",
            "bitrate": 900000,
            "sample_rate": 44100,
            "bit_depth": 16,
        },
        "balanced",
    )

    assert resolution is not None
    assert resolution.preparing is True
    assert resolution.task_id == "task-1"
    assert resolution.cache_hit is False
    assert resolution.delivery["fallback"] is True
    assert len(marked) == 1
    assert marked[0][1] == "task-1"
    assert len(marked[0][0]) == 64


def test_resolve_playback_uses_db_quality_without_probing_request_path(monkeypatch, tmp_path):
    library = tmp_path / "music"
    track_path = library / "Artist" / "Album" / "track.m4a"
    track_path.parent.mkdir(parents=True)
    track_path.write_bytes(b"fake m4a")

    def fail_quality(_path):
        raise AssertionError("playback request path should not inspect audio quality")

    monkeypatch.setattr("crate.streaming.service.library_path", lambda: library)
    monkeypatch.setattr("crate.streaming.service.read_audio_quality", fail_quality)

    resolution = resolve_playback(
        {
            "id": 1,
            "entity_uid": None,
            "path": str(track_path),
            "format": "m4a",
            "bitrate": 192000,
            "sample_rate": 44100,
            "bit_depth": None,
        },
        "balanced",
    )

    assert resolution is not None
    assert resolution.effective_policy == "original"
    assert resolution.source["bitrate"] == 192
    assert resolution.source["sample_rate"] == 44100
