from __future__ import annotations

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_playlist_runtime_queries_do_not_resolve_tracks_by_path_suffix_like():
    playlist_query_files = [
        *PROJECT_ROOT.glob("crate/db/queries/*playlist*.py"),
        *PROJECT_ROOT.glob("crate/db/repositories/*playlist*.py"),
    ]

    offenders: list[str] = []
    for path in playlist_query_files:
        content = path.read_text()
        if "LIKE ('%/' ||" in content or "LIKE :track_path" in content:
            offenders.append(str(path.relative_to(PROJECT_ROOT)))

    assert offenders == []

