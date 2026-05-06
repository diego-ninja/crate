from __future__ import annotations

import subprocess

from crate.streaming import transcode


def test_transcode_variant_specifies_mp4_muxer_for_tmp_output(monkeypatch, tmp_path):
    source_path = tmp_path / "source.flac"
    output_path = tmp_path / "stream-cache" / "balanced" / "track.m4a"
    source_path.write_bytes(b"flac")

    row = {
        "cache_key": "cache-key",
        "source_path": str(source_path),
        "relative_path": "stream-cache/balanced/track.m4a",
        "delivery_bitrate": 192,
        "delivery_sample_rate": 44_100,
    }
    failures: list[str] = []

    monkeypatch.setattr(transcode, "get_variant_by_cache_key", lambda cache_key: row)
    monkeypatch.setattr(transcode, "resolve_data_file", lambda relative_path: output_path)
    monkeypatch.setattr(transcode, "mark_variant_failed", lambda cache_key, error: failures.append(error))
    monkeypatch.setattr(
        transcode,
        "mark_variant_ready",
        lambda cache_key, relative_path, byte_count: {
            **row,
            "status": "ready",
            "bytes": byte_count,
            "relative_path": relative_path,
        },
    )

    def fake_run(cmd, capture_output, text, timeout):
        assert cmd[cmd.index("-threads") + 1] == "1"
        assert cmd[-3:] == ["-f", "mp4", str(output_path.with_suffix(".m4a.tmp"))]
        output_path.with_suffix(".m4a.tmp").write_bytes(b"m4a")
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(transcode.subprocess, "run", fake_run)

    result = transcode.transcode_variant("cache-key")

    assert result["status"] == "ready"
    assert result["bytes"] == 3
    assert output_path.read_bytes() == b"m4a"
    assert not output_path.with_suffix(".m4a.tmp").exists()
    assert failures == []
