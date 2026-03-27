"""Tests for content hash change detection (_compute_dir_hash)."""

import tempfile
from pathlib import Path

import pytest


class TestComputeDirHash:
    """Test the Python fallback of _compute_dir_hash (no Rust CLI in test env)."""

    def _compute(self, directory: Path) -> str:
        """Call _compute_dir_hash forcing Python fallback (no Rust CLI in test)."""
        from unittest.mock import patch, MagicMock
        # Make crate_cli.is_available return False so Python fallback is used
        mock_cli = MagicMock()
        mock_cli.is_available.return_value = False
        with patch.dict("sys.modules", {"crate.crate_cli": mock_cli}):
            from crate.worker import _compute_dir_hash
            return _compute_dir_hash(directory)

    def test_hash_deterministic(self):
        """Same files should produce the same hash across calls."""
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "a.flac").write_bytes(b"\x00" * 100)
            (Path(d) / "b.mp3").write_bytes(b"\x01" * 50)

            h1 = self._compute(Path(d))
            h2 = self._compute(Path(d))
            assert h1 == h2

    def test_hash_changes_on_new_file(self):
        """Adding a file should change the hash."""
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "a.flac").write_bytes(b"\x00" * 100)
            h1 = self._compute(Path(d))

            (Path(d) / "b.mp3").write_bytes(b"\x01" * 50)
            h2 = self._compute(Path(d))

            assert h1 != h2

    def test_hash_changes_on_size_change(self):
        """Changing file content (size) should change the hash."""
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "track.flac"
            f.write_bytes(b"\x00" * 100)
            h1 = self._compute(Path(d))

            f.write_bytes(b"\x00" * 200)
            h2 = self._compute(Path(d))

            assert h1 != h2

    def test_hash_stable_across_file_rename(self):
        """Renaming a file should change the hash (filename is part of identity)."""
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "old_name.flac").write_bytes(b"\x00" * 100)
            h1 = self._compute(Path(d))

            (Path(d) / "old_name.flac").rename(Path(d) / "new_name.flac")
            h2 = self._compute(Path(d))

            assert h1 != h2

    def test_empty_dir(self):
        """Empty directory should produce a valid hash."""
        with tempfile.TemporaryDirectory() as d:
            h = self._compute(Path(d))
            assert isinstance(h, str)
            assert len(h) == 32  # md5 hex digest

    def test_includes_subdirectories(self):
        """Files in subdirectories should be included in the hash."""
        with tempfile.TemporaryDirectory() as d:
            h1 = self._compute(Path(d))

            sub = Path(d) / "subdir"
            sub.mkdir()
            (sub / "nested.flac").write_bytes(b"\x00" * 50)
            h2 = self._compute(Path(d))

            assert h1 != h2

    def test_hash_not_affected_by_mtime(self):
        """Hash uses filename + size, not mtime, so touching a file shouldn't change it."""
        with tempfile.TemporaryDirectory() as d:
            import os, time
            f = Path(d) / "track.flac"
            f.write_bytes(b"\x00" * 100)
            h1 = self._compute(Path(d))

            # Change mtime without changing content/size
            os.utime(f, (time.time() + 100, time.time() + 100))
            h2 = self._compute(Path(d))

            assert h1 == h2


class TestShouldProcessArtist:
    """Test the skip-if-unchanged logic in _should_process_artist.

    _should_process_artist does `from crate.db import get_library_artist` inside the function,
    so we patch `crate.db.get_library_artist` which is the re-export from crate.db.__init__.
    """

    def test_returns_true_when_no_previous_hash(self):
        """First time processing (no content_hash) should always proceed."""
        from unittest.mock import patch
        from crate.worker import _should_process_artist

        with tempfile.TemporaryDirectory() as lib:
            artist_dir = Path(lib) / "NewBand"
            artist_dir.mkdir()
            (artist_dir / "track.flac").write_bytes(b"\x00")

            config = {"library_path": lib}

            with patch("crate.db.get_library_artist", return_value={"folder_name": "NewBand", "content_hash": None}):
                assert _should_process_artist("NewBand", config) is True

    def test_returns_false_when_hash_matches(self):
        """If content hasn't changed, should return False."""
        from unittest.mock import patch, MagicMock
        from crate.worker import _should_process_artist, _compute_dir_hash

        with tempfile.TemporaryDirectory() as lib:
            artist_dir = Path(lib) / "SameBand"
            artist_dir.mkdir()
            (artist_dir / "track.flac").write_bytes(b"\x00" * 100)

            config = {"library_path": lib}

            # Pre-compute the hash using Python fallback
            mock_cli = MagicMock()
            mock_cli.is_available.return_value = False
            with patch.dict("sys.modules", {"crate.crate_cli": mock_cli}):
                current_hash = _compute_dir_hash(artist_dir)

            with patch("crate.db.get_library_artist", return_value={"folder_name": "SameBand", "content_hash": current_hash}):
                assert _should_process_artist("SameBand", config) is False

    def test_returns_true_when_hash_differs(self):
        """If content changed, should return True."""
        from unittest.mock import patch
        from crate.worker import _should_process_artist

        with tempfile.TemporaryDirectory() as lib:
            artist_dir = Path(lib) / "ChangedBand"
            artist_dir.mkdir()
            (artist_dir / "track.flac").write_bytes(b"\x00" * 100)

            config = {"library_path": lib}

            with patch("crate.db.get_library_artist", return_value={"folder_name": "ChangedBand", "content_hash": "stale_old_hash"}):
                assert _should_process_artist("ChangedBand", config) is True

    def test_returns_false_when_dir_missing(self):
        """If the artist directory doesn't exist, return False (nothing to process)."""
        from unittest.mock import patch
        from crate.worker import _should_process_artist

        with tempfile.TemporaryDirectory() as lib:
            config = {"library_path": lib}

            with patch("crate.db.get_library_artist", return_value={"folder_name": "GhostBand", "content_hash": "x"}):
                assert _should_process_artist("GhostBand", config) is False
