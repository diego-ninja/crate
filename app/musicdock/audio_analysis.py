"""Audio analysis: BPM, key, energy, danceability, valence, mood, loudness.

Uses Essentia TensorFlow models (discogs-effnet) when available for ML-based
mood/energy/valence/danceability predictions. Falls back to signal-processing
heuristics when models aren't present, and to librosa on ARM."""

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

_MODEL_DIR = Path("/app/models")


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

def _has_ml_models() -> bool:
    return (_MODEL_DIR / "discogs-effnet-bs64-1.pb").exists()


def _analyze_essentia(filepath: str) -> dict:
    from essentia.standard import (
        MonoLoader, RhythmExtractor2013, KeyExtractor,
        DynamicComplexity, LoudnessEBUR128,
    )

    result = _empty_result()

    try:
        # 44.1kHz for BPM, key, loudness
        audio_44k = MonoLoader(filename=filepath, sampleRate=44100)()
        if len(audio_44k) < 44100 * 2:
            return result

        max_44k = 44100 * 120
        if len(audio_44k) > max_44k:
            audio_44k = audio_44k[:max_44k]

        # BPM
        try:
            rhythm = RhythmExtractor2013()(audio_44k)
            bpm = float(rhythm[0])
            result["bpm"] = round(bpm, 1) if bpm > 0 else None
        except Exception:
            log.debug("BPM failed: %s", filepath, exc_info=True)

        # Key + Scale
        try:
            key, scale, _ = KeyExtractor()(audio_44k)
            result["key"] = key
            result["scale"] = scale
        except Exception:
            log.debug("Key failed: %s", filepath, exc_info=True)

        # Loudness (EBU R128)
        try:
            loudness = LoudnessEBUR128()(audio_44k)
            result["loudness"] = round(float(loudness[0]), 1)
        except Exception:
            log.debug("Loudness failed: %s", filepath, exc_info=True)

        # Dynamic Range
        try:
            dyn, _ = DynamicComplexity()(audio_44k)
            result["dynamic_range"] = round(float(dyn), 3)
        except Exception:
            log.debug("Dynamic range failed: %s", filepath, exc_info=True)

        # ML predictions or heuristic fallback
        if _has_ml_models():
            _analyze_essentia_ml(filepath, result)
        else:
            log.warning("Essentia ML models not found at %s, using heuristics", _MODEL_DIR)
            _analyze_essentia_heuristic(filepath, audio_44k, result)

    except Exception:
        log.warning("Essentia analysis failed for %s", filepath, exc_info=True)

    _ensure_native_floats(result)
    return result


def _analyze_essentia_ml(filepath: str, result: dict):
    """ML-based analysis using Discogs-EffNet embeddings + classification heads."""
    from essentia.standard import (
        MonoLoader, TensorflowPredictEffnetDiscogs, TensorflowPredict2D,
    )

    # 16kHz for effnet
    audio = MonoLoader(filename=filepath, sampleRate=16000)()
    if len(audio) < 16000 * 2:
        return

    max_samples = 16000 * 120
    if len(audio) > max_samples:
        audio = audio[:max_samples]

    # Extract embeddings
    effnet_model = _MODEL_DIR / "discogs-effnet-bs64-1.pb"
    embeddings = TensorflowPredictEffnetDiscogs(
        graphFilename=str(effnet_model),
        output="PartitionedCall:1",
    )(audio)

    def predict_classification(model_name: str) -> float:
        model_path = _MODEL_DIR / f"{model_name}.pb"
        if not model_path.exists():
            log.debug("Model not found: %s", model_path)
            return 0.5
        try:
            predictions = TensorflowPredict2D(
                graphFilename=str(model_path),
                output="model/Softmax",
            )(embeddings)
            return float(np.mean(predictions[:, 1])) if predictions.shape[1] > 1 else float(np.mean(predictions))
        except Exception:
            log.debug("Classification prediction failed for %s", model_name, exc_info=True)
            return 0.5

    def predict_regression(model_name: str) -> float:
        model_path = _MODEL_DIR / f"{model_name}.pb"
        if not model_path.exists():
            log.debug("Model not found: %s", model_path)
            return 0.5
        try:
            predictions = TensorflowPredict2D(
                graphFilename=str(model_path),
                output="model/Identity",
            )(embeddings)
            return float(np.mean(predictions))
        except Exception:
            log.debug("Regression prediction failed for %s", model_name, exc_info=True)
            return 0.5

    # Danceability
    result["danceability"] = round(predict_classification("danceability-discogs-effnet-1"), 3)

    # Mood classifiers
    aggressive = predict_classification("mood_aggressive-discogs-effnet-1")
    happy = predict_classification("mood_happy-discogs-effnet-1")
    sad = predict_classification("mood_sad-discogs-effnet-1")
    relaxed = predict_classification("mood_relaxed-discogs-effnet-1")

    # Voice/Instrumental
    instrumental = predict_classification("voice_instrumental-discogs-effnet-1")
    result["instrumentalness"] = round(instrumental, 3)

    # Arousal → energy
    try:
        arousal = predict_regression("deam-arousal-discogs-effnet-1")
        result["energy"] = round(max(0.0, min(1.0, arousal)), 3)
    except Exception:
        result["energy"] = round(aggressive * 0.5 + (1 - relaxed) * 0.5, 3)

    # Valence
    try:
        val = predict_regression("deam-valence-discogs-effnet-1")
        result["valence"] = round(max(0.0, min(1.0, val)), 3)
    except Exception:
        result["valence"] = round(happy * 0.5 + (1 - sad) * 0.5, 3)

    # Acousticness (derived — no dedicated model)
    energy = result.get("energy") or 0.5
    result["acousticness"] = round(
        max(0.0, 1.0 - aggressive * 0.3 - (1 - relaxed) * 0.3 - energy * 0.4), 3
    )

    # Mood dict
    dance = result["danceability"]
    acoustic = result["acousticness"]
    result["mood"] = {
        "aggressive": round(aggressive, 3),
        "happy": round(happy, 3),
        "sad": round(sad, 3),
        "relaxed": round(relaxed, 3),
        "dark": round(max(0.0, min(1.0, aggressive * 0.4 + sad * 0.3 + (1 - happy) * 0.3)), 3),
        "party": round(max(0.0, min(1.0, dance * 0.4 + happy * 0.3 + energy * 0.3)), 3),
        "electronic": round(max(0.0, min(1.0, (1 - acoustic) * 0.6 + energy * 0.4)), 3),
        "acoustic": round(acoustic, 3),
    }


def _analyze_essentia_heuristic(filepath: str, audio: np.ndarray, result: dict):
    """Fallback when ML models not available -- uses signal processing heuristics."""
    from essentia.standard import (
        Danceability, Energy, SpectralCentroidTime, ZeroCrossingRate,
        Spectrum, SpectralComplexity, MFCC, FrameGenerator, Windowing,
    )

    tempo_val = result["bpm"] or 120.0

    try:
        # Energy
        try:
            energy_val = float(Energy()(audio))
            rms = (energy_val / len(audio)) ** 0.5
            db = 20 * np.log10(rms + 1e-10)
            result["energy"] = round(max(0.0, min(1.0, (db + 30) / 24)), 3)
        except Exception:
            log.debug("Energy heuristic failed: %s", filepath, exc_info=True)

        energy_norm = result["energy"] or 0.5

        # Danceability (Essentia native)
        try:
            danceability_val, _ = Danceability()(audio)
            result["danceability"] = round(max(0.0, min(1.0, float(danceability_val))), 3)
        except Exception:
            log.debug("Danceability heuristic failed: %s", filepath, exc_info=True)

        # Spectral features for mood/valence
        centroid = float(SpectralCentroidTime()(audio))
        zcr_vals = [ZeroCrossingRate()(frame) for frame in FrameGenerator(audio, frameSize=2048, hopSize=1024)]
        zcr = float(np.mean(zcr_vals)) if zcr_vals else 0.0

        centroid_norm = min(1.0, centroid / 8000)
        zcr_norm = min(1.0, zcr / 0.25)
        tempo_norm = min(1.0, tempo_val / 200)

        # Valence
        mode_weight = 0.65 if result.get("scale") == "major" else 0.2
        result["valence"] = round(max(0.0, min(1.0, mode_weight * 0.5 + tempo_norm * 0.25 + (1.0 - energy_norm) * 0.25)), 3)

        # Acousticness
        result["acousticness"] = round(max(0.0, min(1.0, 1.0 - centroid_norm * 0.4 - zcr_norm * 0.3 - energy_norm * 0.3)), 3)

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
            windowing = Windowing(type="hann")
            spectrum_algo = Spectrum()
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
        is_minor = result.get("scale") == "minor"
        valence = result.get("valence") or 0.5
        acoustic = result.get("acousticness") or 0.5

        result["mood"] = {
            "aggressive": round(max(0.0, min(1.0, energy_norm * 0.35 + zcr_norm * 0.25 + centroid_norm * 0.2 + (1 - valence) * 0.2)), 3),
            "dark": round(max(0.0, min(1.0, (1 - valence) * 0.4 + energy_norm * 0.2 + (0.7 if is_minor else 0.2) * 0.4)), 3),
            "happy": round(max(0.0, min(1.0, valence * 0.5 + tempo_norm * 0.25 + (1 - energy_norm) * 0.25)), 3),
            "sad": round(max(0.0, min(1.0, (1 - valence) * 0.4 + (1 - energy_norm) * 0.3 + (0.7 if is_minor else 0.2) * 0.3)), 3),
            "relaxed": round(max(0.0, min(1.0, (1 - energy_norm) * 0.4 + acoustic * 0.3 + (1 - tempo_norm) * 0.3)), 3),
            "party": round(max(0.0, min(1.0, dance * 0.35 + tempo_norm * 0.25 + energy_norm * 0.2 + valence * 0.2)), 3),
            "electronic": round(max(0.0, min(1.0, (1 - acoustic) * 0.4 + centroid_norm * 0.3 + (1 - zcr_norm) * 0.3)), 3),
            "acoustic": round(max(0.0, min(1.0, acoustic * 0.5 + (1 - centroid_norm) * 0.25 + (1 - energy_norm) * 0.25)), 3),
        }

    except Exception:
        log.debug("Heuristic spectral features failed: %s", filepath, exc_info=True)


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

        centroid_norm = min(1.0, spectral_centroid / 8000)
        rolloff_norm = min(1.0, spectral_rolloff / (sr / 2))
        zcr_norm = min(1.0, zero_crossing / 0.25)
        db = 20 * np.log10(mean_rms + 1e-10)
        energy_norm = max(0.0, min(1.0, (db + 30) / 24))

        # BPM
        try:
            tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
            if isinstance(tempo, np.ndarray):
                tempo = float(tempo[0])
            result["bpm"] = round(float(tempo), 1) if tempo and tempo > 0 else None
        except Exception:
            log.debug("Feature failed for %s", filepath, exc_info=True)

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
            log.debug("Feature failed for %s", filepath, exc_info=True)

        result["energy"] = round(energy_norm, 3)
        if mean_rms > 0:
            result["loudness"] = round(float(20 * np.log10(mean_rms)), 3)

        # Dynamic range
        try:
            rms_nonzero = rms_frames[rms_frames > 0]
            if len(rms_nonzero) > 1:
                result["dynamic_range"] = round(float(20 * np.log10(np.max(rms_nonzero) / np.min(rms_nonzero))), 3)
        except Exception:
            log.debug("Feature failed for %s", filepath, exc_info=True)

        # Danceability
        try:
            tempo_score = min(1.0, max(0.0, 1.0 - abs(tempo_val - 120) / 80))
            onset_mean = float(np.mean(onset_env)) + 1e-6
            regularity = max(0.0, 1.0 - float(np.std(onset_env)) / onset_mean)
            beat_strength = min(1.0, onset_mean / 10.0)
            result["danceability"] = round(min(1.0, regularity * 0.4 + beat_strength * 0.3 + tempo_score * 0.3), 3)
        except Exception:
            log.debug("Feature failed for %s", filepath, exc_info=True)

        # Valence
        mode_weight = 0.65 if result.get("scale") == "major" else 0.2
        result["valence"] = round(max(0.0, min(1.0, mode_weight * 0.5 + tempo_norm * 0.25 + (1.0 - energy_norm) * 0.25)), 3)

        result["acousticness"] = round(max(0.0, min(1.0, 1.0 - rolloff_norm * 0.4 - zcr_norm * 0.3 - energy_norm * 0.3)), 3)
        result["instrumentalness"] = round(min(1.0, spectral_flatness * 10), 3)

        # Spectral complexity
        try:
            chroma_norm_arr = chroma / (np.sum(chroma, axis=0, keepdims=True) + 1e-8)
            entropy = -np.sum(chroma_norm_arr * np.log2(chroma_norm_arr + 1e-8), axis=0)
            result["spectral_complexity"] = round(min(1.0, float(np.mean(entropy)) / np.log2(12)), 3)
        except Exception:
            log.debug("Feature failed for %s", filepath, exc_info=True)

        # Mood
        dance = result.get("danceability") or 0.5
        is_minor = result.get("scale") == "minor"
        valence = result.get("valence") or 0.5
        acoustic = result.get("acousticness") or 0.5

        result["mood"] = {
            "aggressive": round(max(0.0, min(1.0, energy_norm * 0.35 + zcr_norm * 0.25 + centroid_norm * 0.2 + (1 - valence) * 0.2)), 3),
            "dark": round(max(0.0, min(1.0, (1 - valence) * 0.4 + energy_norm * 0.2 + (0.7 if is_minor else 0.2) * 0.4)), 3),
            "happy": round(max(0.0, min(1.0, valence * 0.5 + tempo_norm * 0.25 + (1 - energy_norm) * 0.25)), 3),
            "sad": round(max(0.0, min(1.0, (1 - valence) * 0.4 + (1 - energy_norm) * 0.3 + (0.7 if is_minor else 0.2) * 0.3)), 3),
            "relaxed": round(max(0.0, min(1.0, (1 - energy_norm) * 0.4 + acoustic * 0.3 + (1 - tempo_norm) * 0.3)), 3),
            "party": round(max(0.0, min(1.0, dance * 0.35 + tempo_norm * 0.25 + energy_norm * 0.2 + valence * 0.2)), 3),
            "electronic": round(max(0.0, min(1.0, (1 - acoustic) * 0.4 + centroid_norm * 0.3 + (1 - zcr_norm) * 0.3)), 3),
            "acoustic": round(max(0.0, min(1.0, acoustic * 0.5 + (1 - centroid_norm) * 0.25 + (1 - energy_norm) * 0.25)), 3),
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
