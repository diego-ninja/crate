"""Tests for the library repair system."""

from unittest.mock import patch, MagicMock, call
from pathlib import Path
import tempfile
import os
import shutil

import pytest

APP_ROOT = Path(__file__).resolve().parents[1]
CRATE_ROOT = APP_ROOT / "crate"


class TestRepairCatalog:
    def test_auto_fixable_checks_have_registered_fixers(self):
        import re

        from crate.repair import LibraryRepair

        source = (CRATE_ROOT / "health_check.py").read_text()
        repair = LibraryRepair({"library_path": "/tmp/fake_lib"})

        auto_fixable_checks = {
            match.group(1)
            for match in re.finditer(
                r'"check": "([a-z0-9_]+)"[\s\S]{0,260}?"auto_fixable": True,',
                source,
            )
        }
        missing = sorted(check for check in auto_fixable_checks if check not in repair.FIXER_METHODS)
        assert missing == []

    def test_repair_skips_duplicate_tracks_when_no_safe_automatic_resolution_exists(self):
        from crate.repair import LibraryRepair

        repair = LibraryRepair({"library_path": "/tmp/fake_lib"})
        report = {
            "issues": [
                {
                    "check": "duplicate_tracks",
                    "details": {"artist": "Terror", "album": "Keepers Of The Faith", "title": "Return to strength"},
                }
            ]
        }

        result = repair.repair(report, dry_run=True, auto_only=False)
        assert result["unsupported_checks"] == []
        assert result["summary"]["unsupported"] == 0
        assert result["summary"]["skipped"] == 1
        assert result["item_results"][0]["check_type"] == "duplicate_tracks"
        assert result["item_results"][0]["outcome"] == "skipped"

    def test_preview_returns_executable_duplicate_album_action(self):
        from crate.repair import LibraryRepair

        repair = LibraryRepair({"library_path": "/tmp/fake_lib"})
        report = {
            "issues": [
                {
                    "id": 9,
                    "check": "duplicate_albums",
                    "details": {"artist": "Birds In Row", "album": "UGLY", "paths": ["/music/a", "/music/b"]},
                }
            ]
        }

        with patch.object(
            repair,
            "_fix_duplicate_albums",
            return_value={
                "action": "delete_loose",
                "target": "Birds In Row/UGLY",
                "details": {"reason": "identical track list"},
                "applied": False,
                "fs_write": True,
                "message": "Would delete loose duplicate album folder for Birds In Row/UGLY",
            },
        ) as mock_fix:
            result = repair.preview(report, auto_only=False)

        mock_fix.assert_called_once()
        assert result["total"] == 1
        assert result["executable"] == 1
        assert result["plan_version"].startswith("repair-preview:")
        assert result["items"][0]["check_type"] == "duplicate_albums"
        assert result["items"][0]["plan_item_id"].startswith("repair-plan:")
        assert result["items"][0]["item_key"] == "issue:9"
        assert result["items"][0]["executable"] is True
        assert result["items"][0]["risk"] == "destructive"
        assert result["items"][0]["scope"] == "hybrid"
        assert result["items"][0]["requires_confirmation"] is True
        assert result["items"][0]["message"] == "Would delete loose duplicate album folder for Birds In Row/UGLY"

    def test_preview_returns_executable_duplicate_track_action(self):
        from crate.repair import LibraryRepair

        repair = LibraryRepair({"library_path": "/tmp/fake_lib"})
        report = {
            "issues": [
                {
                    "id": 11,
                    "check": "duplicate_tracks",
                    "details": {
                        "artist": "Terror",
                        "album": "Still Suffer",
                        "title": "A Deeper Struggle",
                        "paths": ["/music/a.m4a", "/music/b.m4a"],
                    },
                }
            ]
        }

        with patch.object(
            repair,
            "_fix_duplicate_tracks",
            return_value={
                "action": "delete_duplicate_tracks",
                "target": "Terror/Still Suffer/A Deeper Struggle",
                "details": {
                    "keep_path": "/music/a.m4a",
                    "remove_paths": ["/music/b.m4a"],
                    "duplicate_count": 2,
                    "reason": "same album/title/track number and matching duration",
                    "enrich_artist": "Terror",
                },
                "applied": False,
                "fs_write": True,
                "message": "Would delete 1 duplicate track file(s) for Terror/Still Suffer/A Deeper Struggle",
            },
        ) as mock_fix:
            result = repair.preview(report, auto_only=False)

        mock_fix.assert_called_once()
        assert result["total"] == 1
        assert result["executable"] == 1
        assert result["items"][0]["check_type"] == "duplicate_tracks"
        assert result["items"][0]["item_key"] == "issue:11"
        assert result["items"][0]["plan_item_id"].startswith("repair-plan:")
        assert result["items"][0]["executable"] is True
        assert result["items"][0]["risk"] == "destructive"
        assert result["items"][0]["scope"] == "hybrid"
        assert result["items"][0]["requires_confirmation"] is True
        assert result["items"][0]["message"] == (
            "Would delete 1 duplicate track file(s) for Terror/Still Suffer/A Deeper Struggle"
        )

    def test_preview_returns_executable_artist_layout_fix_action(self):
        from crate.repair import LibraryRepair

        repair = LibraryRepair({"library_path": "/tmp/fake_lib"})
        report = {
            "issues": [
                {
                    "check": "artist_layout_fix",
                    "auto_fixable": True,
                    "details": {"artist": "Quicksand"},
                    "description": "Artist layout fix needed for Quicksand",
                }
            ]
        }

        with patch.object(
            repair,
            "_fix_artist_layout",
            return_value={
                "action": "fix_artist_layout",
                "target": "Quicksand",
                "details": {"target_artist_dir": "/music/b81635c8-3132-57d2-8d22-920251dc2627"},
                "applied": False,
                "fs_write": True,
                "message": "Would consolidate 4 album directories into canonical entity_uid layout",
            },
        ) as mock_fix:
            result = repair.preview(report, auto_only=False)

        mock_fix.assert_called_once()
        assert result["total"] == 1
        assert result["executable"] == 1
        assert result["plan_version"].startswith("repair-preview:")
        assert result["items"][0]["check_type"] == "artist_layout_fix"
        assert result["items"][0]["plan_item_id"].startswith("repair-plan:")
        assert result["items"][0]["executable"] is True
        assert result["items"][0]["risk"] == "caution"
        assert result["items"][0]["scope"] == "hybrid"
        assert result["items"][0]["requires_confirmation"] is True
        assert result["items"][0]["message"] == "Would consolidate 4 album directories into canonical entity_uid layout"


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


class TestDuplicateTrackRepair:
    def test_duplicate_track_dry_run_keeps_best_tagged_copy(self):
        from crate.repair import LibraryRepair

        with tempfile.TemporaryDirectory() as lib:
            album_dir = Path(lib) / "Terror" / "Still Suffer"
            album_dir.mkdir(parents=True)
            keep_file = album_dir / "08 - A Deeper Struggle.m4a"
            dupe_file = album_dir / "08 - A Deeper Struggle (1).m4a"
            keep_file.write_bytes(b"\x00" * 2000)
            dupe_file.write_bytes(b"\x00" * 1000)

            tracks = [
                {
                    "album_id": 7,
                    "artist": "Terror",
                    "album": "Still Suffer",
                    "title": "A Deeper Struggle",
                    "path": str(keep_file),
                    "track_number": 8,
                    "disc_number": 1,
                    "duration": 97.0,
                    "size": 2000,
                    "bitrate": 256000,
                    "audio_fingerprint": "fingerprint-1",
                },
                {
                    "album_id": 7,
                    "artist": "Terror",
                    "album": "Still Suffer",
                    "title": "A Deeper Struggle",
                    "path": str(dupe_file),
                    "track_number": 8,
                    "disc_number": 1,
                    "duration": 97.0,
                    "size": 1000,
                    "bitrate": 128000,
                    "audio_fingerprint": "fingerprint-1",
                },
            ]
            tag_map = {
                str(keep_file): {
                    "artist": "Terror",
                    "album": "Still Suffer",
                    "title": "A Deeper Struggle",
                    "tracknumber": "8",
                },
                str(dupe_file): {},
            }

            repair = LibraryRepair({"library_path": lib})
            issue = {
                "check": "duplicate_tracks",
                "details": {
                    "artist": "Terror",
                    "album": "Still Suffer",
                    "title": "A Deeper Struggle",
                    "paths": [str(keep_file), str(dupe_file)],
                },
            }

            with patch("crate.repair.get_tracks_by_paths", return_value=tracks), \
                 patch("crate.repair.read_tags", side_effect=lambda path: tag_map[str(path)]):
                result = repair._fix_duplicate_tracks(issue, dry_run=True)

            assert result is not None
            assert result["applied"] is False
            assert result["details"]["keep_path"] == str(keep_file)
            assert result["details"]["remove_paths"] == [str(dupe_file)]
            assert result["details"]["duplicate_count"] == 2
            assert result["details"]["enrich_artist"] == "Terror"

    def test_duplicate_track_apply_deletes_redundant_file(self):
        from crate.repair import LibraryRepair

        with tempfile.TemporaryDirectory() as lib:
            album_dir = Path(lib) / "Terror" / "Still Suffer"
            album_dir.mkdir(parents=True)
            keep_file = album_dir / "08 - A Deeper Struggle.m4a"
            dupe_file = album_dir / "08 - A Deeper Struggle (1).m4a"
            keep_file.write_bytes(b"\x00" * 2000)
            dupe_file.write_bytes(b"\x00" * 1000)

            tracks = [
                {
                    "album_id": 7,
                    "artist": "Terror",
                    "album": "Still Suffer",
                    "title": "A Deeper Struggle",
                    "path": str(keep_file),
                    "track_number": 8,
                    "disc_number": 1,
                    "duration": 97.0,
                    "size": 2000,
                    "bitrate": 256000,
                    "audio_fingerprint": "fingerprint-1",
                },
                {
                    "album_id": 7,
                    "artist": "Terror",
                    "album": "Still Suffer",
                    "title": "A Deeper Struggle",
                    "path": str(dupe_file),
                    "track_number": 8,
                    "disc_number": 1,
                    "duration": 97.0,
                    "size": 1000,
                    "bitrate": 128000,
                    "audio_fingerprint": "fingerprint-1",
                },
            ]
            tag_map = {
                str(keep_file): {
                    "artist": "Terror",
                    "album": "Still Suffer",
                    "title": "A Deeper Struggle",
                    "tracknumber": "8",
                },
                str(dupe_file): {},
            }

            repair = LibraryRepair({"library_path": lib})
            issue = {
                "check": "duplicate_tracks",
                "details": {
                    "artist": "Terror",
                    "album": "Still Suffer",
                    "title": "A Deeper Struggle",
                    "paths": [str(keep_file), str(dupe_file)],
                },
            }

            with patch("crate.repair.get_tracks_by_paths", return_value=tracks), \
                 patch("crate.repair.read_tags", side_effect=lambda path: tag_map[str(path)]), \
                 patch("crate.repair.delete_track") as mock_delete_track, \
                 patch("crate.repair.log_audit") as mock_log_audit:
                result = repair._fix_duplicate_tracks(issue, dry_run=False, task_id="task-1")

            assert result is not None
            assert result["applied"] is True
            assert dupe_file.exists() is False
            assert keep_file.exists() is True
            mock_delete_track.assert_called_once_with(str(dupe_file))
            mock_log_audit.assert_called_once()
            assert result["details"]["removed_paths"] == [str(dupe_file)]
            assert result["details"]["enrich_artist"] == "Terror"

    def test_duplicate_track_stays_manual_when_fingerprints_conflict(self):
        from crate.repair import LibraryRepair

        with tempfile.TemporaryDirectory() as lib:
            album_dir = Path(lib) / "Terror" / "Still Suffer"
            album_dir.mkdir(parents=True)
            first = album_dir / "08 - A Deeper Struggle.m4a"
            second = album_dir / "08 - A Deeper Struggle (alt).m4a"
            first.write_bytes(b"\x00" * 1000)
            second.write_bytes(b"\x00" * 1000)

            tracks = [
                {
                    "album_id": 7,
                    "artist": "Terror",
                    "album": "Still Suffer",
                    "title": "A Deeper Struggle",
                    "path": str(first),
                    "track_number": 8,
                    "disc_number": 1,
                    "duration": 97.0,
                    "size": 1000,
                    "bitrate": 128000,
                    "audio_fingerprint": "fp-1",
                },
                {
                    "album_id": 7,
                    "artist": "Terror",
                    "album": "Still Suffer",
                    "title": "A Deeper Struggle",
                    "path": str(second),
                    "track_number": 8,
                    "disc_number": 1,
                    "duration": 97.0,
                    "size": 1000,
                    "bitrate": 128000,
                    "audio_fingerprint": "fp-2",
                },
            ]

            repair = LibraryRepair({"library_path": lib})
            issue = {
                "check": "duplicate_tracks",
                "details": {
                    "artist": "Terror",
                    "album": "Still Suffer",
                    "title": "A Deeper Struggle",
                    "paths": [str(first), str(second)],
                },
            }

            with patch("crate.repair.get_tracks_by_paths", return_value=tracks), \
                 patch("crate.repair.read_tags", return_value={}):
                result = repair._fix_duplicate_tracks(issue, dry_run=True)

            assert result is None


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

            with patch("crate.repair.update_album_path_and_name"), \
                 patch("crate.repair.log_audit"):
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

            with patch("crate.repair.merge_album_folder"), \
                 patch("crate.repair.log_audit"):
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
            with patch("crate.repair.find_canonical_artist_by_folder", return_value=None), \
                 patch("crate.repair.log_audit"), \
                 patch("crate.config.load_config", return_value=config), \
                 patch("crate.library_sync.LibrarySync", return_value=mock_syncer_instance), \
                 patch.object(repair, "_count_artist_tracks", side_effect=[0, 1]):
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
            primary_name = "Band - Name"
            duplicate_name = "Band \u2013 Name"
            primary = Path(lib) / primary_name
            duplicate = Path(lib) / duplicate_name
            primary.mkdir()
            duplicate.mkdir()
            (primary / "album1").mkdir()
            (duplicate / "album2").mkdir()

            config = {"library_path": lib}
            repair = LibraryRepair(config)

            issue = {
                "check": "duplicate_folders",
                "auto_fixable": True,
                "details": {"folders": [primary_name, duplicate_name]},
            }

            with patch("crate.repair.log_audit"):
                result = repair._fix_duplicate_folders(issue, dry_run=False)

            assert result is not None
            assert result["applied"]
            assert (primary / "album1").is_dir()
            assert (primary / "album2").is_dir()
            assert not duplicate.exists()

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

    def test_global_only_skips_non_global_repairs(self):
        from crate.repair import LibraryRepair
        config = {"library_path": "/tmp/fake"}
        repair = LibraryRepair(config)

        report = {
            "issues": [
                {"check": "artist_layout_fix", "auto_fixable": True, "details": {"artist": "X"}},
                {"check": "stale_tracks", "auto_fixable": True, "details": {"path": "/tmp/fake/x.flac"}},
            ]
        }

        with patch.object(repair, "_fix_artist_layout", return_value={"action": "layout", "applied": True}) as mock_layout, \
             patch.object(repair, "_fix_stale_tracks", return_value={"action": "stale", "applied": True}) as mock_stale:
            result = repair.repair(report, dry_run=True, auto_only=True, global_only=True)

        mock_layout.assert_not_called()
        mock_stale.assert_called_once()
        assert len(result["actions"]) == 1
        assert result["actions"][0]["action"] == "stale"

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
