"""Tests for the library repair system."""

from unittest.mock import patch, MagicMock, call
from pathlib import Path
import tempfile
import os
import shutil

import pytest


class TestFieldNormalization:
    """Test that repair handles both check/check_type and details/details_json field names."""

    def test_normalize_check_type_field(self):
        """Issues from DB use check_type, repair code should read via 'check' or 'check_type'."""
        from crate.repair import LibraryRepair
        config = {"library_path": "/tmp/fake_lib"}
        repair = LibraryRepair(config)

        # Simulate DB-style issue (check_type instead of check)
        report = {
            "issues": [
                {
                    "check_type": "zombie_artists",
                    "auto_fixable": True,
                    "details_json": {"artist": "Ghost Artist"},
                }
            ]
        }

        with patch.object(repair, "_fix_zombie_artists", return_value={"action": "delete_zombie_artist", "applied": False}) as mock_fix:
            result = repair.repair(report, dry_run=True, auto_only=True)
            mock_fix.assert_called_once()
            # The issue passed to fixer should have 'details' populated from details_json
            issue_arg = mock_fix.call_args[0][0]
            assert issue_arg["details"] == {"artist": "Ghost Artist"}

    def test_normalize_details_json_field(self):
        """Issues from DB use details_json; repair should expose it as 'details'."""
        from crate.repair import LibraryRepair
        config = {"library_path": "/tmp/fake_lib"}
        repair = LibraryRepair(config)

        report = {
            "issues": [
                {
                    "check": "stale_artists",
                    "auto_fixable": True,
                    "details_json": {"artist": "Stale Band"},
                }
            ]
        }

        with patch.object(repair, "_fix_stale_entries", return_value=None) as mock_fix:
            repair.repair(report, dry_run=True)
            issue_arg = mock_fix.call_args[0][0]
            assert issue_arg.get("details") == {"artist": "Stale Band"}

    def test_health_check_style_issues_work_unchanged(self):
        """Issues from health check already use 'check' and 'details' — should pass through."""
        from crate.repair import LibraryRepair
        config = {"library_path": "/tmp/fake_lib"}
        repair = LibraryRepair(config)

        report = {
            "issues": [
                {
                    "check": "zombie_artists",
                    "auto_fixable": True,
                    "details": {"artist": "Dead Band"},
                }
            ]
        }

        with patch.object(repair, "_fix_zombie_artists", return_value=None) as mock_fix:
            repair.repair(report, dry_run=True)
            issue_arg = mock_fix.call_args[0][0]
            assert issue_arg["details"] == {"artist": "Dead Band"}


class TestFolderNamingRepair:
    """Test folder naming repair with actual filesystem operations."""

    def test_move_year_prefix_folder(self):
        """'2020 - Album' should move to '2020/Album' when target doesn't exist."""
        from crate.repair import LibraryRepair

        with tempfile.TemporaryDirectory() as lib:
            artist_dir = Path(lib) / "TestArtist"
            current = artist_dir / "2020 - Great Album"
            expected = artist_dir / "2020" / "Great Album"
            current.mkdir(parents=True)
            (current / "01 - Track.flac").write_bytes(b"\x00" * 100)

            config = {"library_path": lib}
            repair = LibraryRepair(config)

            issue = {
                "check": "folder_naming",
                "auto_fixable": True,
                "details": {
                    "artist": "TestArtist",
                    "current_folder": "2020 - Great Album",
                    "clean_name": "Great Album",
                    "year": "2020",
                    "current_path": str(current),
                    "expected_path": str(expected),
                    "reason": "Year prefix in folder name",
                    "path": str(current),
                },
            }

            with patch("crate.repair.get_db_ctx") as mock_ctx, \
                 patch("crate.repair.log_audit"):
                mock_cur = MagicMock()
                mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
                mock_ctx.return_value.__exit__ = MagicMock(return_value=False)

                result = repair._fix_folder_naming(issue, dry_run=False)

            assert result is not None
            assert result["applied"]
            assert result["fs_write"]
            assert expected.is_dir()
            assert (expected / "01 - Track.flac").exists()
            assert not current.exists()

    def test_merge_keeps_higher_quality(self):
        """When both folders exist, FLAC should replace MP3 of the same track."""
        from crate.repair import LibraryRepair

        with tempfile.TemporaryDirectory() as lib:
            artist_dir = Path(lib) / "TestArtist"
            current = artist_dir / "2020 - Album"
            expected = artist_dir / "2020" / "Album"

            current.mkdir(parents=True)
            expected.mkdir(parents=True)

            # Source has FLAC (higher quality)
            (current / "01 - Song.flac").write_bytes(b"\x00" * 5000)
            # Destination has MP3 (lower quality) with same stem
            (expected / "01 - Song.mp3").write_bytes(b"\x00" * 1000)
            # Destination has a track not in source
            (expected / "02 - Bonus.mp3").write_bytes(b"\x00" * 800)

            config = {"library_path": lib}
            repair = LibraryRepair(config)

            issue = {
                "check": "folder_naming",
                "auto_fixable": True,
                "details": {
                    "artist": "TestArtist",
                    "current_folder": "2020 - Album",
                    "clean_name": "Album",
                    "year": "2020",
                    "current_path": str(current),
                    "expected_path": str(expected),
                    "reason": "Year prefix",
                    "path": str(current),
                },
            }

            with patch("crate.repair.get_db_ctx") as mock_ctx, \
                 patch("crate.repair.log_audit"):
                mock_cur = MagicMock()
                mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
                mock_ctx.return_value.__exit__ = MagicMock(return_value=False)

                result = repair._fix_folder_naming(issue, dry_run=False)

            assert result is not None
            assert result["applied"]
            assert result["details"].get("merged")
            # FLAC should be in target, MP3 of same track removed
            assert (expected / "01 - Song.flac").exists()
            assert not (expected / "01 - Song.mp3").exists()
            # Bonus track preserved
            assert (expected / "02 - Bonus.mp3").exists()
            # Source folder removed
            assert not current.exists()

    def test_skip_when_source_not_exists(self):
        """Don't fail when source folder is already gone."""
        from crate.repair import LibraryRepair

        with tempfile.TemporaryDirectory() as lib:
            config = {"library_path": lib}
            repair = LibraryRepair(config)

            issue = {
                "check": "folder_naming",
                "auto_fixable": True,
                "details": {
                    "artist": "TestArtist",
                    "current_folder": "Gone Album",
                    "clean_name": "Gone Album",
                    "year": "2020",
                    "current_path": str(Path(lib) / "TestArtist" / "Gone Album"),
                    "expected_path": str(Path(lib) / "TestArtist" / "2020" / "Gone Album"),
                    "reason": "test",
                    "path": str(Path(lib) / "TestArtist" / "Gone Album"),
                },
            }

            result = repair._fix_folder_naming(issue, dry_run=False)
            assert result is not None
            assert not result["applied"]
            assert "error" in result["details"]

    def test_dry_run_does_not_move(self):
        """Dry run should report action but not touch filesystem."""
        from crate.repair import LibraryRepair

        with tempfile.TemporaryDirectory() as lib:
            current = Path(lib) / "Artist" / "2020 - Album"
            expected = Path(lib) / "Artist" / "2020" / "Album"
            current.mkdir(parents=True)
            (current / "track.flac").write_bytes(b"\x00")

            config = {"library_path": lib}
            repair = LibraryRepair(config)

            issue = {
                "check": "folder_naming",
                "auto_fixable": True,
                "details": {
                    "artist": "Artist",
                    "current_folder": "2020 - Album",
                    "clean_name": "Album",
                    "year": "2020",
                    "current_path": str(current),
                    "expected_path": str(expected),
                    "reason": "test",
                    "path": str(current),
                },
            }

            result = repair._fix_folder_naming(issue, dry_run=True)
            assert result is not None
            assert not result["applied"]
            # Source should still exist
            assert current.is_dir()
            assert not expected.exists()


class TestUnindexedFilesRepair:
    def test_detects_old_naming_residue_and_removes(self):
        """'YYYY - AlbumName' with matching 'YYYY/AlbumName' should merge and remove."""
        from crate.repair import LibraryRepair

        with tempfile.TemporaryDirectory() as lib:
            artist = Path(lib) / "Band"
            old_dir = artist / "2019 - Album"
            correct_dir = artist / "2019" / "Album"

            old_dir.mkdir(parents=True)
            correct_dir.mkdir(parents=True)

            # Old dir has a leftover file
            (old_dir / "bonus.flac").write_bytes(b"\x00" * 100)
            # Correct dir has the main tracks
            (correct_dir / "01.flac").write_bytes(b"\x00" * 200)

            config = {"library_path": lib}
            repair = LibraryRepair(config)

            issue = {
                "check": "unindexed_files",
                "auto_fixable": True,
                "details": {"dir": str(old_dir), "count": 1},
            }

            with patch("crate.repair.log_audit"):
                result = repair._fix_unindexed_files(issue, dry_run=False)

            assert result is not None
            assert result["action"] == "remove_duplicate_folder"
            assert result["fs_write"]
            # Old dir should be removed
            assert not old_dir.exists()
            # Bonus file should be merged into correct dir
            assert (correct_dir / "bonus.flac").exists()
            assert (correct_dir / "01.flac").exists()

    def test_triggers_reindex_for_real_unindexed(self):
        """Non-duplicate unindexed files trigger a sync via LibrarySync."""
        from crate.repair import LibraryRepair

        with tempfile.TemporaryDirectory() as lib:
            artist = Path(lib) / "NewBand"
            album_dir = artist / "2023" / "NewAlbum"
            album_dir.mkdir(parents=True)
            (album_dir / "track.flac").write_bytes(b"\x00")

            config = {"library_path": lib}
            repair = LibraryRepair(config)

            issue = {
                "check": "unindexed_files",
                "auto_fixable": True,
                "details": {"dir": str(album_dir), "count": 1},
            }

            mock_syncer_instance = MagicMock()
            with patch("crate.repair.get_db_ctx") as mock_ctx, \
                 patch("crate.repair.log_audit"), \
                 patch("crate.config.load_config", return_value=config), \
                 patch("crate.library_sync.LibrarySync", return_value=mock_syncer_instance), \
                 patch.object(repair, "_count_artist_tracks", side_effect=[0, 1]):
                mock_cur = MagicMock()
                mock_cur.fetchone.return_value = None  # canonical artist lookup
                mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
                mock_ctx.return_value.__exit__ = MagicMock(return_value=False)
                result = repair._fix_unindexed_files(issue, dry_run=False)

            assert result is not None
            assert result["action"] == "reindex_unindexed"
            assert result["applied"] is True
            mock_syncer_instance.sync_artist.assert_called_once()


class TestDuplicateFoldersRepair:
    def test_merge_duplicate_folders(self):
        """Merges contents of duplicate-named folders into the alphabetically first."""
        from crate.repair import LibraryRepair

        with tempfile.TemporaryDirectory() as lib:
            (Path(lib) / "Band").mkdir()
            (Path(lib) / "band").mkdir()
            (Path(lib) / "Band" / "album1").mkdir()
            (Path(lib) / "band" / "album2").mkdir()

            config = {"library_path": lib}
            repair = LibraryRepair(config)

            issue = {
                "check": "duplicate_folders",
                "auto_fixable": True,
                "details": {"folders": ["Band", "band"]},
            }

            with patch("crate.repair.log_audit"):
                result = repair._fix_duplicate_folders(issue, dry_run=False)

            assert result is not None
            assert result["applied"]
            assert (Path(lib) / "Band" / "album1").is_dir()
            assert (Path(lib) / "Band" / "album2").is_dir()

    def test_dry_run_returns_plan(self):
        from crate.repair import LibraryRepair
        config = {"library_path": "/tmp/fake"}
        repair = LibraryRepair(config)

        issue = {
            "check": "duplicate_folders",
            "auto_fixable": True,
            "details": {"folders": ["A", "a"]},
        }

        result = repair._fix_duplicate_folders(issue, dry_run=True)
        assert result is not None
        assert not result["applied"]
        assert result["action"] == "merge_duplicate_folders"


class TestRepairOrchestration:
    """Test the top-level repair() method orchestration."""

    def test_skips_non_auto_fixable_when_auto_only(self):
        from crate.repair import LibraryRepair
        config = {"library_path": "/tmp/fake"}
        repair = LibraryRepair(config)

        report = {
            "issues": [
                {"check": "duplicate_albums", "auto_fixable": False, "details": {}},
                {"check": "zombie_artists", "auto_fixable": True, "details": {"artist": "X"}},
            ]
        }

        with patch.object(repair, "_fix_zombie_artists", return_value={"action": "x", "applied": True}) as mock_z:
            result = repair.repair(report, dry_run=True, auto_only=True)
            mock_z.assert_called_once()

    def test_unknown_check_type_ignored(self):
        from crate.repair import LibraryRepair
        config = {"library_path": "/tmp/fake"}
        repair = LibraryRepair(config)

        report = {
            "issues": [
                {"check": "totally_unknown_check", "auto_fixable": True, "details": {}},
            ]
        }

        result = repair.repair(report, dry_run=True)
        assert result["actions"] == []
