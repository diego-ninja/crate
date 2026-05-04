"""Tests for library health checks."""

from pathlib import Path
import tempfile
from unittest.mock import MagicMock, patch

import pytest

class TestDuplicateFolders:
    @staticmethod
    def _fake_dir(name: str) -> MagicMock:
        entry = MagicMock()
        entry.name = name
        entry.is_dir.return_value = True
        return entry

    def test_detects_case_duplicates(self):
        """'Shame' and 'shame' should be detected as duplicates."""
        from crate.health_check import LibraryHealthCheck

        config = {"library_path": "/tmp/fake-library"}
        hc = LibraryHealthCheck(config)
        hc.library_path = MagicMock()
        hc.library_path.is_dir.return_value = True
        hc.library_path.iterdir.return_value = [
            self._fake_dir("Shame"),
            self._fake_dir("shame"),
            self._fake_dir("Unique Band"),
        ]
        issues = hc._check_duplicate_folders()

        assert len(issues) == 1
        assert issues[0]["check"] == "duplicate_folders"
        assert set(issues[0]["details"]["folders"]) == {"Shame", "shame"}

    def test_no_false_positives(self):
        """Distinct folder names should not be flagged."""
        from crate.health_check import LibraryHealthCheck

        with tempfile.TemporaryDirectory() as lib:
            (Path(lib) / "Alpha").mkdir()
            (Path(lib) / "Beta").mkdir()

            config = {"library_path": lib}
            hc = LibraryHealthCheck(config)
            issues = hc._check_duplicate_folders()

        assert len(issues) == 0

    def test_unicode_normalization(self):
        """Folders that differ only by unicode normalization should be detected."""
        from crate.health_check import LibraryHealthCheck

        with tempfile.TemporaryDirectory() as lib:
            # Same name, different dash types
            (Path(lib) / "Band - Name").mkdir()
            (Path(lib) / "Band \u2013 Name").mkdir()  # en-dash

            config = {"library_path": lib}
            hc = LibraryHealthCheck(config)
            issues = hc._check_duplicate_folders()

        assert len(issues) == 1

    def test_empty_library(self):
        from crate.health_check import LibraryHealthCheck
        with tempfile.TemporaryDirectory() as lib:
            config = {"library_path": lib}
            hc = LibraryHealthCheck(config)
            assert hc._check_duplicate_folders() == []


class TestStaleArtists:
    def test_detects_missing_folder(self):
        """Artist in DB but folder doesn't exist on disk should be flagged."""
        from crate.health_check import LibraryHealthCheck

        with tempfile.TemporaryDirectory() as lib:
            config = {"library_path": lib}
            hc = LibraryHealthCheck(config)

            mock_rows = [
                {"name": "Existing Band", "folder_name": "Existing Band"},
                {"name": "Gone Band", "folder_name": "Gone Band"},
            ]
            # Only create one folder
            (Path(lib) / "Existing Band").mkdir()

            with patch("crate.health_check.get_all_artists", return_value=mock_rows):
                issues = hc._check_stale_artists()

        assert len(issues) == 1
        assert issues[0]["details"]["artist"] == "Gone Band"
        assert issues[0]["check"] == "stale_artists"

    def test_uses_folder_name_over_artist_name(self):
        """When folder_name differs from name, should check folder_name path."""
        from crate.health_check import LibraryHealthCheck

        with tempfile.TemporaryDirectory() as lib:
            config = {"library_path": lib}
            hc = LibraryHealthCheck(config)

            # folder_name is the actual directory on disk
            (Path(lib) / "The_Actual_Folder").mkdir()

            mock_rows = [
                {"name": "Pretty Name", "folder_name": "The_Actual_Folder"},
            ]

            with patch("crate.health_check.get_all_artists", return_value=mock_rows):
                issues = hc._check_stale_artists()

        assert len(issues) == 0  # Folder exists, no issue


class TestStaleTracks:
    def test_detects_missing_files(self):
        from crate.health_check import LibraryHealthCheck

        with tempfile.TemporaryDirectory() as lib:
            config = {"library_path": lib}
            hc = LibraryHealthCheck(config)

            existing_file = Path(lib) / "track1.flac"
            existing_file.write_bytes(b"\x00")
            missing_path = str(Path(lib) / "gone.flac")

            mock_tracks = [
                {"path": str(existing_file), "artist": "A"},
                {"path": missing_path, "artist": "B"},
            ]

            with patch("crate.health_check.get_tracks_sample", return_value=mock_tracks):
                issues = hc._check_stale_tracks()

        assert len(issues) == 1
        assert issues[0]["details"]["track_path"] == missing_path


class TestFolderNaming:
    def test_detects_year_prefix(self):
        """'2020 - Album Name' should be flagged."""
        from crate.health_check import LibraryHealthCheck

        with tempfile.TemporaryDirectory() as lib:
            config = {"library_path": lib}
            hc = LibraryHealthCheck(config)

            artist_dir = Path(lib) / "Quicksand"
            wrong_dir = artist_dir / "1993 - Slip"
            wrong_dir.mkdir(parents=True)

            mock_rows = [
                {
                    "name": "1993 - Slip",
                    "artist": "Quicksand",
                    "year": "1993",
                    "path": str(wrong_dir),
                },
            ]

            with patch("crate.health_check.get_albums_with_year", return_value=mock_rows):
                issues = hc._check_folder_naming()

        assert len(issues) == 1
        assert issues[0]["details"]["clean_name"] == "Slip"
        assert issues[0]["details"]["year"] == "1993"
        expected_path = str(artist_dir / "1993" / "Slip")
        assert issues[0]["details"]["expected_path"] == expected_path

    def test_correct_structure_not_flagged(self):
        """'Artist/2020/Album Name' is already correct."""
        from crate.health_check import LibraryHealthCheck

        with tempfile.TemporaryDirectory() as lib:
            config = {"library_path": lib}
            hc = LibraryHealthCheck(config)

            correct_dir = Path(lib) / "Band" / "2020" / "Album"
            correct_dir.mkdir(parents=True)

            mock_rows = [
                {
                    "name": "Album",
                    "artist": "Band",
                    "year": "2020",
                    "path": str(correct_dir),
                },
            ]

            with patch("crate.health_check.get_albums_with_year", return_value=mock_rows):
                issues = hc._check_folder_naming()

        assert len(issues) == 0

    def test_album_directly_under_artist_flagged(self):
        """'Artist/Album' without year subdirectory should be flagged when year is known."""
        from crate.health_check import LibraryHealthCheck

        with tempfile.TemporaryDirectory() as lib:
            config = {"library_path": lib}
            hc = LibraryHealthCheck(config)

            flat_dir = Path(lib) / "Band" / "Album"
            flat_dir.mkdir(parents=True)

            mock_rows = [
                {
                    "name": "Album",
                    "artist": "Band",
                    "year": "2019",
                    "path": str(flat_dir),
                },
            ]

            with patch("crate.health_check.get_albums_with_year", return_value=mock_rows):
                issues = hc._check_folder_naming()

        assert len(issues) == 1
        assert "subdirectory" in issues[0]["details"]["reason"]


class TestZombieArtists:
    def test_detects_zero_count_artists(self):
        from crate.health_check import LibraryHealthCheck

        config = {"library_path": "/tmp/fake"}
        hc = LibraryHealthCheck(config)

        mock_rows = [
            {"name": "Zombie Band"},
            {"name": "Another Zombie"},
        ]

        with patch("crate.health_check.get_zombie_artists", return_value=mock_rows):
            issues = hc._check_zombie_artists()

        assert len(issues) == 2
        names = {i["details"]["artist"] for i in issues}
        assert names == {"Zombie Band", "Another Zombie"}
        assert all(i["auto_fixable"] for i in issues)


class TestHasPhotoDesync:
    def test_detects_desync(self):
        """DB says has_photo=True but no photo file on disk."""
        from crate.health_check import LibraryHealthCheck

        with tempfile.TemporaryDirectory() as lib:
            config = {"library_path": lib}
            hc = LibraryHealthCheck(config)

            (Path(lib) / "Band").mkdir()
            # No photo files created

            mock_rows = [
                {"name": "Band", "folder_name": "Band", "has_photo": True},
            ]

            with patch("crate.health_check.get_artists_with_photo", return_value=mock_rows):
                issues = hc._check_has_photo_desync()

        assert len(issues) == 1
        assert issues[0]["details"]["db_has_photo"] is True
        assert issues[0]["details"]["fs_has_photo"] is False

    def test_no_desync_when_photo_exists(self):
        from crate.health_check import LibraryHealthCheck

        with tempfile.TemporaryDirectory() as lib:
            config = {"library_path": lib}
            hc = LibraryHealthCheck(config)

            band_dir = Path(lib) / "Band"
            band_dir.mkdir()
            (band_dir / "artist.jpg").write_bytes(b"\xff\xd8")

            mock_rows = [
                {"name": "Band", "folder_name": "Band", "has_photo": True},
            ]

            with patch("crate.health_check.get_artists_with_photo", return_value=mock_rows):
                issues = hc._check_has_photo_desync()

        assert len(issues) == 0


class TestRunOrchestration:
    """Test the top-level run() method."""

    def test_run_collects_issues_from_all_checks(self):
        """run() should aggregate issues from all check methods."""
        from crate.health_check import LibraryHealthCheck

        with tempfile.TemporaryDirectory() as lib:
            config = {"library_path": lib}
            hc = LibraryHealthCheck(config)

            # Mock all checks to return empty except one
            for attr in dir(hc):
                if attr.startswith("_check_") and callable(getattr(hc, attr)):
                    setattr(hc, attr, MagicMock(return_value=[]))

            hc._check_zombie_artists.return_value = [
                {"check": "zombie_artists", "severity": "low", "auto_fixable": True, "details": {"artist": "X"}},
            ]

            result = hc.run(persist=False)

        assert len(result["issues"]) == 1
        assert result["summary"] == {"zombie_artists": 1}
        assert "duration_ms" in result

    def test_check_failure_does_not_abort_run(self):
        """If one check raises, others should still run."""
        from crate.health_check import LibraryHealthCheck

        with tempfile.TemporaryDirectory() as lib:
            config = {"library_path": lib}
            hc = LibraryHealthCheck(config)

            for attr in dir(hc):
                if attr.startswith("_check_") and callable(getattr(hc, attr)):
                    setattr(hc, attr, MagicMock(return_value=[]))

            hc._check_duplicate_folders.side_effect = RuntimeError("boom")
            hc._check_zombie_artists.return_value = [
                {"check": "zombie_artists", "severity": "low", "auto_fixable": True, "details": {"artist": "Y"}},
            ]

            result = hc.run(persist=False)

        # Should still have the zombie issue despite duplicate_folders exploding
        assert len(result["issues"]) == 1

    def test_run_selected_only_executes_requested_checks(self):
        from crate.health_check import LibraryHealthCheck

        with tempfile.TemporaryDirectory() as lib:
            config = {"library_path": lib}
            hc = LibraryHealthCheck(config)

            for attr in dir(hc):
                if attr.startswith("_check_") and callable(getattr(hc, attr)):
                    setattr(hc, attr, MagicMock(return_value=[]))

            hc._check_zombie_artists.return_value = [
                {"check": "zombie_artists", "severity": "low", "auto_fixable": True, "details": {"artist": "X"}},
            ]
            hc._check_duplicate_albums.return_value = [
                {"check": "duplicate_albums", "severity": "medium", "details": {"artist": "Y", "album": "Album"}},
            ]

            result = hc.run_selected({"zombie_artists"}, persist=False)

        assert len(result["issues"]) == 1
        assert result["summary"] == {"zombie_artists": 1}
        assert result["check_count"] == 1
        hc._check_zombie_artists.assert_called_once()
        hc._check_duplicate_albums.assert_not_called()
