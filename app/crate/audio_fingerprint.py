from __future__ import annotations

import hashlib
import json
import logging
import os
import subprocess
from pathlib import Path

from crate.resource_governor import low_priority_command


log = logging.getLogger(__name__)

CHROMAPRINT_V1 = "chromaprint-v1"
PCM16_MD5_V1 = "pcm16-md5-v1"


def _ffmpeg_threads() -> str:
    raw = os.environ.get("CRATE_FFMPEG_THREADS", "1")
    try:
        return str(max(1, int(raw)))
    except ValueError:
        return "1"


def _compute_chromaprint(path: Path, *, timeout_seconds: int = 300) -> tuple[str, str] | None:
    try:
        proc = subprocess.run(
            low_priority_command(["fpcalc", "-json", str(path)]),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except FileNotFoundError:
        return None
    except Exception:
        log.debug("Failed to compute chromaprint for %s", path, exc_info=True)
        return None

    if proc.returncode != 0:
        stderr = (proc.stderr or "").strip()
        if stderr:
            log.debug("fpcalc failed for %s: %s", path, stderr)
        return None

    try:
        payload = json.loads(proc.stdout or "{}")
        fingerprint = str(payload.get("fingerprint") or "").strip()
        if not fingerprint:
            return None
        return f"{CHROMAPRINT_V1}:{fingerprint}", CHROMAPRINT_V1
    except Exception:
        log.debug("Invalid fpcalc JSON for %s", path, exc_info=True)
        return None


def _compute_pcm16_md5(path: Path, *, timeout_seconds: int = 300) -> tuple[str, str] | None:
    """Return a deterministic fingerprint of decoded PCM audio.

    The hash is computed over ffmpeg-decoded signed 16-bit PCM bytes, so it is
    stable across metadata/container changes while still representing the audio
    content itself.
    """
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-threads",
        _ffmpeg_threads(),
        "-i",
        str(path),
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-acodec",
        "pcm_s16le",
        "-f",
        "s16le",
        "-",
    ]

    digest = hashlib.md5(usedforsecurity=False)
    wrote_audio = False
    proc: subprocess.Popen[bytes] | None = None
    try:
        proc = subprocess.Popen(low_priority_command(cmd), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert proc.stdout is not None
        for chunk in iter(lambda: proc.stdout.read(1024 * 1024), b""):
            if not chunk:
                break
            wrote_audio = True
            digest.update(chunk)
        stderr = b""
        if proc.stderr is not None:
            stderr = proc.stderr.read()
        return_code = proc.wait(timeout=timeout_seconds)
        if return_code != 0 or not wrote_audio:
            if return_code != 0:
                log.debug("ffmpeg fingerprint failed for %s: %s", path, stderr.decode("utf-8", "ignore"))
            return None
        return f"{PCM16_MD5_V1}:{digest.hexdigest()}", PCM16_MD5_V1
    except Exception:
        log.debug("Failed to compute PCM fingerprint for %s", path, exc_info=True)
        if proc is not None:
            try:
                proc.kill()
            except Exception:
                pass
        return None


def compute_audio_fingerprint_with_source(path: str | Path, *, timeout_seconds: int = 300) -> tuple[str, str] | None:
    source = Path(path)
    if not source.is_file():
        return None

    return _compute_chromaprint(source, timeout_seconds=timeout_seconds) or _compute_pcm16_md5(
        source,
        timeout_seconds=timeout_seconds,
    )


def compute_audio_fingerprint(path: str | Path, *, timeout_seconds: int = 300) -> str | None:
    payload = compute_audio_fingerprint_with_source(path, timeout_seconds=timeout_seconds)
    return payload[0] if payload else None


__all__ = [
    "CHROMAPRINT_V1",
    "PCM16_MD5_V1",
    "compute_audio_fingerprint",
    "compute_audio_fingerprint_with_source",
]
