"""Tests for enrichment modules: Spotify, Setlist.fm, MusicBrainz, Last.fm."""

from unittest.mock import patch, MagicMock


class TestSpotifySearchArtist:
    def test_search_artist_cached(self):
        cached_result = {
            "id": "sp123",
            "name": "Radiohead",
            "popularity": 80,
            "followers": 5000000,
            "genres": ["alternative rock"],
            "images": [],
        }
        with patch("crate.spotify.get_cache", return_value=cached_result):
            from crate.spotify import search_artist
            result = search_artist("Radiohead")
            assert result == cached_result

    def test_search_artist_api_call(self):
        api_response = {
            "artists": {
                "items": [{
                    "id": "sp123",
                    "name": "Radiohead",
                    "popularity": 80,
                    "followers": {"total": 5000000},
                    "genres": ["alternative rock"],
                    "images": [{"url": "http://img.com/photo.jpg"}],
                }]
            }
        }
        with patch("crate.spotify.get_cache", return_value=None), \
             patch("crate.spotify._api_get", return_value=api_response), \
             patch("crate.spotify.set_cache") as mock_set:
            from crate.spotify import search_artist
            result = search_artist("Radiohead")
            assert result["id"] == "sp123"
            assert result["name"] == "Radiohead"
            assert result["popularity"] == 80
            mock_set.assert_called_once()

    def test_search_artist_no_results(self):
        with patch("crate.spotify.get_cache", return_value=None), \
             patch("crate.spotify._api_get", return_value={"artists": {"items": []}}):
            from crate.spotify import search_artist
            result = search_artist("NonExistentBand12345")
            assert result is None

    def test_search_artist_api_failure(self):
        with patch("crate.spotify.get_cache", return_value=None), \
             patch("crate.spotify._api_get", return_value=None):
            from crate.spotify import search_artist
            result = search_artist("Radiohead")
            assert result is None


class TestSetlistfmProbableSetlist:
    def test_get_probable_setlist_cached(self):
        cached = {"songs": [{"title": "Creep", "frequency": 0.8}]}
        with patch("crate.setlistfm.get_cache", return_value=cached):
            from crate.setlistfm import get_probable_setlist
            result = get_probable_setlist("Radiohead")
            assert result == [{"title": "Creep", "frequency": 0.8}]

    def test_get_probable_setlist_from_api(self):
        setlist_data = {
            "setlist": [
                {
                    "eventDate": "2024-06-01",
                    "sets": {"set": [{"song": [
                        {"name": "Everything In Its Right Place"},
                        {"name": "15 Step"},
                        {"name": "Everything In Its Right Place"},
                    ]}]}
                },
                {
                    "eventDate": "2024-05-15",
                    "sets": {"set": [{"song": [
                        {"name": "Everything In Its Right Place"},
                        {"name": "Airbag"},
                    ]}]}
                },
            ]
        }
        with patch("crate.setlistfm.get_cache", return_value=None), \
             patch("crate.setlistfm.search_artist", return_value="mbid-123"), \
             patch("crate.setlistfm.get_setlists", return_value=setlist_data), \
             patch("crate.setlistfm.set_cache"):
            from crate.setlistfm import get_probable_setlist
            result = get_probable_setlist("Radiohead", num_setlists=2)
            assert result is not None
            assert len(result) > 0
            # "Everything In Its Right Place" appears most frequently
            assert result[0]["title"] == "Everything In Its Right Place"
            assert result[0]["play_count"] == 3

    def test_get_probable_setlist_no_mbid(self):
        with patch("crate.setlistfm.get_cache", return_value=None), \
             patch("crate.setlistfm.search_artist", return_value=None):
            from crate.setlistfm import get_probable_setlist
            result = get_probable_setlist("Unknown Artist")
            assert result is None


class TestMusicBrainzGetArtistDetails:
    def test_get_artist_details_cached(self):
        cached = {
            "mbid": "abc-123",
            "type": "Group",
            "country": "GB",
        }
        with patch("crate.musicbrainz_ext.get_cache", return_value=cached):
            from crate.musicbrainz_ext import get_artist_details
            result = get_artist_details("Radiohead")
            assert result == cached

    def test_get_artist_details_from_api(self):
        mock_artist = {
            "artist": {
                "id": "abc-123",
                "type": "Group",
                "life-span": {"begin": "1985", "end": ""},
                "country": "GB",
                "area": {"name": "Oxfordshire"},
                "disambiguation": "English rock band",
                "artist-relation-list": [
                    {
                        "type": "member of band",
                        "artist": {"name": "Thom Yorke"},
                        "begin": "1985",
                        "end": "",
                        "attribute-list": ["vocals"],
                    }
                ],
                "url-relation-list": [
                    {"type": "wikipedia", "target": "https://en.wikipedia.org/wiki/Radiohead"},
                ],
            }
        }
        with patch("crate.musicbrainz_ext.get_cache", return_value=None), \
             patch("crate.musicbrainz_ext._search_mbid", return_value="abc-123"), \
             patch("crate.musicbrainz_ext.musicbrainzngs.get_artist_by_id", return_value=mock_artist), \
             patch("crate.musicbrainz_ext.set_cache") as mock_set:
            from crate.musicbrainz_ext import get_artist_details
            result = get_artist_details("Radiohead")
            assert result is not None
            assert result["mbid"] == "abc-123"
            assert result["type"] == "Group"
            assert result["country"] == "GB"
            assert len(result["members"]) == 1
            assert result["members"][0]["name"] == "Thom Yorke"
            assert "wikipedia" in result["urls"]
            mock_set.assert_called_once()

    def test_get_artist_details_no_mbid(self):
        with patch("crate.musicbrainz_ext.get_cache", return_value=None), \
             patch("crate.musicbrainz_ext._search_mbid", return_value=None):
            from crate.musicbrainz_ext import get_artist_details
            result = get_artist_details("Unknown")
            assert result is None


class TestLastfmGetArtistInfo:
    def test_get_artist_info_cached(self):
        cached = {
            "bio": "English rock band",
            "tags": ["rock"],
            "listeners": 5000000,
        }
        with patch("crate.lastfm.get_cache", return_value=cached):
            from crate.lastfm import get_artist_info
            result = get_artist_info("Radiohead")
            assert result == cached

    def test_get_artist_info_from_api(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "artist": {
                "name": "Radiohead",
                "bio": {"summary": "English rock band <a href=\"https://www.last.fm/music/Radiohead\">Read more on Last.fm</a>."},
                "image": [{"#text": "http://img.com/photo.jpg", "size": "large"}],
                "tags": {"tag": [{"name": "rock"}, {"name": "alternative"}]},
                "similar": {"artist": [{"name": "Muse"}, {"name": "Coldplay"}]},
                "stats": {"listeners": "5000000", "playcount": "200000000"},
                "url": "https://www.last.fm/music/Radiohead",
            }
        }
        mock_response.raise_for_status = MagicMock()

        with patch("crate.lastfm.get_cache", return_value=None), \
             patch("crate.lastfm._lastfm_key", return_value="test_key"), \
             patch("crate.lastfm.requests.get", return_value=mock_response), \
             patch("crate.lastfm.set_cache") as mock_set:
            from crate.lastfm import get_artist_info
            result = get_artist_info("Radiohead")
            assert result is not None
            assert "rock" in result["tags"]
            assert result["listeners"] == 5000000
            mock_set.assert_called_once()

    def test_get_artist_info_no_api_key(self):
        with patch("crate.lastfm.get_cache", return_value=None), \
             patch("crate.lastfm._lastfm_key", return_value=None):
            from crate.lastfm import get_artist_info
            result = get_artist_info("Radiohead")
            assert result is None


class TestCachingBehavior:
    def test_spotify_uses_cache_on_second_call(self):
        """Second call should use cache, not hit API."""
        api_response = {
            "artists": {
                "items": [{
                    "id": "sp1", "name": "Tool", "popularity": 75,
                    "followers": {"total": 3000000}, "genres": ["metal"],
                    "images": [],
                }]
            }
        }
        call_count = {"api": 0}

        def mock_api_get(*args, **kwargs):
            call_count["api"] += 1
            return api_response

        cached_result = {
            "id": "sp1", "name": "Tool", "popularity": 75,
            "followers": 3000000, "genres": ["metal"], "images": [],
        }

        # First call: no cache, hits API
        with patch("crate.spotify.get_cache", return_value=None), \
             patch("crate.spotify._api_get", side_effect=mock_api_get), \
             patch("crate.spotify.set_cache"):
            from crate.spotify import search_artist
            search_artist("Tool")
            assert call_count["api"] == 1

        # Second call: returns from cache
        with patch("crate.spotify.get_cache", return_value=cached_result):
            result = search_artist("Tool")
            assert result == cached_result
            assert call_count["api"] == 1  # No additional API call
