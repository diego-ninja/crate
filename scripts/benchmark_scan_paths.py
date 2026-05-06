#!/usr/bin/env python3
"""Benchmark Python vs Rust scan paths on a local Crate library tree."""

from __future__ import annotations

import argparse
import json
import statistics
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any
from unittest.mock import patch

from compare_rust_scan import (
    DEFAULT_EXTENSIONS,
    _album_structure,
    build_python_index,
    build_rust_index,
    discover_python_audio_files,
    run_rust_scan,
)


def _run_repeated(label: str, repeats: int, fn: Callable[[], Any]) -> tuple[dict[str, Any], Any]:
    timings: list[float] = []
    last_result: Any = None
    for _ in range(repeats):
        started = time.perf_counter()
        last_result = fn()
        timings.append((time.perf_counter() - started) * 1000)
    return (
        {
            "label": label,
            "runs_ms": [round(value, 2) for value in timings],
            "min_ms": round(min(timings), 2),
            "median_ms": round(statistics.median(timings), 2),
            "max_ms": round(max(timings), 2),
        },
        last_result,
    )


def _audio_file_count(root: Path, extensions: str) -> int:
    suffixes = {
        ext.strip().lower().removeprefix(".")
        for ext in extensions.split(",")
        if ext.strip()
    }
    return sum(
        1
        for path in root.rglob("*")
        if path.is_file() and path.suffix.lower().removeprefix(".") in suffixes
    )


def _extensions_config(extensions: str) -> list[str]:
    return [
        f".{ext.strip().lower().removeprefix('.')}"
        for ext in extensions.split(",")
        if ext.strip()
    ]


def _artist_name_for_album(root: Path, album_dir: Path) -> str:
    try:
        rel = album_dir.resolve().relative_to(root.resolve())
    except ValueError:
        return album_dir.parent.name
    parts = rel.parts
    if len(parts) >= 2:
        return parts[0]
    parent = album_dir.parent
    if parent.name.isdigit() and len(parent.name) == 4:
        return parent.parent.name
    return parent.name


def _configure_crate_cli_path(crate_cli: Path | None) -> None:
    if not crate_cli:
        return
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
    from crate import crate_cli as crate_cli_module

    crate_cli_module.BIN_PATHS.insert(0, str(crate_cli))
    crate_cli_module.find_binary.cache_clear()
    crate_cli_module.has_subcommands.cache_clear()
    crate_cli_module.supports_command.cache_clear()


def run_library_sync_payload(root: Path, extensions: str, crate_cli: Path | None) -> dict[str, Any]:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
    _configure_crate_cli_path(crate_cli)

    from crate.library_sync import LibrarySync

    album_dirs = sorted({
        album_path
        for path in discover_python_audio_files(root, extensions)
        for _album_name, album_path in [_album_structure(root, path)]
        if album_path is not None
    })
    sync = LibrarySync({
        "library_path": str(root),
        "audio_extensions": _extensions_config(extensions),
    })
    results: list[dict[str, Any]] = []
    with patch("crate.library_sync.get_album_id_by_path", return_value=None), \
         patch("crate.library_sync.get_tracks_by_album_id", return_value={}), \
         patch("crate.library_sync.upsert_scanned_album", side_effect=lambda **kwargs: (
             kwargs["artist_payload"]["name"],
             1,
             {track["path"] for track in kwargs["track_payloads"]},
         )), \
         patch("crate.library_sync.delete_track_by_path"):
        for album_dir in album_dirs:
            results.append(sync._sync_album_unlocked(album_dir, _artist_name_for_album(root, album_dir)))

    return {
        "album_count": len(album_dirs),
        "track_count": sum(int(result.get("track_count") or 0) for result in results),
        "total_size": sum(int(result.get("total_size") or 0) for result in results),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("library", nargs="?", default="test-music")
    parser.add_argument("--extensions", default=DEFAULT_EXTENSIONS)
    parser.add_argument("--crate-cli", type=Path, default=Path("tools/crate-cli/target/release/crate-cli"))
    parser.add_argument("--cargo-online", action="store_true")
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()

    library = Path(args.library).resolve()
    if not library.exists():
        parser.error(f"library does not exist: {library}")

    repeats = max(1, args.repeats)
    crate_cli = args.crate_cli.resolve() if args.crate_cli and args.crate_cli.exists() else None

    python_discovery, discovered_paths = _run_repeated(
        "python_discovery",
        repeats,
        lambda: discover_python_audio_files(library, args.extensions),
    )
    python_index, python_payload = _run_repeated(
        "python_tags_quality_index",
        repeats,
        lambda: build_python_index(library, args.extensions),
    )
    library_sync_payload, library_sync_result = _run_repeated(
        "python_library_sync_payload",
        repeats,
        lambda: run_library_sync_payload(library, args.extensions, crate_cli),
    )
    rust_scan, rust_payload = _run_repeated(
        "rust_scan_json",
        repeats,
        lambda: run_rust_scan(
            library,
            args.extensions,
            crate_cli=crate_cli,
            cargo_offline=not args.cargo_online,
        ),
    )
    rust_index, rust_index_payload = _run_repeated(
        "rust_index_build",
        repeats,
        lambda: build_rust_index(library, rust_payload),
    )

    rust_track_count = len({key for key in rust_index_payload if key != "_meta"})
    summary = {
        "library": str(library),
        "extensions": args.extensions,
        "crate_cli": str(crate_cli) if crate_cli else "cargo run",
        "physical_audio_files": _audio_file_count(library, args.extensions),
        "effective_python_tracks": len(discovered_paths),
        "python_index_tracks": len(python_payload),
        "library_sync_tracks": library_sync_result["track_count"],
        "library_sync_albums": library_sync_result["album_count"],
        "rust_tracks": rust_track_count,
        "benchmarks": [python_discovery, python_index, library_sync_payload, rust_scan, rust_index],
        "speedups": {
            "rust_scan_vs_python_tags_quality": round(
                python_index["median_ms"] / rust_scan["median_ms"],
                2,
            )
            if rust_scan["median_ms"]
            else None,
            "rust_scan_plus_index_vs_python_tags_quality": round(
                python_index["median_ms"] / (rust_scan["median_ms"] + rust_index["median_ms"]),
                2,
            )
            if rust_scan["median_ms"] + rust_index["median_ms"]
            else None,
            "rust_scan_plus_index_vs_library_sync_payload": round(
                library_sync_payload["median_ms"] / (rust_scan["median_ms"] + rust_index["median_ms"]),
                2,
            )
            if rust_scan["median_ms"] + rust_index["median_ms"]
            else None,
        },
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
