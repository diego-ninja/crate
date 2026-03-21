"""Audio analysis: BPM, key, energy, danceability, valence, mood, loudness.
Uses Essentia (C++ backend, 10-30x faster) when available, falls back to librosa."""

import logging
from pathlib import Path
from typing import Union

import numpy as np

log = logging.getLogger(__name__)

# Detect available backend
_BACKEND = "none"
try:
    import essentia.standard
    _BACKEND = "essentia"
    log.info("Audio analysis backend: Essentia")
except ImportError:
    try:
        import librosa
        _BACKEND = "librosa"
        log.info("Audio analysis backend: librosa (Essentia not available)")
    except ImportError:
        log.warning("No audio analysis backend available (install essentia or librosa)")


def analyze_track(filepath: Union[str, Path]) -> dict:
    """Analyze a single audio track. Auto-selects best available backend."""
    if _BACKEND == "essentia":
        return _analyze_essentia(str(filepath))
    elif _BACKEND == "librosa":
        return _analyze_librosa(str(filepath))
    return _empty_result()


def _empty_result() -> dict:
    return {
        "bpm": None, "key": None, "scale": None, "energy": None, "mood": None,
        "danceability": None, "valence": None, "acousticness": None,
        "instrumentalness": None, "loudness": None, "dynamic_range": None,
        "spectral_complexity": None,
    }


# ── Essentia backend ─────────────────────────────────────────────

def _analyze_essentia(filepath: str) -> dict:
    from essentia.standard import (
        MonoLoader, RhythmExtractor2013, KeyExtractor, Danceability,
        DynamicComplexity, LoudnessEBUR128, Energy,
        SpectralCentroidTime, ZeroCrossingRate,
        Spectrum, SpectralComplexity, MFCC, FrameGenerator, Windowing,
    )

    result = _empty_result()

    try:
        audio = MonoLoader(filename=filepath, sampleRate=44100)()
        if len(audio) < 44100 * 2:
            return result

        max_samples = 44100 * 120
        if len(audio) > max_samples:
            audio = audio[:max_samples]

        # BPM
        try:
            rhythm = RhythmExtractor2013()(audio)
            bpm = float(rhythm[0])
            result["bpm"] = round(bpm, 1) if bpm > 0 else None
        except Exception:
            log.debug("BPM failed: %s", filepath)

        tempo_val = result["bpm"] or 120.0

        # Key + Scale
        try:
            key, scale, _ = KeyExtractor()(audio)
            result["key"] = key
            result["scale"] = scale
        except Exception:
            log.debug("Key failed: %s", filepath)

        # Energy
        try:
            energy_val = float(Energy()(audio))
            rms = (energy_val / len(audio)) ** 0.5
            result["energy"] = round(min(1.0, rms / 0.15), 3)
        except Exception:
            pass

        energy_norm = result["energy"] or 0.5

        # Loudness (EBU R128)
        try:
            loudness = LoudnessEBUR128()(audio)
            result["loudness"] = round(float(loudness[0]), 1)
        except Exception:
            pass

        # Dynamic Range
        try:
            dyn_complexity, _ = DynamicComplexity()(audio)
            result["dynamic_range"] = round(float(dyn_complexity), 3)
        except Exception:
            pass

        # Danceability (Essentia native)
        try:
            danceability_val, _ = Danceability()(audio)
            result["danceability"] = round(float(danceability_val), 3)
        except Exception:
            pass

        # Spectral features for mood/valence
        try:
            centroid = float(SpectralCentroidTime()(audio))
            zcr_vals = [ZeroCrossingRate()(frame) for frame in FrameGenerator(audio, frameSize=2048, hopSize=1024)]
            zcr = float(np.mean(zcr_vals)) if zcr_vals else 0.0

            centroid_norm = min(1.0, centroid / 5000)
            zcr_norm = min(1.0, zcr / 0.15)
            tempo_norm = min(1.0, tempo_val / 200)

            # Valence
            mode_weight = 0.7 if result.get("scale") == "major" else 0.3
            result["valence"] = round(min(1.0, centroid_norm * 0.35 + tempo_norm * 0.3 + mode_weight * 0.35), 3)

            # Acousticness
            result["acousticness"] = round(max(0.0, min(1.0, 1.0 - centroid_norm * 0.6 - zcr_norm * 0.4)), 3)

            # Spectral Complexity
            try:
                windowing = Windowing(type="hann")
                spectrum_algo = Spectrum()
                sc_algo = SpectralComplexity()
                complexities = [sc_algo(spectrum_algo(windowing(frame))) for frame in FrameGenerator(audio, frameSize=2048, hopSize=1024)]
                if complexities:
                    result["spectral_complexity"] = round(min(1.0, float(np.mean(complexities)) / 30), 3)
            except Exception:
                pass

            # Instrumentalness (via MFCC variance)
            try:
                mfcc_algo = MFCC(numberCoefficients=13)
                mfcc_values = [mfcc_algo(spectrum_algo(windowing(frame)))[1] for frame in FrameGenerator(audio, frameSize=2048, hopSize=1024)]
                if mfcc_values:
                    mfcc_arr = np.array(mfcc_values)
                    vocal_energy = float(np.mean(np.std(mfcc_arr[:, 2:6], axis=0)))
                    result["instrumentalness"] = round(max(0.0, min(1.0, 1.0 - vocal_energy / 30)), 3)
            except Exception:
                pass

            # Mood
            dance = result.get("danceability") or 0.5
            result["mood"] = {
                "happy": round(min(1.0, tempo_norm * 0.4 + centroid_norm * 0.3 + energy_norm * 0.3), 3),
                "sad": round(min(1.0, (1 - tempo_norm) * 0.4 + (1 - energy_norm) * 0.3 + (1 - centroid_norm) * 0.3), 3),
                "aggressive": round(min(1.0, energy_norm * 0.4 + zcr_norm * 0.3 + centroid_norm * 0.3), 3),
                "relaxed": round(min(1.0, (1 - energy_norm) * 0.4 + (1 - zcr_norm) * 0.3 + (1 - tempo_norm) * 0.3), 3),
                "electronic": round(min(1.0, centroid_norm * 0.4 + (1 - zcr_norm) * 0.3 + energy_norm * 0.3), 3),
                "acoustic": round(min(1.0, (result.get("acousticness") or 0.5) * 0.5 + (1 - centroid_norm) * 0.3 + zcr_norm * 0.2), 3),
                "party": round(min(1.0, dance * 0.4 + tempo_norm * 0.3 + energy_norm * 0.3), 3),
                "dark": round(min(1.0, (1 - centroid_norm) * 0.4 + energy_norm * 0.3 + (1 - tempo_norm) * 0.3), 3),
            }

        except Exception:
            log.debug("Spectral features failed: %s", filepath)

    except Exception:
        log.warning("Essentia analysis failed for %s", filepath, exc_info=True)

    _ensure_native_floats(result)
    return result


# ── Librosa backend (fallback) ────────────────────────────────────

def _analyze_librosa(filepath: str) -> dict:
    import librosa

    result = _empty_result()

    try:
        y, sr = librosa.load(filepath, sr=22050, mono=True, duration=120)
        if len(y) < sr * 2:
            return result

        rms_frames = librosa.feature.rms(y=y)[0]
        mean_rms = float(np.mean(rms_frames))
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        spectral_centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
        spectral_rolloff = float(np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr)))
        zero_crossing = float(np.mean(librosa.feature.zero_crossing_rate(y=y)))
        spectral_flatness = float(np.mean(librosa.feature.spectral_flatness(y=y)))
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)

        centroid_norm = min(1.0, spectral_centroid / 5000)
        rolloff_norm = min(1.0, spectral_rolloff / (sr / 2))
        zcr_norm = min(1.0, zero_crossing / 0.15)
        energy_norm = min(1.0, mean_rms / 0.2)

        # BPM
        try:
            tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
            if isinstance(tempo, np.ndarray):
                tempo = float(tempo[0])
            result["bpm"] = round(float(tempo), 1) if tempo and tempo > 0 else None
        except Exception:
            pass

        tempo_val = result["bpm"] or 120.0
        tempo_norm = min(1.0, tempo_val / 200)

        # Key
        try:
            chroma_mean = np.mean(chroma, axis=1)
            major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
            minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
            key_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
            best_corr, best_key, best_scale = -1, "C", "major"
            for i in range(12):
                rotated = np.roll(chroma_mean, -i)
                corr_major = float(np.corrcoef(rotated, major_profile)[0, 1])
                corr_minor = float(np.corrcoef(rotated, minor_profile)[0, 1])
                if corr_major > best_corr:
                    best_corr, best_key, best_scale = corr_major, key_names[i], "major"
                if corr_minor > best_corr:
                    best_corr, best_key, best_scale = corr_minor, key_names[i], "minor"
            result["key"] = best_key
            result["scale"] = best_scale
        except Exception:
            pass

        result["energy"] = round(energy_norm, 3)
        if mean_rms > 0:
            result["loudness"] = round(float(20 * np.log10(mean_rms)), 3)

        # Dynamic range
        try:
            rms_nonzero = rms_frames[rms_frames > 0]
            if len(rms_nonzero) > 1:
                result["dynamic_range"] = round(float(20 * np.log10(np.max(rms_nonzero) / np.min(rms_nonzero))), 3)
        except Exception:
            pass

        # Danceability
        try:
            tempo_score = min(1.0, max(0.0, 1.0 - abs(tempo_val - 120) / 80))
            onset_mean = float(np.mean(onset_env)) + 1e-6
            regularity = max(0.0, 1.0 - float(np.std(onset_env)) / onset_mean)
            beat_strength = min(1.0, onset_mean / 10.0)
            result["danceability"] = round(min(1.0, regularity * 0.4 + beat_strength * 0.3 + tempo_score * 0.3), 3)
        except Exception:
            pass

        # Valence
        mode_weight = 0.7 if result.get("scale") == "major" else 0.3
        result["valence"] = round(min(1.0, centroid_norm * 0.35 + tempo_norm * 0.3 + mode_weight * 0.35), 3)

        result["acousticness"] = round(max(0.0, 1.0 - rolloff_norm), 3)
        result["instrumentalness"] = round(min(1.0, spectral_flatness * 10), 3)

        # Spectral complexity
        try:
            chroma_norm_arr = chroma / (np.sum(chroma, axis=0, keepdims=True) + 1e-8)
            entropy = -np.sum(chroma_norm_arr * np.log2(chroma_norm_arr + 1e-8), axis=0)
            result["spectral_complexity"] = round(min(1.0, float(np.mean(entropy)) / np.log2(12)), 3)
        except Exception:
            pass

        # Mood
        result["mood"] = {
            "happy": round(min(1.0, tempo_norm * 0.4 + centroid_norm * 0.3 + energy_norm * 0.3), 3),
            "sad": round(min(1.0, (1 - tempo_norm) * 0.4 + (1 - energy_norm) * 0.3 + (1 - centroid_norm) * 0.3), 3),
            "aggressive": round(min(1.0, energy_norm * 0.4 + zcr_norm * 0.3 + centroid_norm * 0.3), 3),
            "relaxed": round(min(1.0, (1 - energy_norm) * 0.4 + (1 - zcr_norm) * 0.3 + (1 - tempo_norm) * 0.3), 3),
            "electronic": round(min(1.0, rolloff_norm * 0.4 + centroid_norm * 0.3 + (1 - zcr_norm) * 0.3), 3),
            "acoustic": round(min(1.0, (1 - rolloff_norm) * 0.3 + (1 - centroid_norm) * 0.3 + zcr_norm * 0.4), 3),
            "party": round(min(1.0, tempo_norm * 0.5 + energy_norm * 0.3 + centroid_norm * 0.2), 3),
            "dark": round(min(1.0, (1 - centroid_norm) * 0.4 + energy_norm * 0.3 + (1 - tempo_norm) * 0.3), 3),
        }

    except Exception:
        log.warning("Librosa analysis failed for %s", filepath, exc_info=True)

    _ensure_native_floats(result)
    return result


def _ensure_native_floats(result: dict):
    for k, v in result.items():
        if v is not None and k != "mood" and not isinstance(v, str):
            try:
                result[k] = float(v)
            except (TypeError, ValueError):
                pass
