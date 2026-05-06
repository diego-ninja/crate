"""Integration with crate-cli Rust binary for high-performance audio operations."""

import json
import logging
import os
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

log = logging.getLogger(__name__)

BIN_NAMES = ["crate-cli"]
BIN_PATHS = ["/app/bin/crate-cli", "/usr/local/bin/crate-cli"]


@lru_cache(maxsize=1)
def find_binary() -> str | None:
    for path in BIN_PATHS:
        if Path(path).is_file():
            return path
    for name in BIN_NAMES:
        found = shutil.which(name)
        if found:
            return found
    return None


def is_available() -> bool:
    return find_binary() is not None


def _has_subcommands() -> bool:
    """Check if the binary supports clap-style subcommands."""
    binary = find_binary()
    if not binary:
        return False
    try:
        result = subprocess.run([binary, "--help"], capture_output=True, text=True, timeout=5)
        return "scan" in result.stdout.lower()
    except Exception:
        return False


@lru_cache(maxsize=1)
def has_subcommands() -> bool:
    return _has_subcommands()


@lru_cache(maxsize=16)
def supports_command(command: str) -> bool:
    binary = find_binary()
    if not binary:
        return False
    try:
        result = subprocess.run([binary, "--help"], capture_output=True, text=True, timeout=5)
    except Exception:
        return False
    return command.lower() in result.stdout.lower()


def _scan_timeout() -> int:
    try:
        return max(1, int(os.environ.get("CRATE_CLI_SCAN_TIMEOUT_SECONDS", "900")))
    except ValueError:
        return 900


def _quality_timeout() -> int:
    try:
        return max(1, int(os.environ.get("CRATE_CLI_QUALITY_TIMEOUT_SECONDS", "300")))
    except ValueError:
        return 300


def _diff_timeout() -> int:
    try:
        return max(1, int(os.environ.get("CRATE_CLI_DIFF_TIMEOUT_SECONDS", "300")))
    except ValueError:
        return 300


def run_scan(directory: str, hash: bool = True, covers: bool = True,
             extensions: str = "flac,mp3,m4a,ogg,opus",
             timeout: int | None = None) -> dict | None:
    """Scan directory with Rust CLI. Returns ScanResult or None."""
    binary = find_binary()
    if not binary or not supports_command("scan"):
        return None
    args = [binary, "scan", "--dir", directory, "--extensions", extensions]
    if hash:
        args.append("--hash")
    if covers:
        args.append("--covers")
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout or _scan_timeout())
        if result.returncode != 0:
            log.warning("crate-cli scan failed: %s", result.stderr[:200])
            return None
        return json.loads(result.stdout)
    except Exception:
        log.warning("crate-cli scan subprocess failed", exc_info=True)
        return None


def run_quality(directory: str = "", file: str = "",
                extensions: str = "flac,mp3,m4a,ogg,opus,wav",
                timeout: int | None = None) -> dict | None:
    """Probe technical audio metadata with Rust CLI. Returns QualityResult or None."""
    binary = find_binary()
    if not binary or not supports_command("quality"):
        return None
    args = [binary, "quality"]
    if file:
        args.extend(["--file", file])
    elif directory:
        args.extend(["--dir", directory, "--extensions", extensions])
    else:
        return None
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout or _quality_timeout())
        if result.returncode != 0:
            log.warning("crate-cli quality failed: %s", result.stderr[:200])
            return None
        return json.loads(result.stdout)
    except Exception:
        log.warning("crate-cli quality subprocess failed", exc_info=True)
        return None


def run_diff(before: str, after: str, timeout: int | None = None) -> dict | None:
    """Diff two crate-cli scan JSON snapshots. Returns ScanDiff or None."""
    binary = find_binary()
    if not binary or not supports_command("diff"):
        return None
    args = [binary, "diff", "--before", before, "--after", after]
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout or _diff_timeout())
        if result.returncode != 0:
            log.warning("crate-cli diff failed: %s", result.stderr[:200])
            return None
        return json.loads(result.stdout)
    except Exception:
        log.warning("crate-cli diff subprocess failed", exc_info=True)
        return None


def run_tags_inspect(directory: str = "", file: str = "",
                     extensions: str = "flac,mp3,m4a,ogg,opus,wav",
                     timeout: int | None = None) -> dict | None:
    """Inspect normalized tags with Rust CLI. Returns TagInspectResult or None."""
    binary = find_binary()
    if not binary or not supports_command("tags"):
        return None
    args = [binary, "tags", "inspect"]
    if file:
        args.extend(["--file", file])
    elif directory:
        args.extend(["--dir", directory, "--extensions", extensions])
    else:
        return None
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout or _quality_timeout())
        if result.returncode != 0:
            log.warning("crate-cli tags inspect failed: %s", result.stderr[:200])
            return None
        return json.loads(result.stdout)
    except Exception:
        log.warning("crate-cli tags inspect subprocess failed", exc_info=True)
        return None


def run_tags_write_identity(file: str, *,
                            artist_uid: str,
                            album_uid: str,
                            track_uid: str,
                            schema_version: str = "1",
                            audio_fingerprint: str = "",
                            audio_fingerprint_source: str = "",
                            dry_run: bool = False,
                            timeout: int | None = None) -> dict | None:
    """Write Crate identity tags with Rust CLI. Intended for worker-side file writes."""
    binary = find_binary()
    if not binary or not supports_command("tags"):
        return None
    if not file:
        return None
    args = [
        binary,
        "tags",
        "write-identity",
        "--file",
        file,
        "--schema-version",
        schema_version,
        "--artist-uid",
        artist_uid,
        "--album-uid",
        album_uid,
        "--track-uid",
        track_uid,
    ]
    if audio_fingerprint:
        args.extend(["--audio-fingerprint", audio_fingerprint])
    if audio_fingerprint_source:
        args.extend(["--audio-fingerprint-source", audio_fingerprint_source])
    if dry_run:
        args.append("--dry-run")
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout or _quality_timeout())
        if result.returncode != 0:
            log.warning("crate-cli tags write-identity failed: %s", result.stderr[:200])
            return None
        return json.loads(result.stdout)
    except Exception:
        log.warning("crate-cli tags write-identity subprocess failed", exc_info=True)
        return None


def run_fingerprint(directory: str = "", file: str = "",
                    extensions: str = "flac,mp3,m4a,ogg,opus,wav",
                    mode: str = "quick",
                    timeout: int | None = None) -> dict | None:
    """Compute compact file fingerprints with Rust CLI."""
    binary = find_binary()
    if not binary or not supports_command("fingerprint"):
        return None
    args = [binary, "fingerprint", "--mode", mode]
    if file:
        args.extend(["--file", file])
    elif directory:
        args.extend(["--dir", directory, "--extensions", extensions])
    else:
        return None
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout or _quality_timeout())
        if result.returncode != 0:
            log.warning("crate-cli fingerprint failed: %s", result.stderr[:200])
            return None
        return json.loads(result.stdout)
    except Exception:
        log.warning("crate-cli fingerprint subprocess failed", exc_info=True)
        return None


PANNS_ONNX_PATHS = [
    "/app/models/panns_cnn14.onnx",
    "/usr/local/share/crate/panns_cnn14.onnx",
]


@lru_cache(maxsize=1)
def _find_panns_model() -> str | None:
    for p in PANNS_ONNX_PATHS:
        if Path(p).is_file():
            return p
    return None


def run_analyze(directory: str = "", file: str = "",
                extensions: str = "flac,mp3,m4a,ogg,opus") -> dict | None:
    """Run audio analysis with Rust CLI. Returns AnalysisResult(s) or None."""
    binary = find_binary()
    if not binary or not supports_command("analyze"):
        return None
    args = [binary, "analyze"]
    model = _find_panns_model()
    if model:
        args.extend(["--model-path", model])
    if file:
        args.extend(["--file", file])
    elif directory:
        args.extend(["--dir", directory, "--extensions", extensions])
    else:
        return None
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=3600)
        if result.returncode != 0:
            log.warning("crate-cli analyze failed: %s", result.stderr[:200])
            return None
        return json.loads(result.stdout)
    except Exception:
        log.warning("crate-cli analyze subprocess failed", exc_info=True)
        return None


def run_bliss(directory: str = "", file: str = "",
              similar_to: str = "", limit: int = 20,
              extensions: str = "flac,mp3,m4a,ogg,opus") -> dict | None:
    """Run bliss analysis with Rust CLI."""
    binary = find_binary()
    if not binary or not supports_command("bliss"):
        return None
    args = [binary, "bliss"]
    if file:
        args.extend(["--file", file])
    elif directory:
        args.extend(["--dir", directory, "--extensions", extensions])
    else:
        return None
    if similar_to:
        args.extend(["--similar-to", similar_to, "--limit", str(limit)])
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=3600)
        if result.returncode != 0:
            return None
        return json.loads(result.stdout)
    except Exception:
        log.warning("crate-cli bliss failed", exc_info=True)
        return None
