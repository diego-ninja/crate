from crate.artist_bio import normalize_artist_bio


def test_normalize_artist_bio_removes_lastfm_boilerplate_and_preserves_paragraphs():
    raw = (
        "First paragraph.\n\n"
        'Second paragraph. <a href="https://example.com">Official site</a>.\n\n'
        "User-contributed text is available under the Creative Commons By-SA License;\n"
        "additional terms may apply."
    )

    assert normalize_artist_bio(raw) == (
        "First paragraph.\n\nSecond paragraph. Official site."
    )


def test_normalize_artist_bio_removes_read_more_and_decodes_entities():
    raw = "A &amp; B\nRead more on Last.fm."

    assert normalize_artist_bio(raw) == "A & B"


def test_normalize_artist_bio_preserves_urls_and_is_idempotent():
    raw = "Visit https://example.com/bio)."

    normalized = normalize_artist_bio(raw)

    assert normalized == raw
    assert normalize_artist_bio(normalized) == normalized


def test_normalize_artist_bio_returns_empty_for_only_boilerplate():
    assert (
        normalize_artist_bio(
            "User-contributed text is available under the Creative Commons By-SA "
            "License; additional terms may apply."
        )
        == ""
    )
