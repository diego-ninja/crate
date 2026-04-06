"""Tests for crate.library_sync — filesystem-to-DB synchronization."""

import os
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock, call

import pytest


def _create_test_library(base: Path):
    """Create a minimal test music library structure."""
    # Artist 1
    artist1 = base / "Artist One"
    album1 = artist1 / "Album A"
    album1.mkdir(parents=True)
    (album1 / "01 - Track.flac").write_bytes(b"\x00" * 1024)
    (album1 / "02 - Track.flac").write_bytes(b"\x00" * 1024)

    album2 = artist1 / "Album B"
    album2.mkdir(parents=True)
    (album2 / "01 - Song.mp3").write_bytes(b"\x00" * 512)

    # Artist 2
    artist2 = base / "Artist Two"
    album3 = artist2 / "Album C"
    album3.mkdir(parents=True)
    (album3 / "track1.flac").write_bytes(b"\x00" * 2048)

    return base


class TestLibrarySyncFullSync:
    def test_full_sync_discovers_artists(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            lib = _create_test_library(Path(tmpdir))
            config = {
                "library_path": str(lib),
                "audio_extensions": [".flac", ".mp3"],
            }

            # Mock all DB calls
            with patch("crate.library_sync.get_library_artist", return_value=None), \
                 patch("crate.library_sync.get_library_albums", return_value=[]), \
                 patch("crate.library_sync.get_library_artists", return_value=([], 0)), \
                 patch("crate.library_sync.upsert_artist") as mock_upsert_artist, \
                 patch("crate.library_sync.upsert_album", return_value=1) as mock_upsert_album, \
                 patch("crate.library_sync.upsert_track") as mock_upsert_track, \
                 patch("crate.library_sync.get_db_ctx") as mock_ctx, \
                 patch("crate.library_sync.delete_artist"), \
                 patch("crate.library_sync.delete_album"), \
                 patch("crate.library_sync.mutagen.File", return_value=None), \
                 patch("crate.library_sync.read_tags", return_value={}):
                mock_cur = MagicMock()
                mock_cur.fetchone.return_value = None
                mock_cur.fetchall.return_value = []
                mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
                mock_ctx.return_value.__exit__ = MagicMock(return_value=False)

                from crate.library_sync import LibrarySync
                sync = LibrarySync(config)
                result = sync.full_sync()

                assert result["artists_added"] == 2
                assert mock_upsert_artist.call_count >= 2
                # 3 albums total
                assert mock_upsert_album.call_count == 3

    def test_full_sync_skips_unchanged_artists(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            lib = _create_test_library(Path(tmpdir))
            config = {
                "library_path": str(lib),
                "audio_extensions": [".flac", ".mp3"],
            }

            artist_dir = lib / "Artist One"
            dir_mtime = artist_dir.stat().st_mtime

            existing_artist = {
                "name": "Artist One",
                "album_count": 2,
                "track_count": 3,
                "total_size": 2560,
                "dir_mtime": dir_mtime + 1,  # Newer than actual = unchanged
                "formats": ["flac", "mp3"],
                "primary_format": "flac",
                "has_photo": 0,
            }

            def mock_get_artist(name):
                if name == "Artist One":
                    return existing_artist
                return None

            with patch("crate.library_sync.get_library_artist", side_effect=mock_get_artist), \
                 patch("crate.library_sync.get_library_albums", return_value=[]), \
                 patch("crate.library_sync.get_library_artists", return_value=([existing_artist], 1)), \
                 patch("crate.library_sync.upsert_artist") as mock_upsert, \
                 patch("crate.library_sync.upsert_album", return_value=1), \
                 patch("crate.library_sync.upsert_track"), \
                 patch("crate.library_sync.get_db_ctx") as mock_ctx, \
                 patch("crate.library_sync.delete_artist"), \
                 patch("crate.library_sync.delete_album"), \
                 patch("crate.library_sync.mutagen.File", return_value=None), \
                 patch("crate.library_sync.read_tags", return_value={}):
                mock_cur = MagicMock()
                mock_cur.fetchone.return_value = None
                mock_cur.fetchall.return_value = []
                mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
                mock_ctx.return_value.__exit__ = MagicMock(return_value=False)

                from crate.library_sync import LibrarySync
                sync = LibrarySync(config)
                result = sync.full_sync()

                # Artist One was skipped, Artist Two was added
                assert result["artists_added"] == 1


class TestSyncAlbum:
    def test_sync_album_reads_tracks(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            lib = Path(tmpdir)
            album_dir = lib / "Artist" / "Album"
            album_dir.mkdir(parents=True)
            (album_dir / "01.flac").write_bytes(b"\x00" * 1024)
            (album_dir / "02.flac").write_bytes(b"\x00" * 2048)

            config = {
                "library_path": str(lib),
                "audio_extensions": [".flac"],
            }

            mock_mf = MagicMock()
            mock_mf.info.length = 240.0
            mock_mf.info.bitrate = 320000

            with patch("crate.library_sync.get_library_artist", return_value={"name": "Artist"}), \
                 patch("crate.library_sync.upsert_artist"), \
                 patch("crate.library_sync.upsert_album", return_value=1), \
                 patch("crate.library_sync.upsert_track") as mock_upsert_track, \
                 patch("crate.library_sync.get_db_ctx") as mock_ctx, \
                 patch("crate.library_sync.mutagen.File", return_value=mock_mf), \
                 patch("crate.library_sync.read_tags", return_value={"artist": "Artist", "album": "Album", "title": "Track"}):
                mock_cur = MagicMock()
                mock_cur.fetchone.return_value = None
                mock_cur.fetchall.return_value = []
                mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
                mock_ctx.return_value.__exit__ = MagicMock(return_value=False)

                from crate.library_sync import LibrarySync
                sync = LibrarySync(config)
                result = sync.sync_album(album_dir, "Artist")

                assert result["track_count"] == 2
                assert result["total_size"] == 3072
                assert "flac" in result["formats"]
                assert mock_upsert_track.call_count == 2

    def test_sync_album_reads_nested_disc_tracks(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            lib = Path(tmpdir)
            album_dir = lib / "Artist" / "Album Deluxe"
            disc1 = album_dir / "Disc 1"
            disc2 = album_dir / "Disc 2"
            disc1.mkdir(parents=True)
            disc2.mkdir(parents=True)
            (disc1 / "01.flac").write_bytes(b"\x00" * 1024)
            (disc1 / "02.flac").write_bytes(b"\x00" * 1024)
            (disc2 / "03.flac").write_bytes(b"\x00" * 2048)

            config = {
                "library_path": str(lib),
                "audio_extensions": [".flac"],
            }

            mock_mf = MagicMock()
            mock_mf.info.length = 240.0
            mock_mf.info.bitrate = 320000

            with patch("crate.library_sync.get_library_artist", return_value={"name": "Artist"}), \
                 patch("crate.library_sync.upsert_artist"), \
                 patch("crate.library_sync.upsert_album", return_value=1), \
                 patch("crate.library_sync.upsert_track") as mock_upsert_track, \
                 patch("crate.library_sync.get_db_ctx") as mock_ctx, \
                 patch("crate.library_sync.mutagen.File", return_value=mock_mf), \
                 patch("crate.library_sync.read_tags", return_value={"artist": "Artist", "album": "Album Deluxe", "title": "Track"}):
                mock_cur = MagicMock()
                mock_cur.fetchone.return_value = None
                mock_cur.fetchall.return_value = []
                mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
                mock_ctx.return_value.__exit__ = MagicMock(return_value=False)

                from crate.library_sync import LibrarySync
                sync = LibrarySync(config)
                result = sync.sync_album(album_dir, "Artist")

                assert result["track_count"] == 3
                assert result["total_size"] == 4096
                assert mock_upsert_track.call_count == 3

    def test_sync_artist_resyncs_album_when_track_count_is_stale(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            lib = Path(tmpdir)
            artist_dir = lib / "Artist"
            album_dir = artist_dir / "2001" / "Album Deluxe"
            disc1 = album_dir / "Disc 1"
            disc2 = album_dir / "Disc 2"
            disc1.mkdir(parents=True)
            disc2.mkdir(parents=True)
            (disc1 / "01.flac").write_bytes(b"\x00" * 1024)
            (disc1 / "02.flac").write_bytes(b"\x00" * 1024)
            (disc2 / "03.flac").write_bytes(b"\x00" * 2048)

            config = {
                "library_path": str(lib),
                "audio_extensions": [".flac"],
            }

            stale_album = {
                "id": 11,
                "path": str(album_dir),
                "track_count": 1,
                "dir_mtime": album_dir.stat().st_mtime,
                "total_size": 1024,
                "format": "flac",
            }

            from crate.library_sync import LibrarySync

            with patch("crate.library_sync.get_library_artist", return_value={"name": "Artist"}), \
                 patch("crate.library_sync.get_library_albums", return_value=[stale_album]), \
                 patch("crate.library_sync.upsert_artist"), \
                 patch.object(LibrarySync, "sync_album", return_value={"track_count": 3}) as mock_sync_album:
                sync = LibrarySync(config)
                count = sync.sync_artist(artist_dir)

                assert count == 3
                mock_sync_album.assert_called_once()


class TestRemoveStale:
    def test_remove_stale_artists(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            lib = Path(tmpdir)
            (lib / "Existing Artist").mkdir()

            config = {
                "library_path": str(lib),
                "audio_extensions": [".flac"],
            }

            with patch("crate.library_sync.get_db_ctx") as mock_ctx, \
                 patch("crate.library_sync.get_library_artist", return_value=None), \
                 patch("crate.library_sync.delete_artist") as mock_delete, \
                 patch("crate.library_sync.delete_album"):
                mock_cur = MagicMock()
                # First call: artists query returns existing + stale (with folder_name, album_count, track_count)
                # Second call: albums for stale artist (empty paths)
                # Third call: albums query for remove_stale albums phase
                mock_cur.fetchall.side_effect = [
                    [
                        {"name": "Existing Artist", "folder_name": "Existing Artist", "album_count": 1, "track_count": 5},
                        {"name": "Gone Artist", "folder_name": "Gone Artist", "album_count": 1, "track_count": 3},
                    ],
                    [],  # album paths for "Gone Artist"
                    [],  # albums phase
                ]
                mock_ctx.return_value.__enter__ = MagicMock(return_value=mock_cur)
                mock_ctx.return_value.__exit__ = MagicMock(return_value=False)

                from crate.library_sync import LibrarySync
                sync = LibrarySync(config)
                removed = sync.remove_stale()

                assert removed == 1
                mock_delete.assert_called_once_with("Gone Artist")


class TestParseInt:
    def test_normal_int(self):
        from crate.library_sync import _parse_int
        assert _parse_int("5") == 5

    def test_fraction_format(self):
        from crate.library_sync import _parse_int
        assert _parse_int("3/12") == 3

    def test_none(self):
        from crate.library_sync import _parse_int
        assert _parse_int(None) is None

    def test_invalid(self):
        from crate.library_sync import _parse_int
        assert _parse_int("abc") is None

    def test_default(self):
        from crate.library_sync import _parse_int
        assert _parse_int(None, 1) == 1
