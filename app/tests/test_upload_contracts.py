"""Regression contracts for upload ingest."""

import io
import zipfile
from pathlib import Path
from unittest.mock import patch

import pytest

from crate.worker_handlers.acquisition import _group_loose_audio_files, _safe_extract_zip


class TestUploadApiContract:
    def test_upload_queues_library_upload_task(self, test_app, tmp_path):
        uploads_root = tmp_path / "uploads"

        with patch("crate.api.acquisition._upload_staging_root", return_value=uploads_root), \
             patch("crate.api.acquisition.create_task", return_value="task-upload-1") as mock_create_task:
            resp = test_app.post(
                "/api/acquisition/upload",
                files=[
                    ("files", ("track.mp3", b"fake-mp3-data", "audio/mpeg")),
                    ("files", ("album.zip", b"PK\x03\x04fake-zip", "application/zip")),
                ],
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["task_id"] == "task-upload-1"
        assert data["file_count"] == 2

        args = mock_create_task.call_args[0]
        params = mock_create_task.call_args[0][1]
        assert args[0] == "library_upload"
        assert params["uploader_user_id"] == 1
        assert params["source"] == "admin_upload"
        assert Path(params["staging_dir"]).exists()
        assert len(params["files"]) == 2

    def test_upload_rejects_unsupported_extension(self, test_app, tmp_path):
        uploads_root = tmp_path / "uploads"

        with patch("crate.api.acquisition._upload_staging_root", return_value=uploads_root):
            resp = test_app.post(
                "/api/acquisition/upload",
                files=[("files", ("notes.txt", b"not music", "text/plain"))],
            )

        assert resp.status_code == 400
        assert "Unsupported file type" in resp.text


class TestUploadWorkerHelpers:
    def test_group_loose_audio_files_uses_audio_tags_for_destination(self, tmp_path, monkeypatch):
        raw_dir = tmp_path / "raw"
        grouped_dir = tmp_path / "grouped"
        raw_dir.mkdir()
        track = raw_dir / "01-track.mp3"
        track.write_bytes(b"fake-audio")

        monkeypatch.setattr(
            "crate.worker_handlers.acquisition.read_tags",
            lambda _path: {
                "artist": "Converge",
                "albumartist": "Converge",
                "album": "Jane Doe",
            },
        )

        moved = _group_loose_audio_files(raw_dir, grouped_dir, {".mp3"})
        assert moved == 1
        assert not track.exists()
        assert (grouped_dir / "Converge" / "Jane Doe" / "01-track.mp3").exists()

    def test_safe_extract_zip_blocks_path_traversal(self, tmp_path):
        archive_path = tmp_path / "bad.zip"
        dest_dir = tmp_path / "extract"
        dest_dir.mkdir()

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("../escape.txt", "nope")
        archive_path.write_bytes(buffer.getvalue())

        with pytest.raises(ValueError):
            _safe_extract_zip(archive_path, dest_dir)
