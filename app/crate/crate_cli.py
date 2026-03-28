"""Integration with crate-cli Rust binary for high-performance audio operations."""

import json
import logging
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

log = logging.getLogger(__name__)

BIN_NAMES = ["crate-cli", "grooveyard-bliss"]
BIN_PATHS = ["/app/bin/crate-cli", "/usr/local/bin/crate-cli",
             "/app/bin/grooveyard-bliss", "/usr/local/bin/grooveyard-bliss"]


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
    """Check if the binary supports subcommands (crate-cli v0.2+)."""
    binary = find_binary()
    if not binary:
        return False
    try:
        result = subprocess.run([binary, "--help"], capture_output=True, text=True, timeout=5)
        return "scan" in result.stdout.lower() and "analyze" in result.stdout.lower()
    except Exception:
        return False


@lru_cache(maxsize=1)
def has_subcommands() -> bool:
    return _has_subcommands()


def run_scan(directory: str, hash: bool = True, covers: bool = True,
             extensions: str = "flac,mp3,m4a,ogg,opus") -> dict | None:
    """Scan directory with Rust CLI. Returns ScanResult or None."""
    binary = find_binary()
    if not binary or not has_subcommands():
        return None
    args = [binary, "scan", "--dir", directory, "--extensions", extensions]
    if hash:
        args.append("--hash")
    if covers:
        args.append("--covers")
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            log.warning("crate-cli scan failed: %s", result.stderr[:200])
            return None
        return json.loads(result.stdout)
    except Exception:
        log.warning("crate-cli scan subprocess failed", exc_info=True)
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
    if not binary or not has_subcommands():
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
    if not binary:
        return None
    if has_subcommands():
        args = [binary, "bliss"]
    else:
        args = [binary]
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
