from __future__ import annotations

from types import SimpleNamespace


def test_run_scan_supports_scan_only_binary(monkeypatch):
    from crate import crate_cli

    crate_cli.supports_command.cache_clear()
    crate_cli.has_subcommands.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args == ["/usr/local/bin/crate-cli", "--help"]:
            return SimpleNamespace(returncode=0, stdout="Commands:\n  scan\n", stderr="")
        return SimpleNamespace(returncode=0, stdout='{"artists":[]}', stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_scan("/music", hash=False, covers=False) == {"artists": []}
    assert calls[-1][:4] == ["/usr/local/bin/crate-cli", "scan", "--dir", "/music"]


def test_run_analyze_returns_none_when_binary_lacks_analyze(monkeypatch):
    from crate import crate_cli

    crate_cli.supports_command.cache_clear()
    crate_cli.has_subcommands.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0, stdout="Commands:\n  scan\n", stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_analyze(file="/music/track.flac") is None
    assert calls == [["/usr/local/bin/crate-cli", "--help"]]


def test_run_quality_uses_quality_subcommand(monkeypatch):
    from crate import crate_cli

    crate_cli.supports_command.cache_clear()
    crate_cli.has_subcommands.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args == ["/usr/local/bin/crate-cli", "--help"]:
            return SimpleNamespace(returncode=0, stdout="Commands:\n  quality\n", stderr="")
        return SimpleNamespace(returncode=0, stdout='{"tracks":[]}', stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_quality(file="/music/track.flac") == {"tracks": []}
    assert calls[-1] == ["/usr/local/bin/crate-cli", "quality", "--file", "/music/track.flac"]


def test_run_diff_uses_diff_subcommand(monkeypatch):
    from crate import crate_cli

    crate_cli.supports_command.cache_clear()
    crate_cli.has_subcommands.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args == ["/usr/local/bin/crate-cli", "--help"]:
            return SimpleNamespace(returncode=0, stdout="Commands:\n  diff\n", stderr="")
        return SimpleNamespace(returncode=0, stdout='{"added_count":0}', stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_diff("/tmp/before.json", "/tmp/after.json") == {"added_count": 0}
    assert calls[-1] == [
        "/usr/local/bin/crate-cli",
        "diff",
        "--before",
        "/tmp/before.json",
        "--after",
        "/tmp/after.json",
    ]


def test_run_tags_inspect_uses_tags_subcommand(monkeypatch):
    from crate import crate_cli

    crate_cli.supports_command.cache_clear()
    crate_cli.has_subcommands.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args == ["/usr/local/bin/crate-cli", "--help"]:
            return SimpleNamespace(returncode=0, stdout="Commands:\n  tags\n", stderr="")
        return SimpleNamespace(returncode=0, stdout='{"tracks":[]}', stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_tags_inspect(file="/music/track.flac") == {"tracks": []}
    assert calls[-1] == [
        "/usr/local/bin/crate-cli",
        "tags",
        "inspect",
        "--file",
        "/music/track.flac",
    ]


def test_run_tags_write_identity_uses_tags_subcommand(monkeypatch):
    from crate import crate_cli

    crate_cli.supports_command.cache_clear()
    crate_cli.has_subcommands.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args == ["/usr/local/bin/crate-cli", "--help"]:
            return SimpleNamespace(returncode=0, stdout="Commands:\n  tags\n", stderr="")
        return SimpleNamespace(returncode=0, stdout='{"written":false,"dry_run":true}', stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_tags_write_identity(
        "/music/track.flac",
        artist_uid="artist",
        album_uid="album",
        track_uid="track",
        audio_fingerprint="fp",
        audio_fingerprint_source="quick",
        dry_run=True,
    ) == {"written": False, "dry_run": True}
    assert calls[-1] == [
        "/usr/local/bin/crate-cli",
        "tags",
        "write-identity",
        "--file",
        "/music/track.flac",
        "--schema-version",
        "1",
        "--artist-uid",
        "artist",
        "--album-uid",
        "album",
        "--track-uid",
        "track",
        "--audio-fingerprint",
        "fp",
        "--audio-fingerprint-source",
        "quick",
        "--dry-run",
    ]


def test_run_fingerprint_uses_fingerprint_subcommand(monkeypatch):
    from crate import crate_cli

    crate_cli.supports_command.cache_clear()
    crate_cli.has_subcommands.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        if args == ["/usr/local/bin/crate-cli", "--help"]:
            return SimpleNamespace(returncode=0, stdout="Commands:\n  fingerprint\n", stderr="")
        return SimpleNamespace(returncode=0, stdout='{"tracks":[]}', stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_fingerprint(file="/music/track.flac", mode="full") == {"tracks": []}
    assert calls[-1] == [
        "/usr/local/bin/crate-cli",
        "fingerprint",
        "--mode",
        "full",
        "--file",
        "/music/track.flac",
    ]


def test_run_bliss_does_not_treat_scan_only_crate_cli_as_legacy_binary(monkeypatch):
    from crate import crate_cli

    crate_cli.supports_command.cache_clear()
    crate_cli.has_subcommands.cache_clear()
    monkeypatch.setattr(crate_cli, "find_binary", lambda: "/usr/local/bin/crate-cli")

    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0, stdout="Commands:\n  scan\n", stderr="")

    monkeypatch.setattr(crate_cli.subprocess, "run", fake_run)

    assert crate_cli.run_bliss(file="/music/track.flac") is None
    assert calls == [["/usr/local/bin/crate-cli", "--help"]]
