from crate.entity_ids import (
    album_entity_uid,
    artist_entity_uid,
    genre_entity_uid,
    genre_taxonomy_entity_uid,
    track_entity_uid,
)


def test_artist_entity_uid_is_normalized_for_fallback_names():
    left = artist_entity_uid(name="  High   Vis ")
    right = artist_entity_uid(name="high vis")

    assert left == right


def test_artist_entity_uid_prefers_mbid_when_present():
    left = artist_entity_uid(name="High Vis", mbid="ABCD-1234")
    right = artist_entity_uid(name="Other Name", mbid="abcd1234")

    assert left == right


def test_album_entity_uid_prefers_releasegroup_over_name_fingerprint():
    left = album_entity_uid(
        artist_name="Quicksand",
        album_name="Slip",
        year="1993",
        musicbrainz_releasegroupid="RG-123",
    )
    right = album_entity_uid(
        artist_name="Other Artist",
        album_name="Other Album",
        year="2000",
        musicbrainz_releasegroupid="rg123",
    )

    assert left == right


def test_track_entity_uid_fallback_is_deterministic():
    left = track_entity_uid(
        artist_name="Dredg",
        album_name="El Cielo",
        title="Same Ol' Road",
        filename="01 - Same Ol' Road.flac",
        disc_number=1,
        track_number=1,
    )
    right = track_entity_uid(
        artist_name="dredg",
        album_name="el cielo",
        title="Same Ol Road",
        filename="01 - Same Ol Road.flac",
        disc_number=1,
        track_number=1,
    )

    assert left == right


def test_genre_entity_uid_is_slug_first():
    left = genre_entity_uid(name="Rock en español", slug="rock-en-espanol")
    right = genre_entity_uid(name="rock en espanol", slug="rock-en-espanol")

    assert left == right


def test_genre_taxonomy_entity_uid_prefers_mbid():
    left = genre_taxonomy_entity_uid(slug="post-hardcore", name="Post Hardcore", musicbrainz_mbid="MB-42")
    right = genre_taxonomy_entity_uid(slug="other", name="Other", musicbrainz_mbid="mb42")

    assert left == right
