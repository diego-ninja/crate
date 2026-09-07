from sqlalchemy import text


def test_manual_taxonomy_genres_replace_only_manual_assignments(pg_db):
    from crate.db.repositories.library_enrichment_writes import update_artist_metadata
    from crate.db.tx import transaction_scope

    artist_name = "Manual Genre Artist"
    pg_db.upsert_artist({"name": artist_name})
    pg_db.upsert_genre_taxonomy_node("manual-core", name="Manual Core")
    pg_db.set_artist_genres(
        artist_name,
        [("provider-tag", 0.8, "enrichment"), ("manual-old", 1.0, "manual")],
    )

    result = update_artist_metadata(
        artist_name=artist_name,
        metadata={"genres": ["manual-core"]},
    )

    assert result is not None
    assert "genres" in result["changed_fields"]
    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT g.slug, ag.source
                FROM artist_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE ag.artist_name = :artist_name
                ORDER BY g.slug
                """
                ),
                {"artist_name": artist_name},
            )
            .mappings()
            .all()
        )

    assert {row["slug"] for row in rows} == {"manual-core", "provider-tag"}
    assert {row["source"] for row in rows if row["slug"] == "manual-core"} == {"manual"}
    assert {row["source"] for row in rows if row["slug"] == "provider-tag"} == {
        "enrichment"
    }


def test_artist_genre_refresh_replaces_only_its_source(pg_db):
    from crate.db.repositories.genres_assignments import set_artist_genres
    from crate.db.tx import transaction_scope

    artist_name = "Genre Source Artist"
    pg_db.upsert_artist({"name": artist_name})
    set_artist_genres(
        artist_name,
        [
            ("provider-old", 0.8, "enrichment"),
            ("manual-core", 1.0, "manual"),
        ],
    )
    set_artist_genres(artist_name, [("provider-new", 0.9, "enrichment")])

    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                SELECT g.slug, ag.source
                FROM artist_genres ag
                JOIN genres g ON g.id = ag.genre_id
                WHERE ag.artist_name = :artist_name
                """
                ),
                {"artist_name": artist_name},
            )
            .mappings()
            .all()
        )

    assert {(row["slug"], row["source"]) for row in rows} == {
        ("manual-core", "manual"),
        ("provider-new", "enrichment"),
    }
