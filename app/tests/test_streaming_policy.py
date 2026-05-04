from pathlib import Path

from crate.db.repositories.streaming import _track_path_candidates
from crate.streaming.service import _source_quality
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
