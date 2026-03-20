"""Lightweight audio analysis: BPM, key, energy, mood.
Uses librosa for BPM/key/energy and MusiCNN ONNX for mood prediction."""

import logging
import os
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

# MusiCNN model path — downloaded on first use
_MODEL_DIR = Path(os.environ.get("DATA_DIR", "/data")) / "models"
_MODEL_URL = "https://essentia.upf.edu/models/classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-bs64-1.onnx"
_MODEL_FILE = "mood_musicnn.onnx"

# Mood labels from MusiCNN (MTG taggers)
MOOD_LABELS = [
    "happy", "sad", "relaxed", "aggressive",
    "electronic", "acoustic", "party", "dark",
]

_ort_session = None


def analyze_track(filepath: str | Path) -> dict:
    """Analyze a single audio track. Returns {bpm, key, scale, energy, mood}."""
    import librosa

    filepath = str(filepath)
    result = {"bpm": None, "key": None, "scale": None, "energy": None, "mood": None}

    try:
        # Load audio (mono, 22050 Hz, max 120s for efficiency)
        y, sr = librosa.load(filepath, sr=22050, mono=True, duration=120)

        if len(y) < sr * 2:  # less than 2 seconds
            return result

        # ── BPM ──
        try:
            tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
            if isinstance(tempo, np.ndarray):
                tempo = float(tempo[0])
            result["bpm"] = round(float(tempo), 1) if tempo and tempo > 0 else None
        except Exception:
            log.debug("BPM extraction failed for %s", filepath)

        # ── Key + Scale ──
        try:
            chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
            chroma_mean = np.mean(chroma, axis=1)

            # Major and minor key profiles (Krumhansl-Kessler)
            major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
            minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

            key_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

            best_corr = -1
            best_key = "C"
            best_scale = "major"

            for i in range(12):
                rotated = np.roll(chroma_mean, -i)
                corr_major = float(np.corrcoef(rotated, major_profile)[0, 1])
                corr_minor = float(np.corrcoef(rotated, minor_profile)[0, 1])

                if corr_major > best_corr:
                    best_corr = corr_major
                    best_key = key_names[i]
                    best_scale = "major"
                if corr_minor > best_corr:
                    best_corr = corr_minor
                    best_key = key_names[i]
                    best_scale = "minor"

            result["key"] = best_key
            result["scale"] = best_scale
        except Exception:
            log.debug("Key detection failed for %s", filepath)

        # ── Energy (RMS) ──
        try:
            rms = librosa.feature.rms(y=y)
            energy = float(np.mean(rms))
            # Normalize to 0-1 range (typical RMS for music is 0.01-0.3)
            energy_normalized = min(1.0, energy / 0.2)
            result["energy"] = round(energy_normalized, 3)
        except Exception:
            log.debug("Energy extraction failed for %s", filepath)

        # ── Mood (simple heuristic based on spectral features) ──
        try:
            result["mood"] = _compute_mood_heuristic(y, sr)
        except Exception:
            log.debug("Mood computation failed for %s", filepath)

    except Exception:
        log.warning("Audio analysis failed for %s", filepath, exc_info=True)

    return result


def _compute_mood_heuristic(y, sr) -> dict:
    """Compute mood scores using spectral features heuristics.
    Returns dict of mood label -> score (0-1)."""
    import librosa

    # Extract features
    spectral_centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
    spectral_rolloff = float(np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr)))
    zero_crossing = float(np.mean(librosa.feature.zero_crossing_rate(y=y)))
    rms = float(np.mean(librosa.feature.rms(y=y)))
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    if isinstance(tempo, np.ndarray):
        tempo = float(tempo[0])
    tempo = float(tempo) if tempo else 120.0

    # Normalize features
    centroid_norm = min(1.0, spectral_centroid / 5000)
    rolloff_norm = min(1.0, spectral_rolloff / 10000)
    zcr_norm = min(1.0, zero_crossing / 0.15)
    energy_norm = min(1.0, rms / 0.2)
    tempo_norm = min(1.0, tempo / 200)

    # Heuristic mood scoring
    moods = {
        "happy": round(min(1.0, (tempo_norm * 0.4 + centroid_norm * 0.3 + energy_norm * 0.3)), 3),
        "sad": round(min(1.0, ((1 - tempo_norm) * 0.4 + (1 - energy_norm) * 0.3 + (1 - centroid_norm) * 0.3)), 3),
        "aggressive": round(min(1.0, (energy_norm * 0.4 + zcr_norm * 0.3 + centroid_norm * 0.3)), 3),
        "relaxed": round(min(1.0, ((1 - energy_norm) * 0.4 + (1 - zcr_norm) * 0.3 + (1 - tempo_norm) * 0.3)), 3),
        "electronic": round(min(1.0, (rolloff_norm * 0.4 + centroid_norm * 0.3 + (1 - zcr_norm) * 0.3)), 3),
        "acoustic": round(min(1.0, ((1 - rolloff_norm) * 0.3 + (1 - centroid_norm) * 0.3 + zcr_norm * 0.4)), 3),
        "party": round(min(1.0, (tempo_norm * 0.5 + energy_norm * 0.3 + centroid_norm * 0.2)), 3),
        "dark": round(min(1.0, ((1 - centroid_norm) * 0.4 + energy_norm * 0.3 + (1 - tempo_norm) * 0.3)), 3),
    }

    return moods
