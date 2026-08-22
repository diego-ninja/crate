"""Tests for enrichment modules: Spotify, Setlist.fm, MusicBrainz, Last.fm."""

import threading
from types import SimpleNamespace
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
                "items": [
                    {
                        "id": "sp123",
                        "name": "Radiohead",
                        "popularity": 80,
                        "followers": {"total": 5000000},
                        "genres": ["alternative rock"],
                        "images": [{"url": "http://img.com/photo.jpg"}],
                    }
                ]
            }
        }
        with (
            patch("crate.spotify.get_cache", return_value=None),
            patch("crate.spotify._api_get", return_value=api_response),
            patch("crate.spotify.set_cache") as mock_set,
        ):
            from crate.spotify import search_artist

            result = search_artist("Radiohead")
            assert result["id"] == "sp123"
            assert result["name"] == "Radiohead"
            assert result["popularity"] == 80
            mock_set.assert_called_once()

    def test_search_artist_no_results(self):
        with (
            patch("crate.spotify.get_cache", return_value=None),
            patch("crate.spotify._api_get", return_value={"artists": {"items": []}}),
        ):
            from crate.spotify import search_artist

            result = search_artist("NonExistentBand12345")
            assert result is None

    def test_search_artist_api_failure(self):
        with (
            patch("crate.spotify.get_cache", return_value=None),
            patch("crate.spotify._api_get", return_value=None),
        ):
            from crate.spotify import search_artist

            result = search_artist("Radiohead")
            assert result is None


class TestSetlistfmProbableSetlist:
    def test_get_probable_setlist_cached(self):
        cached = {"songs": [{"title": "Creep", "frequency": 0.8}]}
        with patch("crate.setlistfm.get_cache", return_value=cached):
            from crate.setlistfm import get_probable_setlist

            result = get_probable_setlist("Radiohead")
            assert result is not None
            assert result[0]["title"] == "Creep"
            assert result[0]["frequency"] == 0.8

    def test_get_probable_setlist_normalizes_cached_object_shape(self):
        cached = {"songs": {"song": {"name": "Una historia con las manos"}}}
        with patch("crate.setlistfm.get_cache", return_value=cached):
            from crate.setlistfm import get_probable_setlist

            result = get_probable_setlist("Biznaga")

        assert result is not None
        assert result[0]["title"] == "Una historia con las manos"
        assert result[0]["frequency"] == 1.0
        assert result[0]["play_count"] == 1

    def test_get_probable_setlist_from_api(self):
        setlist_data = {
            "setlist": [
                {
                    "eventDate": "2024-06-01",
                    "sets": {
                        "set": [
                            {
                                "song": [
                                    {"name": "Everything In Its Right Place"},
                                    {"name": "15 Step"},
                                    {"name": "Everything In Its Right Place"},
                                ]
                            }
                        ]
                    },
                },
                {
                    "eventDate": "2024-05-15",
                    "sets": {
                        "set": [
                            {
                                "song": [
                                    {"name": "Everything In Its Right Place"},
                                    {"name": "Airbag"},
                                ]
                            }
                        ]
                    },
                },
            ]
        }
        with (
            patch("crate.setlistfm.get_cache", return_value=None),
            patch("crate.setlistfm.search_artist", return_value="mbid-123"),
            patch("crate.setlistfm.get_setlists", return_value=setlist_data),
            patch("crate.setlistfm.set_cache"),
        ):
            from crate.setlistfm import get_probable_setlist

            result = get_probable_setlist("Radiohead", num_setlists=2)
            assert result is not None
            assert len(result) > 0
            # "Everything In Its Right Place" appears most frequently
            assert result[0]["title"] == "Everything In Its Right Place"
            assert result[0]["play_count"] == 3

    def test_get_probable_setlist_accepts_setlistfm_object_shapes(self):
        setlist_data = {
            "setlist": {
                "eventDate": "2024-06-01",
                "sets": {
                    "set": {
                        "song": {
                            "name": "Una historia con las manos",
                        }
                    }
                },
            }
        }
        with (
            patch("crate.setlistfm.get_cache", return_value=None),
            patch("crate.setlistfm.search_artist", return_value="mbid-123"),
            patch("crate.setlistfm.get_setlists", return_value=setlist_data),
            patch("crate.setlistfm.set_cache"),
        ):
            from crate.setlistfm import get_probable_setlist

            result = get_probable_setlist("Biznaga", num_setlists=1)

        assert result is not None
        assert result[0]["title"] == "Una historia con las manos"
        assert result[0]["play_count"] == 1

    def test_get_probable_setlist_no_mbid(self):
        with (
            patch("crate.setlistfm.get_cache", return_value=None),
            patch("crate.setlistfm.search_artist", return_value=None),
        ):
            from crate.setlistfm import get_probable_setlist

            result = get_probable_setlist("Unknown Artist")
            assert result is None


class TestArtistPageEnrichment:
    def test_artist_page_enrichment_uses_cached_setlist_when_available(self):
        with (
            patch("crate.api.enrichment.get_cache", return_value=None),
            patch(
                "crate.api.enrichment.setlistfm.get_cached_probable_setlist",
                return_value=[{"title": "Creep"}],
            ),
            patch("crate.api.enrichment.setlistfm.get_probable_setlist") as mock_live,
        ):
            from crate.api.enrichment import get_artist_page_enrichment

            result = get_artist_page_enrichment("Radiohead")

        assert result == {
            "setlist": {"probable_setlist": [{"title": "Creep"}], "total_shows": 1}
        }
        mock_live.assert_not_called()

    def test_artist_page_enrichment_queues_refresh_when_cache_misses(self):
        with (
            patch("crate.api.enrichment.get_cache", return_value=None),
            patch(
                "crate.api.enrichment.setlistfm.get_cached_probable_setlist",
                return_value=None,
            ),
            patch(
                "crate.api.enrichment.setlistfm.queue_probable_setlist_refresh"
            ) as mock_queue,
        ):
            from crate.api.enrichment import get_artist_page_enrichment

            result = get_artist_page_enrichment("Radiohead")

        assert result == {}
        mock_queue.assert_called_once_with("Radiohead")

    def test_artist_enrichment_queues_setlist_without_blocking_stale_cache(self):
        cached = {"lastfm": {"bio": "Bio"}}
        request = SimpleNamespace(state=SimpleNamespace(user={"role": "user"}))

        with (
            patch("crate.api.enrichment.require_permission"),
            patch("crate.api.enrichment.get_cache", return_value=cached),
            patch(
                "crate.api.enrichment.setlistfm.get_cached_probable_setlist",
                return_value=None,
            ),
            patch(
                "crate.api.enrichment.setlistfm.queue_probable_setlist_refresh"
            ) as mock_queue,
            patch("crate.api.enrichment.set_cache") as mock_set_cache,
        ):
            from crate.api.enrichment import get_artist_enrichment

            result = get_artist_enrichment(request, "Placebo")

        assert result == {"lastfm": {"bio": "Bio"}}
        mock_queue.assert_called_once_with("Placebo")
        mock_set_cache.assert_called_once()


class TestGenreMetadataTasks:
    def test_enrich_genre_descriptions_reports_raw_focus_without_taxonomy_node(self):
        with (
            patch(
                "crate.db.genres.list_genre_taxonomy_nodes_for_external_enrichment",
                return_value=[],
            ),
            patch("crate.db.genres.get_genre_taxonomy_node_id", return_value=None),
        ):
            from crate.genre_descriptions import enrich_genre_descriptions_batch

            result = enrich_genre_descriptions_batch(
                limit=1, focus_slug="instrumental", force=True
            )

        assert result["processed"] == 0
        assert result["reason"] == "focus_slug_not_taxonomy_node"
        assert result["focus_slug"] == "instrumental"

    def test_sync_musicbrainz_genre_graph_reports_raw_focus_without_taxonomy_node(self):
        with (
            patch(
                "crate.db.genres.list_genre_taxonomy_nodes_for_musicbrainz_sync",
                return_value=[],
            ),
            patch("crate.db.genres.get_genre_taxonomy_node_id", return_value=None),
        ):
            from crate.genre_descriptions import sync_musicbrainz_genre_graph_batch

            result = sync_musicbrainz_genre_graph_batch(
                limit=1, focus_slug="instrumental", force=True
            )

        assert result["processed"] == 0
        assert result["reason"] == "focus_slug_not_taxonomy_node"
        assert result["focus_slug"] == "instrumental"


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
                    {
                        "type": "wikipedia",
                        "target": "https://en.wikipedia.org/wiki/Radiohead",
                    },
                ],
            }
        }
        with (
            patch("crate.musicbrainz_ext.get_cache", return_value=None),
            patch("crate.musicbrainz_ext._search_mbid", return_value="abc-123"),
            patch(
                "crate.musicbrainz_ext.musicbrainzngs.get_artist_by_id",
                return_value=mock_artist,
            ),
            patch("crate.musicbrainz_ext.set_cache") as mock_set,
        ):
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
        with (
            patch("crate.musicbrainz_ext.get_cache", return_value=None),
            patch("crate.musicbrainz_ext._search_mbid", return_value=None),
        ):
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
                "bio": {
                    "summary": (
                        'English rock band <a href="https://www.last.fm/music/Radiohead">'
                        "Read more on Last.fm</a>. User-contributed text is available "
                        "under the Creative Commons By-SA License; additional terms may apply."
                    )
                },
                "image": [{"#text": "http://img.com/photo.jpg", "size": "large"}],
                "tags": {"tag": [{"name": "rock"}, {"name": "alternative"}]},
                "similar": {"artist": [{"name": "Muse"}, {"name": "Coldplay"}]},
                "stats": {"listeners": "5000000", "playcount": "200000000"},
                "url": "https://www.last.fm/music/Radiohead",
            }
        }
        mock_response.raise_for_status = MagicMock()

        with (
            patch("crate.lastfm.get_cache", return_value=None),
            patch("crate.lastfm._lastfm_key", return_value="test_key"),
            patch("crate.lastfm.requests.get", return_value=mock_response),
            patch("crate.lastfm.set_cache") as mock_set,
        ):
            from crate.lastfm import get_artist_info

            result = get_artist_info("Radiohead")
            assert result is not None
            assert "rock" in result["tags"]
            assert result["listeners"] == 5000000
            assert result["bio"] == "English rock band"
            mock_set.assert_called_once()

    def test_get_artist_info_no_api_key(self):
        with (
            patch("crate.lastfm.get_cache", return_value=None),
            patch("crate.lastfm._lastfm_key", return_value=None),
        ):
            from crate.lastfm import get_artist_info

            result = get_artist_info("Radiohead")
            assert result is None

    def test_get_similar_artists_includes_lastfm_image_metadata(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "similarartists": {
                "artist": [
                    {
                        "name": "Chelsea Wolfe",
                        "match": "0.91",
                        "url": "https://www.last.fm/music/Chelsea+Wolfe",
                        "image": [
                            {
                                "#text": "https://lastfm.example/2a96cbd8b46e442fc41c2b86b821562f.png",
                                "size": "small",
                            },
                            {
                                "#text": "https://lastfm.example/chelsea-wolfe.jpg",
                                "size": "extralarge",
                            },
                        ],
                    },
                    {
                        "name": "No Image",
                        "match": "not-a-float",
                        "image": [],
                    },
                ]
            }
        }

        with (
            patch("crate.lastfm._lastfm_key", return_value="test_key"),
            patch("crate.lastfm.requests.get", return_value=mock_response),
        ):
            from crate.lastfm import _get_similar_artists

            result = _get_similar_artists("Emma Ruth Rundle")

        assert result[0] == {
            "name": "Chelsea Wolfe",
            "match": 0.91,
            "image_url": "https://lastfm.example/chelsea-wolfe.jpg",
            "url": "https://www.last.fm/music/Chelsea+Wolfe",
            "source": "lastfm",
        }
        assert result[1] == {
            "name": "No Image",
            "match": 0.0,
            "image_url": None,
            "url": "https://www.last.fm/music/No%20Image",
            "source": "lastfm",
        }

    def test_get_best_artist_image_url_uses_deezer_when_lastfm_has_no_image(self):
        with (
            patch("crate.lastfm.get_cache", return_value=None),
            patch("crate.lastfm.get_fanart_artist_image", return_value=None),
            patch(
                "crate.lastfm._deezer_artist_image",
                return_value="https://deezer.example/poison-the-well.jpg",
            ),
            patch("crate.lastfm.set_cache") as mock_set,
        ):
            from crate.lastfm import get_best_artist_image_url

            result = get_best_artist_image_url("Poison The Well")

        assert result == "https://deezer.example/poison-the-well.jpg"
        mock_set.assert_called_with(
            "artist:image_url:poison the well",
            {"url": "https://deezer.example/poison-the-well.jpg"},
            ttl=604800,
        )

    def test_deezer_artist_image_retries_cached_negative_and_accepts_first_match(self):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "data": [
                {
                    "name": "slowthai",
                    "picture_xl": "https://deezer.example/slowthai.jpg",
                }
            ]
        }

        with (
            patch("crate.lastfm.get_cache", return_value={"url": None}),
            patch("crate.lastfm.requests.get", return_value=mock_response),
            patch("crate.lastfm.set_cache") as mock_set,
        ):
            from crate.lastfm import _deezer_artist_image

            result = _deezer_artist_image("slowthai")

        assert result == "https://deezer.example/slowthai.jpg"
        mock_set.assert_called_with(
            "deezer:artist_img:slowthai",
            {"url": "https://deezer.example/slowthai.jpg"},
            ttl=604800,
        )


class TestCachingBehavior:
    def test_spotify_uses_cache_on_second_call(self):
        """Second call should use cache, not hit API."""
        api_response = {
            "artists": {
                "items": [
                    {
                        "id": "sp1",
                        "name": "Tool",
                        "popularity": 75,
                        "followers": {"total": 3000000},
                        "genres": ["metal"],
                        "images": [],
                    }
                ]
            }
        }
        call_count = {"api": 0}

        def mock_api_get(*args, **kwargs):
            call_count["api"] += 1
            return api_response

        cached_result = {
            "id": "sp1",
            "name": "Tool",
            "popularity": 75,
            "followers": 3000000,
            "genres": ["metal"],
            "images": [],
        }

        # First call: no cache, hits API
        with (
            patch("crate.spotify.get_cache", return_value=None),
            patch("crate.spotify._api_get", side_effect=mock_api_get),
            patch("crate.spotify.set_cache"),
        ):
            from crate.spotify import search_artist

            search_artist("Tool")
            assert call_count["api"] == 1

        # Second call: returns from cache
        with patch("crate.spotify.get_cache", return_value=cached_result):
            result = search_artist("Tool")
            assert result == cached_result
            assert call_count["api"] == 1  # No additional API call


class TestArtistEnrichment:
    def test_run_enrichment_fetchers_uses_multiple_workers(self):
        from crate.enrichment import _run_enrichment_fetchers

        barrier = threading.Barrier(2, timeout=1)

        def _fetch_lastfm():
            barrier.wait()
            return {"source": "lastfm"}

        def _fetch_spotify():
            barrier.wait()
            return {"source": "spotify"}

        with patch("crate.enrichment.wait_for_provider_slot", return_value=0):
            result = _run_enrichment_fetchers(
                "Radiohead",
                {"lastfm": _fetch_lastfm, "spotify": _fetch_spotify},
                max_workers=2,
            )

        assert result == {
            "lastfm": {"source": "lastfm"},
            "spotify": {"source": "spotify"},
        }

    def test_collect_enrichment_payloads_uses_source_cache(self):
        from crate.enrichment import _collect_enrichment_payloads

        cached_lastfm = {"bio": "cached bio"}

        def _get_cache(key, max_age_seconds=None):
            if key == "enrichment:source:lastfm:radiohead":
                return cached_lastfm
            return None

        with (
            patch("crate.enrichment.get_cache", side_effect=_get_cache),
            patch("crate.enrichment.set_cache") as mock_set_cache,
            patch("crate.enrichment.wait_for_provider_slot", return_value=0),
            patch("crate.enrichment._discogs_is_configured", return_value=False),
            patch("crate.enrichment._fetch_lastfm_payload") as mock_lastfm,
            patch(
                "crate.enrichment._fetch_spotify_payload",
                return_value={"artist": {"id": "sp1"}},
            ),
            patch("crate.enrichment._fetch_musicbrainz_payload", return_value=None),
            patch("crate.enrichment._fetch_setlist_payload", return_value=None),
            patch("crate.enrichment._fetch_fanart_payload", return_value=None),
        ):
            result = _collect_enrichment_payloads("Radiohead", max_workers=1)

        assert result["lastfm"] == cached_lastfm
        assert result["spotify"] == {"artist": {"id": "sp1"}}
        mock_lastfm.assert_not_called()
        mock_set_cache.assert_any_call(
            "enrichment:source:spotify:radiohead",
            {"artist": {"id": "sp1"}},
            ttl=86400 * 3,
        )

    def test_enrich_artist_merges_parallel_payloads_and_persists(self, tmp_path):
        artist_dir = tmp_path / "Radiohead"
        artist_dir.mkdir()
        (artist_dir / "artist.jpg").write_bytes(b"already-present")

        payloads = {
            "lastfm": {
                "bio": "English rock band",
                "tags": ["rock"],
                "similar": [{"name": "Muse", "match": 0.88}],
                "listeners": 5000000,
                "playcount": 200000000,
                "url": "https://www.last.fm/music/Radiohead",
            },
            "spotify": {
                "artist": {
                    "id": "sp123",
                    "popularity": 80,
                    "followers": 5000000,
                    "genres": ["alternative rock"],
                    "url": "https://open.spotify.com/artist/sp123",
                },
                "top_tracks": [{"name": "Creep"}],
                "related_artists": [{"name": "Muse"}],
            },
            "musicbrainz": {
                "mbid": "mbid-123",
                "country": "GB",
                "area": "Oxfordshire",
                "begin_date": "1985",
                "end_date": "",
                "type": "Group",
                "members": [{"name": "Thom Yorke"}],
                "urls": {"wikipedia": "https://en.wikipedia.org/wiki/Radiohead"},
            },
            "setlist": [{"title": "Everything In Its Right Place", "frequency": 1.0}],
            "fanart": {"backgrounds": ["https://img.example/bg.jpg"]},
            "discogs": {
                "discogs_id": 42,
                "discogs_profile": "Profile text",
                "discogs_members": ["Thom Yorke", "Jonny Greenwood"],
                "discogs_url": "https://www.discogs.com/artist/42-Radiohead",
            },
        }

        with (
            patch(
                "crate.enrichment.get_library_artist",
                return_value={"folder_name": "Radiohead", "enriched_at": None},
            ),
            patch(
                "crate.enrichment._collect_enrichment_payloads", return_value=payloads
            ),
            patch("crate.enrichment.set_cache") as mock_set_cache,
            patch(
                "crate.enrichment.update_artist_enrichment"
            ) as mock_update_artist_enrichment,
            patch(
                "crate.enrichment.bulk_upsert_similarities"
            ) as mock_bulk_upsert_similarities,
            patch("crate.enrichment.set_artist_genres") as mock_set_artist_genres,
            patch(
                "crate.enrichment._download_artist_photo"
            ) as mock_download_artist_photo,
        ):
            from crate.enrichment import enrich_artist

            result = enrich_artist(
                "Radiohead",
                {"library_path": str(tmp_path), "enrichment_parallelism": 3},
            )

        assert result == {
            "artist": "Radiohead",
            "has_lastfm": True,
            "has_spotify": True,
            "has_setlist": True,
            "has_musicbrainz": True,
            "has_fanart": True,
            "has_discogs": True,
            "has_bandcamp": False,
        }

        mock_set_cache.assert_called_once()
        mock_update_artist_enrichment.assert_called_once()
        persist_data = mock_update_artist_enrichment.call_args.args[1]
        assert persist_data["bio"] == "English rock band"
        assert persist_data["spotify_id"] == "sp123"
        assert persist_data["spotify_popularity"] == 80
        assert persist_data["spotify_followers"] == 5000000
        assert persist_data["mbid"] == "mbid-123"
        assert persist_data["discogs_id"] == "42"
        assert persist_data["tags"] == ["rock", "alternative rock"]
        assert persist_data["similar"] == [{"name": "Muse", "match": 0.88}]
        assert persist_data["urls"] == {
            "wikipedia": "https://en.wikipedia.org/wiki/Radiohead",
            "lastfm": "https://www.last.fm/music/Radiohead",
            "spotify": "https://open.spotify.com/artist/sp123",
            "discogs": "https://www.discogs.com/artist/42-Radiohead",
        }

        mock_bulk_upsert_similarities.assert_called_once_with(
            "Radiohead",
            [{"name": "Muse", "match": 0.88}],
        )
        mock_set_artist_genres.assert_called_once()
        genre_rows = mock_set_artist_genres.call_args.args[1]
        assert [row[0] for row in genre_rows] == ["rock", "alternative rock"]
        mock_download_artist_photo.assert_not_called()

    def test_enrich_artists_delegates_large_batches(self, monkeypatch):
        from crate.worker_handlers import enrichment as worker_enrichment

        artists = [{"name": f"Artist {index:02d}"} for index in range(45)]
        created: list[tuple[str, dict, str | None]] = []

        def _create_task(task_type, params=None, *, parent_task_id=None, **kwargs):
            created.append((task_type, params or {}, parent_task_id))
            return f"task-{len(created)}"

        monkeypatch.setattr(
            worker_enrichment,
            "get_library_artists",
            lambda per_page=10000: (artists, len(artists)),
        )
        monkeypatch.setattr(
            worker_enrichment, "get_setting", lambda name, default: default
        )
        monkeypatch.setattr(
            worker_enrichment, "emit_task_event", lambda *args, **kwargs: None
        )
        monkeypatch.setattr(
            worker_enrichment, "emit_progress", lambda *args, **kwargs: None
        )

        with patch("crate.db.repositories.tasks.create_task", side_effect=_create_task):
            result = worker_enrichment._handle_enrich_artists(
                "parent-task",
                {"chunk_size": 20},
                {"library_path": "/tmp/music"},
            )

        assert result == {"_delegated": True, "chunks": 3, "artists": 45}
        assert [call[0] for call in created] == [
            "enrich_artists",
            "enrich_artists",
            "enrich_artists",
        ]
        assert [len(call[1]["artists"]) for call in created] == [20, 20, 5]
        assert {call[2] for call in created} == {"parent-task"}

    def test_process_new_content_refreshes_artist_summary_in_finally(self, monkeypatch):
        from crate.worker_handlers import enrichment as worker_enrichment

        calls: list[tuple[str, str]] = []

        monkeypatch.setattr(
            worker_enrichment,
            "_mark_processing",
            lambda artist: calls.append(("mark", artist)),
        )
        monkeypatch.setattr(
            worker_enrichment,
            "_unmark_processing",
            lambda artist: calls.append(("unmark", artist)),
        )
        monkeypatch.setattr(
            worker_enrichment,
            "_process_new_content_refresh_artist_summary",
            lambda artist, config: calls.append(("refresh", artist)),
        )
        monkeypatch.setattr(
            worker_enrichment,
            "_process_new_content_inner",
            lambda *args, **kwargs: {"artist": "VVV [Trippin'you]"},
        )

        result = worker_enrichment._handle_process_new_content(
            "task-1",
            {"artist": "VVV [Trippin'you]"},
            {"library_path": "/tmp/music"},
        )

        assert result == {"artist": "VVV [Trippin'you]"}
        assert calls == [
            ("mark", "VVV [Trippin'you]"),
            ("refresh", "VVV [Trippin'you]"),
            ("unmark", "VVV [Trippin'you]"),
        ]

    def test_process_new_content_skips_hidden_artist_without_refresh(self, monkeypatch):
        from crate.worker_handlers import enrichment as worker_enrichment

        calls: list[tuple[str, str]] = []

        monkeypatch.setattr(
            worker_enrichment,
            "_mark_processing",
            lambda artist: calls.append(("mark", artist)),
        )
        monkeypatch.setattr(
            worker_enrichment,
            "_unmark_processing",
            lambda artist: calls.append(("unmark", artist)),
        )
        monkeypatch.setattr(
            worker_enrichment,
            "_process_new_content_refresh_artist_summary",
            lambda artist, config: calls.append(("refresh", artist)),
        )
        monkeypatch.setattr(
            worker_enrichment,
            "_process_new_content_inner",
            lambda *args, **kwargs: calls.append(("inner", "")),
        )

        result = worker_enrichment._handle_process_new_content(
            "task-1",
            {"artist": ".crate-trash"},
            {"library_path": "/tmp/music"},
        )

        assert result == {
            "artist": ".crate-trash",
            "album": "",
            "skipped": True,
            "reason": "hidden_library_path",
        }
        assert calls == []

    def test_process_new_content_propagates_force_to_artist_enrichment(
        self, monkeypatch, tmp_path
    ):
        from crate.worker_handlers import enrichment as worker_enrichment

        forwarded_force: list[bool | None] = []

        monkeypatch.setattr(
            worker_enrichment, "get_library_artist", lambda _artist: None
        )
        monkeypatch.setattr(
            worker_enrichment, "emit_progress", lambda *args, **kwargs: None
        )
        monkeypatch.setattr(
            worker_enrichment,
            "_process_new_content_organize_folders",
            lambda *args, **kwargs: None,
        )
        monkeypatch.setattr(
            worker_enrichment,
            "_process_new_content_enrich_artist",
            lambda *args, **kwargs: forwarded_force.append(kwargs.get("force")),
        )
        monkeypatch.setattr(
            worker_enrichment,
            "_process_new_content_album_genres",
            lambda *args, **kwargs: [],
        )
        for helper in (
            "_process_new_content_album_mbids",
            "_process_new_content_bandcamp_urls",
            "_process_new_content_lyrics",
            "_process_new_content_audio_fingerprints",
            "_process_new_content_popularity",
            "_process_new_content_missing_covers",
            "_process_new_content_portable_metadata",
            "_process_new_content_update_artist_hash",
        ):
            monkeypatch.setattr(worker_enrichment, helper, lambda *args, **kwargs: None)
        monkeypatch.setattr("requests.post", lambda *args, **kwargs: None)

        worker_enrichment._process_new_content_inner(
            "task-1",
            {"force": True},
            {"library_path": str(tmp_path)},
            "Birds In Row",
            "",
        )

        assert forwarded_force == [True]

    def test_invalidate_artist_top_tracks_cache_uses_artist_prefix(self, monkeypatch):
        from crate.worker_handlers import enrichment as worker_enrichment

        prefixes: list[str] = []
        monkeypatch.setattr(
            worker_enrichment,
            "delete_cache_prefix",
            lambda prefix: prefixes.append(prefix),
        )

        worker_enrichment._invalidate_artist_top_tracks_cache(" Birds In Row ")

        assert prefixes == [
            "listen:artist_top_tracks:v1:birds in row:",
            "listen:artist_top_tracks:v2:birds in row:",
            "listen:artist_top_tracks:v3:birds in row:",
        ]


def test_download_artist_photo_queues_persistent_variants(monkeypatch, tmp_path):
    from crate import enrichment

    queued = []
    monkeypatch.setattr(
        "crate.lastfm.get_best_artist_image", lambda _name: b"artist-image"
    )
    monkeypatch.setattr(enrichment, "update_artist_has_photo", lambda _name: None)
    monkeypatch.setattr(
        enrichment,
        "queue_artwork_materialization",
        lambda asset, *, reason: queued.append((asset.kind, asset.entity_key, reason)),
    )

    assert enrichment._download_artist_photo(
        "Converge", tmp_path, entity_uid="artist-entity"
    )
    assert queued == [("artist-photo", "artist-entity", "source-write")]


def test_new_content_cover_fetch_queues_persistent_variants(monkeypatch, tmp_path):
    from crate.task_progress import TaskProgress
    from crate.worker_handlers import enrichment as worker_enrichment

    album_dir = tmp_path / "Album"
    album_dir.mkdir()
    queued = []
    monkeypatch.setattr(
        "crate.artwork.fetch_cover_from_caa", lambda _mbid: b"cover-image"
    )
    monkeypatch.setattr("crate.artwork.save_cover", lambda _path, _data: None)
    monkeypatch.setattr(worker_enrichment, "wait_for_provider_slot", lambda *_args: 0)
    monkeypatch.setattr(
        worker_enrichment, "emit_progress", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(worker_enrichment, "update_album_has_cover", lambda _id: None)
    monkeypatch.setattr(
        worker_enrichment,
        "queue_artwork_materialization",
        lambda asset, *, reason: queued.append((asset.kind, asset.entity_key, reason)),
    )
    result = {"steps": {}}

    worker_enrichment._process_new_content_missing_covers(
        "task-1",
        result,
        [
            {
                "id": 2,
                "entity_uid": "album-entity",
                "name": "Album",
                "path": str(album_dir),
                "musicbrainz_albumid": "mbid",
            }
        ],
        "Artist",
        "",
        TaskProgress(),
    )

    assert result["steps"]["covers"] == 1
    assert queued == [("album-cover", "album-entity", "source-write")]
