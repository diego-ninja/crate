from crate.db.queries.shows_shared import dedupe_show_rows, show_dedupe_key


def test_show_dedupe_key_ignores_source_specific_ids():
    first = {
        "id": 101,
        "external_id": "ticketmaster-abc",
        "artist_name": "High Vis",
        "date": "2026-07-31",
        "local_time": "19:00",
        "venue": "Grant Park",
        "city": "Chicago",
        "country_code": "US",
        "source": "ticketmaster",
    }
    second = {
        "id": 202,
        "external_id": "lastfm:xyz",
        "artist_name": "High Vis",
        "date": "2026-07-31",
        "local_time": "19:00",
        "venue": "Grant Park",
        "city": "Chicago",
        "country_code": "US",
        "source": "lastfm",
    }

    assert show_dedupe_key(first) == show_dedupe_key(second)


def test_dedupe_show_rows_merges_semantic_duplicates():
    rows = [
        {
            "id": 101,
            "external_id": "ticketmaster-abc",
            "artist_name": "High Vis",
            "date": "2026-07-31",
            "local_time": "19:00",
            "venue": "Grant Park",
            "city": "Chicago",
            "country_code": "US",
            "source": "ticketmaster",
            "url": "https://tickets.example.test/high-vis",
            "lineup": ["High Vis"],
        },
        {
            "id": 202,
            "external_id": "lastfm:xyz",
            "artist_name": "High Vis",
            "date": "2026-07-31",
            "local_time": "19:00",
            "venue": "Grant Park",
            "city": "Chicago",
            "country_code": "US",
            "source": "lastfm",
            "lastfm_url": "https://last.fm/event/xyz",
            "lastfm_attendance": 4200,
            "lineup": ["High Vis", "Smashing Pumpkins"],
        },
    ]

    deduped = dedupe_show_rows(rows)

    assert len(deduped) == 1
    assert deduped[0]["source"] == "both"
    assert deduped[0]["url"] == "https://tickets.example.test/high-vis"
    assert deduped[0]["lastfm_url"] == "https://last.fm/event/xyz"
    assert deduped[0]["lastfm_attendance"] == 4200
    assert deduped[0]["lineup"] == ["High Vis", "Smashing Pumpkins"]
