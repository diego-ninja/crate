from crate.acquisition_tasks import (
    build_soulseek_download_params,
    build_tidal_download_params,
    infer_tidal_entity_type,
    soulseek_download_dedup_key,
    tidal_download_dedup_key,
)


def test_infer_tidal_entity_type_distinguishes_track_album_artist_and_playlist():
    assert infer_tidal_entity_type("https://tidal.com/track/123") == "track"
    assert infer_tidal_entity_type("https://tidal.com/browse/album/456") == "album"
    assert infer_tidal_entity_type("https://tidal.com/artist/789") == "artist"
    assert infer_tidal_entity_type("https://tidal.com/playlist/abc") == "playlist"


def test_build_tidal_download_params_keeps_explicit_entity_type():
    params = build_tidal_download_params(
        url="https://tidal.com/album/456",
        quality="max",
        content_type="track",
        artist="Terror",
        album="Still Suffer",
    )

    assert params["entity_type"] == "track"
    assert params["artist"] == "Terror"
    assert params["album"] == "Still Suffer"


def test_tidal_dedup_key_differs_for_track_album_and_artist_entities():
    album = tidal_download_dedup_key(
        build_tidal_download_params(
            url="https://tidal.com/album/456",
            quality="max",
            content_type="album",
            artist="Terror",
            album="Still Suffer",
        )
    )
    track = tidal_download_dedup_key(
        build_tidal_download_params(
            url="https://tidal.com/track/123",
            quality="max",
            content_type="track",
            artist="Terror",
            album="Still Suffer",
        )
    )
    artist = tidal_download_dedup_key(
        build_tidal_download_params(
            url="https://tidal.com/artist/789",
            quality="max",
            content_type="artist",
            artist="Terror",
        )
    )

    assert len({album, track, artist}) == 3


def test_soulseek_dedup_key_is_stable_for_same_album_file_set_regardless_of_order():
    left = soulseek_download_dedup_key(
        build_soulseek_download_params(
            username="peer-a",
            artist="Terror",
            album="One With The Underdogs",
            files=["music/Terror/One/02.flac", "music/Terror/One/01.flac"],
            file_count=2,
        )
    )
    right = soulseek_download_dedup_key(
        build_soulseek_download_params(
            username="peer-a",
            artist="Terror",
            album="One With The Underdogs",
            files=["music/Terror/One/01.flac", "music/Terror/One/02.flac"],
            file_count=2,
        )
    )

    assert left == right
