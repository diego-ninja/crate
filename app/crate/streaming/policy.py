from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

PIPELINE_VERSION = "aac-v1"

PlaybackDeliveryPolicy = str

ORIGINAL_POLICY = "original"
BALANCED_POLICY = "balanced"
DATA_SAVER_POLICY = "data_saver"
VALID_POLICIES = {ORIGINAL_POLICY, BALANCED_POLICY, DATA_SAVER_POLICY}


@dataclass(frozen=True)
class DeliveryPreset:
    policy: PlaybackDeliveryPolicy
    format: str
    codec: str
    bitrate_kbps: int
    max_source_bitrate_kbps: int
    extension: str = "m4a"


PRESETS: dict[PlaybackDeliveryPolicy, DeliveryPreset] = {
    BALANCED_POLICY: DeliveryPreset(
        policy=BALANCED_POLICY,
        format="m4a",
        codec="aac",
        bitrate_kbps=192,
        max_source_bitrate_kbps=256,
    ),
    DATA_SAVER_POLICY: DeliveryPreset(
        policy=DATA_SAVER_POLICY,
        format="m4a",
        codec="aac",
        bitrate_kbps=128,
        max_source_bitrate_kbps=160,
    ),
}

LOSSLESS_FORMATS = {"flac", "wav", "alac", "aiff", "aif"}
MOBILE_FRIENDLY_FORMATS = {"aac", "m4a", "mp3"}


@dataclass(frozen=True)
class DeliveryDecision:
    requested_policy: PlaybackDeliveryPolicy
    effective_policy: PlaybackDeliveryPolicy
    passthrough: bool
    preset: DeliveryPreset | None
    reason: str


def normalize_policy(value: str | None) -> PlaybackDeliveryPolicy:
    normalized = (value or ORIGINAL_POLICY).strip().lower().replace("-", "_")
    return normalized if normalized in VALID_POLICIES else ORIGINAL_POLICY


def bitrate_to_kbps(value: int | float | None) -> int | None:
    if value is None:
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    # Mutagen usually stores bitrate as bps, while some frontend fixtures use
    # kbps. Treat values above plausible kbps ranges as bps.
    return round(number / 1000) if number > 4000 else number


def infer_format(source_format: str | None, source_path: str | Path) -> str:
    cleaned = (source_format or "").strip().lower().lstrip(".")
    if cleaned:
        return "aac" if cleaned == "m4a" else cleaned
    suffix = Path(source_path).suffix.lower().lstrip(".")
    return "aac" if suffix == "m4a" else suffix


def decide_delivery(track: dict, source_path: str | Path, requested_policy: str | None) -> DeliveryDecision:
    policy = normalize_policy(requested_policy)
    if policy == ORIGINAL_POLICY:
        return DeliveryDecision(policy, ORIGINAL_POLICY, True, None, "original_requested")

    preset = PRESETS[policy]
    source_format = infer_format(track.get("format"), source_path)
    source_bitrate_kbps = bitrate_to_kbps(track.get("bitrate"))
    source_sample_rate = int(track.get("sample_rate") or 0)

    if source_format in MOBILE_FRIENDLY_FORMATS:
        if source_bitrate_kbps is None:
            return DeliveryDecision(policy, ORIGINAL_POLICY, True, None, "mobile_friendly_unknown_bitrate")
        if source_bitrate_kbps <= preset.max_source_bitrate_kbps and source_sample_rate <= 48_000:
            return DeliveryDecision(policy, ORIGINAL_POLICY, True, None, "source_already_within_policy")

    if source_format and source_format not in LOSSLESS_FORMATS and source_bitrate_kbps:
        if source_bitrate_kbps <= preset.bitrate_kbps:
            return DeliveryDecision(policy, ORIGINAL_POLICY, True, None, "lossy_source_not_larger_than_target")

    return DeliveryDecision(policy, policy, False, preset, "transcode_required")


def delivery_sample_rate(source_sample_rate: int | None) -> int:
    if not source_sample_rate:
        return 44_100
    return 48_000 if source_sample_rate > 48_000 else int(source_sample_rate)
