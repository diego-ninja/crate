from pathlib import Path

from librarian.config import load_config

COVER_NAMES = ["cover.jpg", "cover.png", "folder.jpg", "folder.png", "front.jpg", "front.png", "album.jpg", "album.png"]


def get_config() -> dict:
    return load_config()


def library_path() -> Path:
    return Path(get_config()["library_path"])


def extensions() -> set[str]:
    return set(get_config().get("audio_extensions", [".flac", ".mp3", ".m4a", ".ogg", ".opus"]))


def exclude_dirs() -> set[str]:
    return set(get_config().get("exclude_dirs", ["music"]))


def safe_path(base: Path, user_path: str) -> Path | None:
    resolved = (base / user_path).resolve()
    if not str(resolved).startswith(str(base.resolve())):
        return None
    return resolved
