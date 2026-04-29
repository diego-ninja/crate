from pathlib import Path

from crate.worker_handlers.acquisition import (
    _locate_soulseek_download_file,
    _select_soulseek_task_downloads,
)


def test_select_soulseek_task_downloads_scopes_to_expected_full_paths():
    downloads = [
        {
            "username": "peer-a",
            "fullPath": "music/Terror/One With The Underdogs/01 - One with the Underdogs.flac",
            "filename": "01 - One with the Underdogs.flac",
        },
        {
            "username": "peer-a",
            "fullPath": "music/Terror/Lowest of the Low/01 - Better Off Without You.flac",
            "filename": "01 - Better Off Without You.flac",
        },
        {
            "username": "peer-b",
            "fullPath": "music/Terror/One With The Underdogs/02 - Keep Your Mouth Shut.flac",
            "filename": "02 - Keep Your Mouth Shut.flac",
        },
    ]

    selected = _select_soulseek_task_downloads(
        downloads,
        username="peer-a",
        expected_files=[
            "music/Terror/One With The Underdogs/01 - One with the Underdogs.flac",
        ],
    )

    assert selected == [downloads[0]]


def test_locate_soulseek_download_file_prefers_exact_path_suffix(tmp_path):
    root = tmp_path / "soulseek"
    wanted = root / "incoming" / "music" / "Terror" / "One With The Underdogs"
    other = root / "incoming" / "music" / "Terror" / "Lowest of the Low"
    wanted.mkdir(parents=True)
    other.mkdir(parents=True)

    wanted_file = wanted / "01 - Intro.flac"
    other_file = other / "01 - Intro.flac"
    wanted_file.write_bytes(b"a")
    other_file.write_bytes(b"b")

    match = _locate_soulseek_download_file(
        root,
        {
            "directory": "music/Terror/One With The Underdogs",
            "fullPath": "music/Terror/One With The Underdogs/01 - Intro.flac",
            "filename": "01 - Intro.flac",
        },
    )

    assert isinstance(match, Path)
    assert match == wanted_file
