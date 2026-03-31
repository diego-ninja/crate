"""Audio analysis: BPM, key, energy, danceability, valence, mood, loudness.

Three-tier analysis:
1. Signal processing (Essentia/librosa): BPM, key, loudness, dynamic range
2. PANNs CNN14 (AudioSet 527 classes): mood, energy, danceability, valence
3. Signal heuristics: mood fallback when PANNs not available

Supports single-track and batch analysis for throughput optimization.
"""

import logging
from pathlib import Path
from typing import Union

import numpy as np

log = logging.getLogger(__name__)

# ── Backend detection ─────────────────────────────────────────────

_BACKEND = "none"
_BACKEND_CHECKED = False

def _detect_backend():
    global _BACKEND, _BACKEND_CHECKED
    if _BACKEND_CHECKED:
        return
    _BACKEND_CHECKED = True
    try:
        import essentia.standard  # noqa: F401
        _BACKEND = "essentia"
        log.info("Audio analysis backend: Essentia")
    except ImportError:
        try:
            import librosa  # noqa: F401
            _BACKEND = "librosa"
            log.info("Audio analysis backend: librosa")
        except ImportError:
            log.warning("No audio analysis backend available")

_MODEL_DIR = Path("/app/models")

PANNS_BATCH_SIZE = 4
PANNS_DURATION = 30   # seconds — enough for genre classification
SIGNAL_DURATION = 120  # seconds — for BPM/key accuracy
FRAME_STEP = 4         # analyze every Nth frame for spectral features

# ── PANNs CNN14 (lazy singleton) ──────────────────────────────────

_panns_tagger = None
_panns_lb_to_ix = None
_panns_checked = False
_panns_ok = False

_PANNS_DATA_DIR = Path("/app/panns_data")


def _panns_available() -> bool:
    global _panns_checked, _panns_ok
    if _panns_checked:
        return _panns_ok
    _panns_checked = True
    try:
        import torch  # noqa: F401
        _setup_panns_paths()
        from panns_inference import AudioTagging  # noqa: F401
        _panns_ok = True
    except (ImportError, Exception):
        _panns_ok = False
    log.info("PANNs available: %s", _panns_ok)
    return _panns_ok


def _setup_panns_paths():
    import os
    panns_dir = str(_PANNS_DATA_DIR)
    labels_csv = os.path.join(panns_dir, "class_labels_indices.csv")
    if os.path.isfile(labels_csv):
        import csv
        import panns_inference.config as pcfg
        pcfg.labels_csv_path = labels_csv
        with open(labels_csv, "r") as f:
            reader = csv.reader(f, delimiter=",")
            lines = list(reader)
        pcfg.labels = [lines[i][2] for i in range(1, len(lines))]
        pcfg.ids = [lines[i][1] for i in range(1, len(lines))]
        pcfg.classes_num = len(pcfg.labels)
        pcfg.lb_to_ix = {label: i for i, label in enumerate(pcfg.labels)}
        pcfg.ix_to_lb = {i: label for i, label in enumerate(pcfg.labels)}
        pcfg.id_to_ix = {id_: i for i, id_ in enumerate(pcfg.ids)}
        pcfg.ix_to_id = {i: id_ for i, id_ in enumerate(pcfg.ids)}


def _get_panns():
    global _panns_tagger, _panns_lb_to_ix
    if _panns_tagger is not None:
        return _panns_tagger, _panns_lb_to_ix

    import io
    import sys

    _setup_panns_paths()
    from panns_inference import AudioTagging
    from panns_inference.config import labels, lb_to_ix

    checkpoint = str(_PANNS_DATA_DIR / "Cnn14_mAP=0.431.pth")

    old_stdout = sys.stdout
    sys.stdout = io.StringIO()
    try:
        _panns_tagger = AudioTagging(checkpoint_path=checkpoint, device="cpu")
    finally:
        sys.stdout = old_stdout

    _panns_lb_to_ix = lb_to_ix
    log.info("PANNs CNN14 loaded (%d AudioSet classes)", len(labels))
    return _panns_tagger, _panns_lb_to_ix


# ── AudioSet label groups (label → weight) ───────────────────────

_LABEL_GROUPS = {
    "energy_high": {
        "Heavy metal": 1.5, "Punk rock": 1.2, "Rock music": 0.8,
        "Exciting music": 1.0, "Angry music": 1.2, "Drum kit": 0.6,
        "Electric guitar": 0.5, "Scary music": 0.4, "Drum": 0.4,
        "Rock and roll": 0.4, "Psychedelic rock": 0.3,
    },
    "energy_low": {
        "Ambient music": 1.5, "Classical music": 0.8, "Lullaby": 1.2,
        "Tender music": 1.0, "Silence": 2.0,
    },
    "dance": {
        "Dance music": 1.5, "Electronic dance music": 1.2, "Techno": 1.0,
        "House music": 1.0, "Disco": 1.2, "Drum and bass": 0.8,
        "Funk": 0.8, "Reggae": 0.6, "Soul music": 0.5,
        "Hip hop music": 0.6, "Electronica": 0.5,
    },
    "aggressive": {
        "Heavy metal": 2.0, "Punk rock": 1.2, "Angry music": 2.0,
        "Screaming": 1.5, "Growling": 1.5, "Scary music": 0.8,
        "Drum kit": 0.5, "Drum": 0.3, "Cacophony": 1.0,
        "Rock music": 0.4, "Exciting music": 0.3,
    },
    "happy": {
        "Happy music": 2.0, "Exciting music": 0.5,
        "Disco": 0.3, "Funk": 0.3,
    },
    "sad": {
        "Sad music": 2.0, "Tender music": 0.5, "Lullaby": 0.3,
    },
    "relaxed": {
        "Ambient music": 1.5, "Lullaby": 1.0, "Tender music": 0.8,
        "Classical music": 0.5,
    },
    "acoustic_inst": {
        "Acoustic guitar": 1.2, "Piano": 1.0, "Violin, fiddle": 0.8,
        "Classical music": 0.5, "Blues": 0.3,
    },
    "electronic_inst": {
        "Electronic music": 1.2, "Synthesizer": 1.0, "Drum machine": 0.8,
        "Techno": 0.6, "Electronica": 0.5, "Electronic dance music": 0.4,
    },
    "vocal": {
        "Singing": 1.0, "Male singing": 0.5, "Female singing": 0.5,
        "Rapping": 0.8, "Choir": 0.6, "Speech": 0.3,
    },
    "party": {
        "Dance music": 1.2, "Electronic dance music": 1.0, "Disco": 1.0,
        "Funk": 0.8, "Hip hop music": 0.6, "Happy music": 0.5,
    },
    "dark": {
        "Scary music": 1.5, "Sad music": 0.8, "Angry music": 0.8,
        "Heavy metal": 0.8, "Cacophony": 0.5,
    },
}


def _weighted_sum(probs: np.ndarray, group: dict, lb_to_ix: dict) -> float:
    total = 0.0
    for label, weight in group.items():
        idx = lb_to_ix.get(label)
        if idx is not None:
            total += float(probs[idx]) * weight
    return total


# ── Main entry points ─────────────────────────────────────────────

def analyze_track(filepath: Union[str, Path]) -> dict:
    """Analyze a single audio track. Tries Rust CLI first, falls back to Python.
    If Rust CLI returns partial results (missing danceability/valence/mood),
    supplements with Python backend for the missing metrics."""
    rust = _analyze_rust(str(filepath))
    if rust:
        # Check if advanced metrics are missing — Rust CLI only does signal-level analysis
        has_advanced = any(rust.get(k) is not None for k in ("danceability", "valence", "mood", "acousticness"))
        if not has_advanced:
            _detect_backend()
            supplement = None
            if _BACKEND == "essentia":
                supplement = _analyze_essentia(str(filepath))
            elif _BACKEND == "librosa":
                supplement = _analyze_librosa(str(filepath))
            if supplement:
                # Merge: keep Rust values for basic metrics, add Python values for advanced
                for key in ("danceability", "valence", "acousticness", "instrumentalness",
                            "mood", "spectral_complexity"):
                    if rust.get(key) is None and supplement.get(key) is not None:
                        rust[key] = supplement[key]
        return rust
    # No Rust CLI — full Python analysis
    _detect_backend()
    if _BACKEND == "essentia":
        return _analyze_essentia(str(filepath))
    elif _BACKEND == "librosa":
        return _analyze_librosa(str(filepath))
    return _empty_result()


def _normalize_centroid(hz: float | None) -> float | None:
    """Normalize spectral centroid from Hz to 0-1 scale. Same formula as librosa path."""
    if hz is None:
        return None
    import math
    return round(min(1.0, math.log1p(hz) / math.log1p(4000)), 3)


def analyze_batch(filepaths: list) -> list:
    """Analyze multiple tracks. Tries Rust CLI batch first, falls back to Python.
    If Rust returns partial results (missing danceability/mood), supplements
    each track with Python backend for the missing metrics."""
    rust = _analyze_rust_batch(filepaths)
    if rust:
        _detect_backend()
        if _BACKEND != "none":
            needs_supplement = [
                i for i, r in enumerate(rust)
                if r and not any(r.get(k) is not None for k in ("danceability", "valence", "mood", "acousticness"))
            ]
            if needs_supplement:
                supplement_paths = [filepaths[i] for i in needs_supplement]
                supplements = None
                if _BACKEND == "essentia":
                    supplements = _analyze_batch_essentia(supplement_paths)
                elif _BACKEND == "librosa":
                    supplements = [_analyze_librosa(str(fp)) for fp in supplement_paths]
                if supplements:
                    _ADVANCED_KEYS = ("danceability", "valence", "acousticness", "instrumentalness",
                                      "mood", "spectral_complexity")
                    for idx, sup in zip(needs_supplement, supplements):
                        if sup:
                            for key in _ADVANCED_KEYS:
                                if rust[idx].get(key) is None and sup.get(key) is not None:
                                    rust[idx][key] = sup[key]
        return rust
    _detect_backend()
    if _BACKEND == "essentia":
        return _analyze_batch_essentia(filepaths)
    return [analyze_track(fp) for fp in filepaths]


def _analyze_rust(filepath: str) -> dict | None:
    """Try analyzing with crate-cli. Returns result dict or None to fall back."""
    try:
        from crate.crate_cli import run_analyze, is_available, has_subcommands
        if not is_available() or not has_subcommands():
            return None
        data = run_analyze(file=filepath)
        if not data or data.get("error"):
            return None
        return {
            "bpm": data.get("bpm"),
            "key": data.get("key"),
            "scale": data.get("scale"),
            "energy": data.get("energy"),
            "loudness": data.get("loudness"),
            "dynamic_range": data.get("dynamic_range"),
            "spectral_complexity": _normalize_centroid(data.get("spectral_centroid")),
            "mood": data.get("mood"),
            "danceability": data.get("danceability"),
            "valence": data.get("valence"),
            "acousticness": data.get("acousticness"),
            "instrumentalness": data.get("instrumentalness"),
        }
    except Exception:
        return None


def _analyze_rust_batch(filepaths: list) -> list | None:
    """Try batch analysis with crate-cli. Returns list of results or None."""
    if not filepaths:
        return []
    try:
        from crate.crate_cli import run_analyze, is_available, has_subcommands
        if not is_available() or not has_subcommands():
            return None
        # crate-cli analyze --dir needs a common directory
        # For batch, analyze the parent directory and filter results
        from pathlib import Path as P
        dirs = {str(P(fp).parent) for fp in filepaths}
        if len(dirs) == 1:
            dirpath = dirs.pop()
            data = run_analyze(directory=dirpath)
            if not data or not data.get("tracks"):
                return None
            path_map = {t["path"]: t for t in data["tracks"] if not t.get("error")}
            results = []
            for fp in filepaths:
                t = path_map.get(str(fp))
                if t:
                    results.append({
                        "bpm": t.get("bpm"), "key": t.get("key"), "scale": t.get("scale"),
                        "energy": t.get("energy"), "loudness": t.get("loudness"),
                        "dynamic_range": t.get("dynamic_range"),
                        "spectral_complexity": _normalize_centroid(t.get("spectral_centroid")),
                        "mood": t.get("mood"), "danceability": t.get("danceability"),
                        "valence": t.get("valence"), "acousticness": t.get("acousticness"),
                        "instrumentalness": t.get("instrumentalness"),
                    })
                else:
                    results.append(_empty_result())
            return results
        # Multiple directories — fall back to per-file
        return [_analyze_rust(str(fp)) or _empty_result() for fp in filepaths]
    except Exception:
        return None


def _empty_result() -> dict:
    return {
        "bpm": None, "key": None, "scale": None, "energy": None, "mood": None,
        "danceability": None, "valence": None, "acousticness": None,
        "instrumentalness": None, "loudness": None, "dynamic_range": None,
        "spectral_complexity": None,
    }


# ── Essentia single-track ────────────────────────────────────────

def _analyze_essentia(filepath: str) -> dict:
    from essentia.standard import MonoLoader

    result = _empty_result()
    try:
        audio_44k = MonoLoader(filename=filepath, sampleRate=44100)()
        if len(audio_44k) < 44100 * 2:
            return result
        audio_44k = audio_44k[:44100 * SIGNAL_DURATION]

        _extract_signal_features(audio_44k, result, filepath)

        if _panns_available():
            try:
                audio_32k = _resample(audio_44k, 44100, 32000, PANNS_DURATION)
                _analyze_hybrid_from_arrays(audio_44k, audio_32k, result)
            except Exception:
                log.warning("Hybrid failed, heuristics: %s", filepath, exc_info=True)
                _analyze_essentia_heuristic(audio_44k, result)
        else:
            _analyze_essentia_heuristic(audio_44k, result)
    except Exception:
        log.warning("Analysis failed for %s", filepath, exc_info=True)

    _ensure_native_floats(result)
    return result


# ── Essentia batched ──────────────────────────────────────────────

def _analyze_batch_essentia(filepaths: list) -> list:
    """Batch analysis: signal features sequentially, PANNs in batches."""
    from essentia.standard import MonoLoader

    use_panns = _panns_available()
    items = []  # (filepath, audio_44k, audio_32k, result)

    # Phase 1: Load audio + extract signal features
    for fp in filepaths:
        result = _empty_result()
        try:
            audio_44k = MonoLoader(filename=str(fp), sampleRate=44100)()
            if len(audio_44k) < 44100 * 2:
                items.append((fp, None, None, result))
                continue
            audio_44k = audio_44k[:44100 * SIGNAL_DURATION]
            _extract_signal_features(audio_44k, result, str(fp))

            audio_32k = None
            if use_panns:
                audio_32k = _resample(audio_44k, 44100, 32000, PANNS_DURATION)

            items.append((fp, audio_44k, audio_32k, result))
        except Exception:
            log.warning("Load failed: %s", fp, exc_info=True)
            items.append((fp, None, None, result))

    # Phase 2: Batched PANNs inference
    if use_panns:
        _batch_panns_inference(items)
    else:
        for fp, audio_44k, _, result in items:
            if audio_44k is not None:
                _analyze_essentia_heuristic(audio_44k, result)

    for _, _, _, result in items:
        _ensure_native_floats(result)

    return [r for _, _, _, r in items]


def _batch_panns_inference(items: list):
    """Run PANNs on batches of PANNS_BATCH_SIZE tracks, then compute hybrid features."""
    tagger, lb_to_ix = _get_panns()

    # Group valid items into batches
    valid = [(i, fp, a44, a32, r) for i, (fp, a44, a32, r) in enumerate(items)
             if a32 is not None]

    for batch_start in range(0, len(valid), PANNS_BATCH_SIZE):
        batch = valid[batch_start:batch_start + PANNS_BATCH_SIZE]

        # Pad all to same length and stack
        max_len = max(len(a32) for _, _, _, a32, _ in batch)
        audio_batch = np.zeros((len(batch), max_len), dtype=np.float32)
        for j, (_, _, _, a32, _) in enumerate(batch):
            audio_batch[j, :len(a32)] = a32

        # Batched CNN14 inference
        clipwise_output, _ = tagger.inference(audio_batch)

        # Apply hybrid classification per track
        for j, (_, _, a44, _, result) in enumerate(batch):
            probs = clipwise_output[j]
            _apply_hybrid_from_probs(a44, probs, lb_to_ix, result)

    # Heuristic fallback for items without PANNs audio
    for i, (fp, a44, a32, r) in enumerate(items):
        if a44 is not None and a32 is None:
            _analyze_essentia_heuristic(a44, r)


# ── Signal feature extraction ────────────────────────────────────

def _extract_signal_features(audio: np.ndarray, result: dict, filepath: str = ""):
    """Extract BPM, key, loudness, dynamic range from audio signal."""
    from essentia.standard import (
        RhythmExtractor2013, KeyExtractor,
        DynamicComplexity, LoudnessEBUR128,
    )

    # BPM
    try:
        rhythm = RhythmExtractor2013()(audio)
        bpm = float(rhythm[0])
        result["bpm"] = round(bpm, 1) if bpm > 0 else None
    except Exception:
        log.debug("BPM failed: %s", filepath, exc_info=True)

    # Key + Scale
    try:
        key, scale, _ = KeyExtractor()(audio)
        result["key"] = key
        result["scale"] = scale
    except Exception:
        log.debug("Key failed: %s", filepath, exc_info=True)

    # Loudness (EBU R128, with RMS fallback)
    try:
        loudness = LoudnessEBUR128()(audio)
        result["loudness"] = round(float(loudness[0]), 1)
    except Exception:
        log.debug("EBU R128 failed: %s", filepath, exc_info=True)

    if result["loudness"] is None:
        try:
            rms = float(np.sqrt(np.mean(audio ** 2)))
            if rms > 1e-10:
                result["loudness"] = round(20 * np.log10(rms), 1)
        except Exception:
            pass

    # Dynamic Range
    try:
        dyn, _ = DynamicComplexity()(audio)
        result["dynamic_range"] = round(float(dyn), 3)
    except Exception:
        log.debug("Dynamic range failed: %s", filepath, exc_info=True)


# ── Audio resampling ──────────────────────────────────────────────

def _resample(audio: np.ndarray, orig_sr: int, target_sr: int,
              max_duration: int) -> np.ndarray:
    """Resample audio to target sample rate, truncated to max_duration."""
    # Truncate first (faster than resampling full signal)
    max_samples_orig = orig_sr * max_duration
    if len(audio) > max_samples_orig:
        audio = audio[:max_samples_orig]

    # Simple linear interpolation resampling (fast, good enough for CNN14)
    ratio = target_sr / orig_sr
    target_len = int(len(audio) * ratio)
    indices = np.linspace(0, len(audio) - 1, target_len)
    return np.interp(indices, np.arange(len(audio)), audio).astype(np.float32)


# ── Hybrid analysis (PANNs + signal) ─────────────────────────────

def _analyze_hybrid_from_arrays(audio_44k: np.ndarray, audio_32k: np.ndarray,
                                result: dict):
    """Single-track hybrid: run PANNs + compute features."""
    tagger, lb_to_ix = _get_panns()
    audio_batch = audio_32k[np.newaxis, :]
    clipwise_output, _ = tagger.inference(audio_batch)
    probs = clipwise_output[0]
    _apply_hybrid_from_probs(audio_44k, probs, lb_to_ix, result)


def _apply_hybrid_from_probs(audio_44k: np.ndarray, probs: np.ndarray,
                             lb_to_ix: dict, result: dict):
    """Compute hybrid features from PANNs probs + Essentia signal features."""
    from essentia.standard import (
        Danceability, Energy, SpectralCentroidTime,
        Spectrum, SpectralComplexity, MFCC, FrameGenerator, Windowing,
    )

    def ws(group: str) -> float:
        return _weighted_sum(probs, _LABEL_GROUPS[group], lb_to_ix)

    # Signal features
    tempo_val = result["bpm"] or 120.0
    tempo_norm = min(1.0, tempo_val / 200)
    is_minor = result.get("scale") == "minor"
    mode_weight = 0.65 if result.get("scale") == "major" else 0.2

    try:
        energy_val = float(Energy()(audio_44k))
        rms = (energy_val / len(audio_44k)) ** 0.5
        db = 20 * np.log10(rms + 1e-10)
        energy_signal = max(0.0, min(1.0, (db + 30) / 24))
    except Exception:
        energy_signal = 0.5

    try:
        danceability_val, _ = Danceability()(audio_44k)
        dance_signal = max(0.0, min(1.0, float(danceability_val) / 2.0))
    except Exception:
        dance_signal = 0.5

    # Energy: PANNs genre ratio + signal blend
    e_high = ws("energy_high")
    e_low = ws("energy_low")
    energy_panns = e_high / (e_high + e_low + 0.1)
    result["energy"] = round(max(0.0, min(1.0,
        energy_panns * 0.5 + energy_signal * 0.5)), 3)

    # Danceability: PANNs + signal rhythm
    dance_panns = ws("dance") / 1.2
    result["danceability"] = round(max(0.0, min(1.0,
        dance_panns * 0.4 + dance_signal * 0.6)), 3)

    # Valence: key/tempo heuristic + PANNs modifier
    valence_signal = mode_weight * 0.5 + tempo_norm * 0.25 + (1.0 - energy_signal) * 0.25
    happy_s = ws("happy")
    sad_s = ws("sad")
    valence_panns = happy_s / (happy_s + sad_s + 0.05) if (happy_s + sad_s) > 0.01 else 0.5
    result["valence"] = round(max(0.0, min(1.0,
        valence_signal * 0.6 + valence_panns * 0.4)), 3)

    # Acousticness: PANNs acoustic vs electronic
    ac_s = ws("acoustic_inst")
    el_s = ws("electronic_inst")
    result["acousticness"] = round(max(0.0, min(1.0,
        ac_s / (ac_s + el_s + 0.1))), 3)

    # Instrumentalness: PANNs vocal detection + MFCC blend
    vocal_s = ws("vocal")
    instr_panns = max(0.0, min(1.0, 1.0 - vocal_s / 0.8))

    try:
        windowing = Windowing(type="hann")
        spectrum_algo = Spectrum()
        mfcc_algo = MFCC(numberCoefficients=13)
        frames = list(FrameGenerator(audio_44k, frameSize=2048, hopSize=1024))
        sampled = frames[::FRAME_STEP]  # every Nth frame
        mfcc_values = [mfcc_algo(spectrum_algo(windowing(f)))[1] for f in sampled]
        if mfcc_values:
            mfcc_arr = np.array(mfcc_values)
            vocal_energy = float(np.mean(np.std(mfcc_arr[:, 2:6], axis=0)))
            instr_mfcc = max(0.0, min(1.0, 1.0 - vocal_energy / 30))
            result["instrumentalness"] = round(instr_panns * 0.6 + instr_mfcc * 0.4, 3)
        else:
            result["instrumentalness"] = round(instr_panns, 3)
    except Exception:
        result["instrumentalness"] = round(instr_panns, 3)

    # Spectral Complexity (sampled frames)
    try:
        windowing = Windowing(type="hann")
        spectrum_algo = Spectrum()
        sc_algo = SpectralComplexity()
        frames = list(FrameGenerator(audio_44k, frameSize=2048, hopSize=1024))
        sampled = frames[::FRAME_STEP]
        complexities = [sc_algo(spectrum_algo(windowing(f))) for f in sampled]
        if complexities:
            result["spectral_complexity"] = round(
                min(1.0, float(np.mean(complexities)) / 80), 3)
    except Exception:
        pass

    # Mood
    valence = result["valence"]
    energy_norm = result["energy"]
    acoustic = result["acousticness"]
    dance = result["danceability"]

    result["mood"] = {
        "aggressive": round(min(1.0, ws("aggressive") / 0.8), 3),
        "dark": round(min(1.0, ws("dark") / 0.5), 3),
        "happy": round(max(0.0, min(1.0,
            valence * 0.5 + tempo_norm * 0.25 + (1 - energy_norm) * 0.25)), 3),
        "sad": round(max(0.0, min(1.0,
            (1 - valence) * 0.4 + (1 - energy_norm) * 0.3 + (0.7 if is_minor else 0.2) * 0.3)), 3),
        "relaxed": round(max(0.0, min(1.0,
            (1 - energy_norm) * 0.4 + acoustic * 0.3 + (1 - tempo_norm) * 0.3)), 3),
        "party": round(max(0.0, min(1.0,
            dance * 0.35 + tempo_norm * 0.25 + energy_norm * 0.2 + valence * 0.2)), 3),
        "electronic": round(min(1.0, el_s / 0.8), 3),
        "acoustic": round(min(1.0, ac_s / 0.8), 3),
    }


# ── Essentia heuristic fallback ──────────────────────────────────

def _analyze_essentia_heuristic(audio: np.ndarray, result: dict):
    from essentia.standard import (
        Danceability, Energy, SpectralCentroidTime, ZeroCrossingRate,
        Spectrum, SpectralComplexity, MFCC, FrameGenerator, Windowing,
    )

    tempo_val = result["bpm"] or 120.0

    try:
        try:
            energy_val = float(Energy()(audio))
            rms = (energy_val / len(audio)) ** 0.5
            db = 20 * np.log10(rms + 1e-10)
            result["energy"] = round(max(0.0, min(1.0, (db + 30) / 24)), 3)
        except Exception:
            pass

        energy_norm = result["energy"] or 0.5

        try:
            danceability_val, _ = Danceability()(audio)
            result["danceability"] = round(max(0.0, min(1.0,
                float(danceability_val) / 2.0)), 3)
        except Exception:
            pass

        centroid = float(SpectralCentroidTime()(audio))
        frames = list(FrameGenerator(audio, frameSize=2048, hopSize=1024))
        sampled_frames = frames[::FRAME_STEP]
        zcr_vals = [ZeroCrossingRate()(f) for f in sampled_frames]
        zcr = float(np.mean(zcr_vals)) if zcr_vals else 0.0

        centroid_norm = min(1.0, np.log1p(centroid) / np.log1p(4000))
        zcr_norm = min(1.0, zcr / 0.2)
        tempo_norm = min(1.0, tempo_val / 200)

        mode_weight = 0.65 if result.get("scale") == "major" else 0.2
        result["valence"] = round(max(0.0, min(1.0,
            mode_weight * 0.5 + tempo_norm * 0.25 + (1.0 - energy_norm) * 0.25)), 3)

        result["acousticness"] = round(max(0.0, min(1.0,
            1.0 - centroid_norm * 0.4 - zcr_norm * 0.3 - energy_norm * 0.3)), 3)

        try:
            windowing = Windowing(type="hann")
            spectrum_algo = Spectrum()
            sc_algo = SpectralComplexity()
            complexities = [sc_algo(spectrum_algo(windowing(f))) for f in sampled_frames]
            if complexities:
                result["spectral_complexity"] = round(
                    min(1.0, float(np.mean(complexities)) / 80), 3)
        except Exception:
            pass

        try:
            windowing = Windowing(type="hann")
            spectrum_algo = Spectrum()
            mfcc_algo = MFCC(numberCoefficients=13)
            mfcc_values = [mfcc_algo(spectrum_algo(windowing(f)))[1] for f in sampled_frames]
            if mfcc_values:
                mfcc_arr = np.array(mfcc_values)
                vocal_energy = float(np.mean(np.std(mfcc_arr[:, 2:6], axis=0)))
                result["instrumentalness"] = round(
                    max(0.0, min(1.0, 1.0 - vocal_energy / 30)), 3)
        except Exception:
            pass

        dance = result.get("danceability") or 0.5
        is_minor = result.get("scale") == "minor"
        valence = result.get("valence") or 0.5
        acoustic = result.get("acousticness") or 0.5

        result["mood"] = {
            "aggressive": round(max(0.0, min(1.0,
                energy_norm * 0.45 + zcr_norm * 0.2 + centroid_norm * 0.2 + (1 - valence) * 0.15)), 3),
            "dark": round(max(0.0, min(1.0,
                (1 - valence) * 0.4 + energy_norm * 0.2 + (0.7 if is_minor else 0.2) * 0.4)), 3),
            "happy": round(max(0.0, min(1.0,
                valence * 0.5 + tempo_norm * 0.25 + (1 - energy_norm) * 0.25)), 3),
            "sad": round(max(0.0, min(1.0,
                (1 - valence) * 0.4 + (1 - energy_norm) * 0.3 + (0.7 if is_minor else 0.2) * 0.3)), 3),
            "relaxed": round(max(0.0, min(1.0,
                (1 - energy_norm) * 0.4 + acoustic * 0.3 + (1 - tempo_norm) * 0.3)), 3),
            "party": round(max(0.0, min(1.0,
                dance * 0.35 + tempo_norm * 0.25 + energy_norm * 0.2 + valence * 0.2)), 3),
            "electronic": round(max(0.0, min(1.0,
                (1 - acoustic) * 0.4 + centroid_norm * 0.3 + (1 - zcr_norm) * 0.3)), 3),
            "acoustic": round(max(0.0, min(1.0,
                acoustic * 0.5 + (1 - centroid_norm) * 0.25 + (1 - energy_norm) * 0.25)), 3),
        }
    except Exception:
        log.debug("Heuristic features failed", exc_info=True)


# ── Librosa backend (ARM/dev fallback) ────────────────────────────

def _analyze_librosa(filepath: str) -> dict:
    import librosa

    result = _empty_result()
    try:
        y, sr = librosa.load(filepath, sr=22050, mono=True, duration=SIGNAL_DURATION)
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

        centroid_norm = min(1.0, np.log1p(spectral_centroid) / np.log1p(4000))
        rolloff_norm = min(1.0, spectral_rolloff / (sr / 2))
        zcr_norm = min(1.0, zero_crossing / 0.2)
        db = 20 * np.log10(mean_rms + 1e-10)
        energy_norm = max(0.0, min(1.0, (db + 30) / 24))

        try:
            tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
            if isinstance(tempo, np.ndarray):
                tempo = float(tempo[0])
            result["bpm"] = round(float(tempo), 1) if tempo and tempo > 0 else None
        except Exception:
            pass

        tempo_val = result["bpm"] or 120.0
        tempo_norm = min(1.0, tempo_val / 200)

        try:
            chroma_mean = np.mean(chroma, axis=1)
            major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
                                      2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
            minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
                                      2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
            key_names = ["C", "C#", "D", "D#", "E", "F",
                         "F#", "G", "G#", "A", "A#", "B"]
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

        try:
            rms_nonzero = rms_frames[rms_frames > 0]
            if len(rms_nonzero) > 1:
                result["dynamic_range"] = round(
                    float(20 * np.log10(np.max(rms_nonzero) / np.min(rms_nonzero))), 3)
        except Exception:
            pass

        try:
            tempo_score = min(1.0, max(0.0, 1.0 - abs(tempo_val - 120) / 80))
            onset_mean = float(np.mean(onset_env)) + 1e-6
            regularity = max(0.0, 1.0 - float(np.std(onset_env)) / onset_mean)
            beat_strength = min(1.0, onset_mean / 10.0)
            result["danceability"] = round(
                min(1.0, regularity * 0.4 + beat_strength * 0.3 + tempo_score * 0.3), 3)
        except Exception:
            pass

        mode_weight = 0.65 if result.get("scale") == "major" else 0.2
        result["valence"] = round(max(0.0, min(1.0,
            mode_weight * 0.5 + tempo_norm * 0.25 + (1.0 - energy_norm) * 0.25)), 3)
        result["acousticness"] = round(max(0.0, min(1.0,
            1.0 - rolloff_norm * 0.4 - zcr_norm * 0.3 - energy_norm * 0.3)), 3)
        result["instrumentalness"] = round(min(1.0, spectral_flatness * 10), 3)

        try:
            chroma_norm_arr = chroma / (np.sum(chroma, axis=0, keepdims=True) + 1e-8)
            entropy = -np.sum(chroma_norm_arr * np.log2(chroma_norm_arr + 1e-8), axis=0)
            result["spectral_complexity"] = round(
                min(1.0, float(np.mean(entropy)) / np.log2(12)), 3)
        except Exception:
            pass

        _librosa_mood_heuristic(result, energy_norm, zcr_norm, centroid_norm, tempo_norm)
    except Exception:
        log.warning("Librosa analysis failed for %s", filepath, exc_info=True)

    _ensure_native_floats(result)
    return result


def _librosa_mood_heuristic(result, energy_norm, zcr_norm, centroid_norm, tempo_norm):
    dance = result.get("danceability") or 0.5
    is_minor = result.get("scale") == "minor"
    valence = result.get("valence") or 0.5
    acoustic = result.get("acousticness") or 0.5

    result["mood"] = {
        "aggressive": round(max(0.0, min(1.0,
            energy_norm * 0.45 + zcr_norm * 0.2 + centroid_norm * 0.2 + (1 - valence) * 0.15)), 3),
        "dark": round(max(0.0, min(1.0,
            (1 - valence) * 0.4 + energy_norm * 0.2 + (0.7 if is_minor else 0.2) * 0.4)), 3),
        "happy": round(max(0.0, min(1.0,
            valence * 0.5 + tempo_norm * 0.25 + (1 - energy_norm) * 0.25)), 3),
        "sad": round(max(0.0, min(1.0,
            (1 - valence) * 0.4 + (1 - energy_norm) * 0.3 + (0.7 if is_minor else 0.2) * 0.3)), 3),
        "relaxed": round(max(0.0, min(1.0,
            (1 - energy_norm) * 0.4 + acoustic * 0.3 + (1 - tempo_norm) * 0.3)), 3),
        "party": round(max(0.0, min(1.0,
            dance * 0.35 + tempo_norm * 0.25 + energy_norm * 0.2 + valence * 0.2)), 3),
        "electronic": round(max(0.0, min(1.0,
            (1 - acoustic) * 0.4 + centroid_norm * 0.3 + (1 - zcr_norm) * 0.3)), 3),
        "acoustic": round(max(0.0, min(1.0,
            acoustic * 0.5 + (1 - centroid_norm) * 0.25 + (1 - energy_norm) * 0.25)), 3),
    }


# ── Helpers ───────────────────────────────────────────────────────

def _ensure_native_floats(result: dict):
    for k, v in result.items():
        if v is not None and k != "mood" and not isinstance(v, str):
            try:
                result[k] = float(v)
            except (TypeError, ValueError):
                pass
