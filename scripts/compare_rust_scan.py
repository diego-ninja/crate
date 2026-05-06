#!/usr/bin/env python3
"""Compare the Rust read-only scanner with Crate's Python scan semantics."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


DEFAULT_EXTENSIONS = "flac,mp3,m4a,ogg,opus,wav"
TAG_FIELDS = (
    "title",
    "artist",
    "album_artist",
    "album",
    "track_number",
    "disc_number",
    "year",
    "genre",
    "musicbrainz_track_id",
    "musicbrainz_album_id",
    "format",
)
TECH_FIELDS = ("duration_ms", "bitrate", "sample_rate", "bit_depth")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _audio_suffixes(extensions: str) -> set[str]:
    return {
        ext.strip().lower().removeprefix(".")
        for ext in extensions.split(",")
        if ext.strip()
    }


def _relative_posix(root: Path, path: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def _has_hidden_component(relative_path: Path) -> bool:
    return any(part.startswith(".") for part in relative_path.parts)


def _album_structure(root: Path, path: Path) -> tuple[str, Path] | None:
    try:
        rel = path.resolve().relative_to(root.resolve())
    except ValueError:
        return None

    if _has_hidden_component(rel):
        return None

    parts = rel.parts
    if len(parts) < 3:
        return None

    artist = parts[0]
    if len(parts) >= 4 and len(parts[1]) == 4 and parts[1].isdigit():
        album = parts[2]
        album_path = root / artist / parts[1] / album
    else:
        album = parts[1]
        album_path = root / artist / album
    return album, album_path.resolve()


def discover_python_audio_files(root: Path, extensions: str) -> list[Path]:
    """Mirror LibrarySync album scanning without touching the database."""
    suffixes = _audio_suffixes(extensions)
    candidates = sorted(
        path
        for path in root.rglob("*")
        if path.is_file()
        and path.suffix.lower().removeprefix(".") in suffixes
        and _album_structure(root, path) is not None
    )

    albums_with_flac = {
        album_path
        for path in candidates
        if path.suffix.lower() == ".flac"
        for _album, album_path in [_album_structure(root, path)]
    }

    return [
        path
        for path in candidates
        if not (path.suffix.lower() == ".m4a" and _album_structure(root, path)[1] in albums_with_flac)
    ]


def _first_track_number(value: Any) -> int | None:
    if value is None:
        return None
    raw = str(value).split("/", 1)[0].strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _year_value(value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    return raw[:4] if len(raw) >= 4 else raw


def _empty_to_none(value: Any) -> Any:
    if value == "":
        return None
    return value


def build_python_index(root: Path, extensions: str) -> dict[str, dict[str, Any]]:
    sys.path.insert(0, str(repo_root() / "app"))
    from crate.audio import read_audio_quality, read_tags

    index: dict[str, dict[str, Any]] = {}
    for path in discover_python_audio_files(root, extensions):
        tags = read_tags(path)
        quality = read_audio_quality(path)
        rel = _relative_posix(root, path)
        duration = quality.get("duration")
        duration_ms = int(duration * 1000) if duration else None
        index[rel] = {
            "path": str(path),
            "size": path.stat().st_size,
            "title": _empty_to_none(tags.get("title")),
            "artist": _empty_to_none(tags.get("artist")),
            "album_artist": _empty_to_none(tags.get("albumartist")),
            "album": _empty_to_none(tags.get("album")),
            "track_number": _first_track_number(tags.get("tracknumber")),
            "disc_number": _first_track_number(tags.get("discnumber")),
            "year": _year_value(tags.get("date")),
            "genre": _empty_to_none(tags.get("genre")),
            "musicbrainz_track_id": _empty_to_none(tags.get("musicbrainz_trackid")),
            "musicbrainz_album_id": _empty_to_none(tags.get("musicbrainz_albumid")),
            "duration_ms": duration_ms,
            "format": path.suffix.lower().removeprefix("."),
            "bitrate": quality.get("bitrate"),
            "sample_rate": quality.get("sample_rate"),
            "bit_depth": quality.get("bit_depth"),
        }
    return index


def _rust_command(
    root: Path,
    extensions: str,
    crate_cli: Path | None,
    cargo_offline: bool,
) -> list[str]:
    if crate_cli:
        return [
            str(crate_cli),
            "scan",
            "--dir",
            str(root),
            "--extensions",
            extensions,
        ]

    command = ["cargo", "run"]
    if cargo_offline:
        command.append("--offline")
    command.extend(
        [
            "--manifest-path",
            str(repo_root() / "tools/crate-cli/Cargo.toml"),
            "--no-default-features",
            "--",
            "scan",
            "--dir",
            str(root),
            "--extensions",
            extensions,
        ]
    )
    return command


def run_rust_scan(
    root: Path,
    extensions: str,
    crate_cli: Path | None = None,
    cargo_offline: bool = True,
) -> dict[str, Any]:
    completed = subprocess.run(
        _rust_command(root, extensions, crate_cli, cargo_offline),
        cwd=repo_root(),
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(completed.stdout[-1000:]) from exc


def build_rust_index(root: Path, payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    identity_complete = 0

    for artist in payload.get("artists", []):
        for album in artist.get("albums", []):
            for track in album.get("tracks", []):
                path = Path(track["path"])
                tags = track.get("tags") or {}
                identity = tags.get("crate_identity") or {}
                if identity.get("crate_track_uid"):
                    identity_complete += 1

                rel = _relative_posix(root, path)
                index[rel] = {
                    "path": track.get("path"),
                    "size": track.get("size"),
                    "title": _empty_to_none(tags.get("title")),
                    "artist": _empty_to_none(tags.get("artist")),
                    "album_artist": _empty_to_none(tags.get("album_artist")),
                    "album": _empty_to_none(tags.get("album")),
                    "track_number": tags.get("track_number"),
                    "disc_number": tags.get("disc_number"),
                    "year": _empty_to_none(tags.get("year")),
                    "genre": _empty_to_none(tags.get("genre")),
                    "musicbrainz_track_id": _empty_to_none(tags.get("musicbrainz_track_id")),
                    "musicbrainz_album_id": _empty_to_none(tags.get("musicbrainz_album_id")),
                    "duration_ms": tags.get("duration_ms"),
                    "format": tags.get("format"),
                    "bitrate": tags.get("bitrate"),
                    "sample_rate": tags.get("sample_rate"),
                    "bit_depth": tags.get("bit_depth"),
                    "crate_identity": identity,
                }
    index["_meta"] = {"crate_identity_track_uids": identity_complete}
    return index


def _values_match(field: str, python_value: Any, rust_value: Any) -> bool:
    if python_value == rust_value:
        return True
    if field == "duration_ms" and python_value is not None and rust_value is not None:
        return abs(int(python_value) - int(rust_value)) <= 1000
    if field == "bitrate" and python_value is not None and rust_value is not None:
        return abs(int(python_value) - int(rust_value)) <= 2000
    return False


def _lossy_path(path: str) -> bool:
    return Path(path).suffix.lower() in {".aac", ".m4a", ".mp3", ".ogg", ".opus"}


def compare_indexes(
    python_index: dict[str, dict[str, Any]],
    rust_index: dict[str, dict[str, Any]],
    max_diffs: int = 50,
) -> dict[str, Any]:
    rust_meta = rust_index.get("_meta", {})
    rust_tracks = {key: value for key, value in rust_index.items() if key != "_meta"}
    python_paths = set(python_index)
    rust_paths = set(rust_tracks)
    common = sorted(python_paths & rust_paths)

    field_diffs: list[dict[str, Any]] = []
    for rel in common:
        for field in (*TAG_FIELDS, *TECH_FIELDS):
            python_value = python_index[rel].get(field)
            rust_value = rust_tracks[rel].get(field)
            if field == "bit_depth" and rust_value is None and _lossy_path(rel):
                continue
            if not _values_match(field, python_value, rust_value):
                field_diffs.append(
                    {
                        "path": rel,
                        "field": field,
                        "python": python_value,
                        "rust": rust_value,
                    }
                )
                if len(field_diffs) >= max_diffs:
                    break
        if len(field_diffs) >= max_diffs:
            break

    return {
        "python_tracks": len(python_index),
        "rust_tracks": len(rust_tracks),
        "common_tracks": len(common),
        "missing_in_rust": sorted(python_paths - rust_paths)[:max_diffs],
        "extra_in_rust": sorted(rust_paths - python_paths)[:max_diffs],
        "field_diffs": field_diffs,
        "crate_identity_track_uids": rust_meta.get("crate_identity_track_uids", 0),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("library", nargs="?", default="test-music")
    parser.add_argument("--extensions", default=DEFAULT_EXTENSIONS)
    parser.add_argument("--crate-cli", type=Path)
    parser.add_argument("--cargo-online", action="store_true")
    parser.add_argument("--fail-on-diff", action="store_true")
    parser.add_argument("--max-diffs", type=int, default=50)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    library = Path(args.library).resolve()
    if not library.exists():
        parser.error(f"library does not exist: {library}")

    python_index = build_python_index(library, args.extensions)
    rust_payload = run_rust_scan(
        library,
        args.extensions,
        crate_cli=args.crate_cli,
        cargo_offline=not args.cargo_online,
    )
    rust_index = build_rust_index(library, rust_payload)
    summary = compare_indexes(python_index, rust_index, max_diffs=args.max_diffs)

    output = json.dumps(summary, indent=2, sort_keys=True)
    print(output)
    if args.output:
        args.output.write_text(output + "\n")

    has_diff = bool(
        summary["missing_in_rust"] or summary["extra_in_rust"] or summary["field_diffs"]
    )
    return 1 if args.fail_on_diff and has_diff else 0


if __name__ == "__main__":
    raise SystemExit(main())
