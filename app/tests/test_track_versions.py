from unittest.mock import patch

from crate.api.browse_artist import _match_setlist_track
from crate.db.home_personalized_collections import get_home_mix
from crate.db.home_builder_track_selection import _select_diverse_tracks_with_backfill
from crate.track_versions import canonical_track_title_key, track_variant_rank


def test_canonical_track_title_key_strips_known_variant_suffixes():
    assert canonical_track_title_key("Concubine") == "concubine"
    assert canonical_track_title_key("Concubine (Live at CBGB)") == "concubine"
    assert canonical_track_title_key("Concubine - 2024 Remaster") == "concubine"


def test_track_variant_rank_does_not_penalize_live_forever_style_titles():
    assert track_variant_rank("Live Forever") == 0
    assert track_variant_rank("Concubine") == 0
    assert track_variant_rank("Concubine (2024 Remaster)") == 1
    assert track_variant_rank("Concubine (Acoustic)") == 2
    assert track_variant_rank("Concubine (Live at CBGB)") == 3


def test_select_diverse_tracks_prefers_studio_version_over_live_variant():
    rows = [
        {
            "track_id": 1,
            "track_path": "/music/converge/live/concubine.flac",
            "title": "Concubine (Live at CBGB)",
            "artist": "Converge",
            "album": "Live at CBGB",
        },
        {
            "track_id": 2,
            "track_path": "/music/converge/jane-doe/concubine.flac",
            "title": "Concubine",
            "artist": "Converge",
            "album": "Jane Doe",
        },
        {
            "track_id": 3,
            "track_path": "/music/converge/jane-doe/fault-and-fracture.flac",
            "title": "Fault and Fracture",
            "artist": "Converge",
            "album": "Jane Doe",
        },
    ]

    selected = _select_diverse_tracks_with_backfill(rows, limit=2, max_per_artist=2, max_per_album=2)

    assert [row["title"] for row in selected] == ["Concubine", "Fault and Fracture"]


def test_select_diverse_tracks_keeps_live_fallback_when_no_studio_exists():
    rows = [
        {
            "track_id": 1,
            "track_path": "/music/converge/live/concubine.flac",
            "title": "Concubine (Live at CBGB)",
            "artist": "Converge",
            "album": "Live at CBGB",
        },
        {
            "track_id": 3,
            "track_path": "/music/converge/jane-doe/fault-and-fracture.flac",
            "title": "Fault and Fracture",
            "artist": "Converge",
            "album": "Jane Doe",
        },
    ]

    selected = _select_diverse_tracks_with_backfill(rows, limit=2, max_per_artist=2, max_per_album=2)

    assert [row["title"] for row in selected] == ["Concubine (Live at CBGB)", "Fault and Fracture"]


def test_select_diverse_tracks_does_not_collapse_plain_studio_title_duplicates_without_version_signal():
    rows = [
        {
            "track_id": 1,
            "track_path": "/music/artist/album-a/intro.flac",
            "title": "Intro",
            "artist": "Artist",
            "album": "Album A",
        },
        {
            "track_id": 2,
            "track_path": "/music/artist/album-b/intro.flac",
            "title": "Intro",
            "artist": "Artist",
            "album": "Album B",
        },
        {
            "track_id": 3,
            "track_path": "/music/artist/album-c/outro.flac",
            "title": "Outro",
            "artist": "Artist",
            "album": "Album C",
        },
    ]

    selected = _select_diverse_tracks_with_backfill(rows, limit=3, max_per_artist=3, max_per_album=2)

    assert [row["title"] for row in selected] == ["Intro", "Intro", "Outro"]


def test_match_setlist_track_prefers_studio_version_when_available():
    tracks = [
        {"id": 10, "title": "Concubine (Live at CBGB)", "album": "Live", "path": "/live.flac"},
        {"id": 11, "title": "Concubine (Remix)", "album": "Remix", "path": "/remix.flac"},
        {"id": 12, "title": "Concubine", "album": "Jane Doe", "path": "/studio.flac"},
    ]

    match = _match_setlist_track("Concubine", tracks, set())

    assert match is not None
    assert match["id"] == 12


def test_match_setlist_track_falls_back_to_live_version_when_needed():
    tracks = [
        {"id": 10, "title": "Concubine (Live at CBGB)", "album": "Live", "path": "/live.flac"},
        {"id": 11, "title": "Concubine (Remix)", "album": "Remix", "path": "/remix.flac"},
    ]

    match = _match_setlist_track("Concubine", tracks, set())

    assert match is not None
    assert canonical_track_title_key(match["title"]) == "concubine"
    assert track_variant_rank(match["title"]) > 0


def test_get_home_mix_detail_payload_dedupes_track_variants():
    rows = [
        {
            "track_id": 1,
            "track_entity_uid": "track-live",
            "track_path": "/music/converge/live/concubine.flac",
            "title": "Concubine (Live at CBGB)",
            "artist": "Converge",
            "artist_id": 7,
            "artist_entity_uid": "artist-7",
            "artist_slug": "converge",
            "album": "Live at CBGB",
            "album_id": 20,
            "album_entity_uid": "album-20",
            "album_slug": "live-at-cbgb",
            "duration": 97,
            "format": "flac",
        },
        {
            "track_id": 2,
            "track_entity_uid": "track-studio",
            "track_path": "/music/converge/jane-doe/concubine.flac",
            "title": "Concubine",
            "artist": "Converge",
            "artist_id": 7,
            "artist_entity_uid": "artist-7",
            "artist_slug": "converge",
            "album": "Jane Doe",
            "album_id": 10,
            "album_entity_uid": "album-10",
            "album_slug": "jane-doe",
            "duration": 79,
            "format": "flac",
        },
    ]

    with patch("crate.db.home_personalized_collections.get_cached_home_context", return_value={"interest_artists_lower": [], "top_genres_lower": []}), \
         patch("crate.db.home_personalized_collections.recent_releases_from_context", return_value=[]), \
         patch("crate.db.home_personalized_collections._build_mix_rows", return_value=("Punk Rock Mix", "desc", rows)):
        payload = get_home_mix(1, "genre-punk-rock", limit=40)

    assert payload is not None
    assert [track["title"] for track in payload["tracks"]] == ["Concubine"]
