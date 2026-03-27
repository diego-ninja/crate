"""Tests for crate.audio_analysis — BPM, key, energy detection."""

import os
import tempfile

import numpy as np
import pytest


def _create_sine_wav(path: str, freq: float = 440.0, duration: float = 3.0, sr: int = 22050):
    """Generate a sine wave WAV file."""
    try:
        import scipy.io.wavfile
    except ImportError:
        pytest.skip("scipy not available for WAV generation")

    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    audio = (np.sin(2 * np.pi * freq * t) * 32767).astype(np.int16)
    scipy.io.wavfile.write(path, sr, audio)


class TestAnalyzeTrack:
    def test_analyze_sine_wave(self):
        try:
            import librosa
        except ImportError:
            pytest.skip("librosa not available")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            tmppath = f.name

        try:
            _create_sine_wav(tmppath, freq=440.0, duration=5.0)

            from crate.audio_analysis import analyze_track
            result = analyze_track(tmppath)

            assert isinstance(result, dict)
            assert "bpm" in result
            assert "key" in result
            assert "scale" in result
            assert "energy" in result
            assert "mood" in result

            # A 5-second sine wave should produce some values
            assert result["energy"] is not None
            assert result["key"] is not None
            assert result["scale"] in ("major", "minor")
        finally:
            os.unlink(tmppath)

    def test_analyze_invalid_file(self):
        try:
            import librosa
        except ImportError:
            pytest.skip("librosa not available")

        from crate.audio_analysis import analyze_track
        result = analyze_track("/nonexistent/path/to/file.wav")
        assert result["bpm"] is None
        assert result["key"] is None
        assert result["energy"] is None

    def test_analyze_short_audio(self):
        """Audio shorter than 2 seconds should return all None."""
        try:
            import librosa
        except ImportError:
            pytest.skip("librosa not available")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            tmppath = f.name

        try:
            _create_sine_wav(tmppath, freq=440.0, duration=1.0)

            from crate.audio_analysis import analyze_track
            result = analyze_track(tmppath)

            assert result["bpm"] is None
            assert result["key"] is None
        finally:
            os.unlink(tmppath)

    def test_analyze_returns_mood_dict(self):
        try:
            import librosa
        except ImportError:
            pytest.skip("librosa not available")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            tmppath = f.name

        try:
            _create_sine_wav(tmppath, freq=440.0, duration=5.0)

            from crate.audio_analysis import analyze_track
            result = analyze_track(tmppath)

            if result["mood"] is not None:
                assert isinstance(result["mood"], dict)
                expected_keys = {"happy", "sad", "relaxed", "aggressive",
                                 "electronic", "acoustic", "party", "dark"}
                assert set(result["mood"].keys()) == expected_keys
                for v in result["mood"].values():
                    assert 0.0 <= v <= 1.0
        finally:
            os.unlink(tmppath)
