from datetime import date

from sqlalchemy import text

from crate.db.home_builder_upcoming_feed import _build_home_upcoming


def test_get_upcoming_releases_resolves_existing_album_without_artist_id(pg_db):
    from crate.db.queries.user import get_upcoming_releases
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        artist_id = session.execute(
            text(
                """
                INSERT INTO library_artists (name, slug)
                VALUES ('Quicksand', 'quicksand')
                RETURNING id
                """
            )
        ).scalar_one()
        album_id = session.execute(
            text(
                """
                INSERT INTO library_albums (artist, name, path, slug)
                VALUES ('Quicksand', 'Bring On The Psychics', '/music/q/botp', 'bring-on-the-psychics')
                RETURNING id
                """
            )
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO new_releases (
                    artist_name,
                    album_title,
                    status,
                    detected_at,
                    release_date,
                    release_type
                )
                VALUES (
                    'Quicksand',
                    'Bring On The Psychics',
                    'detected',
                    NOW(),
                    '2026-07-17',
                    'Album'
                )
                """
            )
        )

    rows = get_upcoming_releases(
        ["Quicksand"],
        today=date(2026, 5, 18),
        recent_cutoff="2026-04-01T00:00:00+00:00",
        limit=10,
    )

    assert rows[0]["artist_id"] == artist_id
    assert rows[0]["artist_slug"] == "quicksand"
    assert rows[0]["album_id"] == album_id
    assert rows[0]["album_slug"] == "bring-on-the-psychics"


def test_get_upcoming_releases_deduplicates_release_title_variants(pg_db):
    from crate.db.queries.user import get_upcoming_releases
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO library_artists (name, slug)
                VALUES ('HEALTH', 'health')
                """
            )
        )
        session.execute(
            text(
                """
                INSERT INTO library_albums (artist, name, path, slug)
                VALUES ('HEALTH', 'ADDENDUM', '/music/health/addendum', 'addendum')
                RETURNING id
                """
            )
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO new_releases (
                    artist_name,
                    album_title,
                    status,
                    detected_at,
                    release_date,
                    release_type,
                    cover_url
                )
                VALUES (
                    'HEALTH',
                    'ADDENDUM EP',
                    'detected',
                    NOW(),
                    '2026-04-30',
                    'EP',
                    'https://img.example/addendum-ep.jpg'
                )
                """
            )
        )
        session.execute(
            text(
                """
                INSERT INTO new_releases (
                    artist_name,
                    album_title,
                    status,
                    detected_at,
                    release_date,
                    release_type,
                    source_url
                )
                VALUES (
                    'HEALTH',
                    'ADDENDUM',
                    'detected',
                    NOW(),
                    '2026-04-30',
                    'EP',
                    'https://tidal.com/album/123'
                )
                """
            )
        )

    rows = get_upcoming_releases(
        ["HEALTH"],
        today=date(2026, 4, 1),
        recent_cutoff="2026-03-01T00:00:00+00:00",
        limit=10,
    )

    assert len(rows) == 1
    assert rows[0]["album_title"] == "ADDENDUM"
    assert rows[0]["album_slug"] == "addendum"
    assert rows[0]["cover_url"] == "https://img.example/addendum-ep.jpg"
    assert rows[0]["source_url"] == "https://tidal.com/album/123"


def test_get_upcoming_releases_excludes_release_day_rows(pg_db):
    from crate.db.queries.user import get_upcoming_releases
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO library_artists (name, slug)
                VALUES ('Converge', 'converge')
                """
            )
        )
        session.execute(
            text(
                """
                INSERT INTO library_albums (artist, name, path, slug)
                VALUES ('Converge', 'Hum of Hurt', '/music/converge/hum-of-hurt', 'converge-hum-of-hurt')
                """
            )
        )
        session.execute(
            text(
                """
                INSERT INTO new_releases (
                    artist_name,
                    album_title,
                    status,
                    detected_at,
                    release_date,
                    release_type
                )
                VALUES (
                    'Converge',
                    'Hum of Hurt',
                    'detected',
                    '2026-06-05T09:00:00+00:00',
                    '2026-06-05',
                    'Album'
                )
                """
            )
        )

    rows = get_upcoming_releases(
        ["Converge"],
        today=date(2026, 6, 5),
        recent_cutoff="2026-05-01T00:00:00+00:00",
        limit=10,
    )

    assert rows == []


def test_get_upcoming_releases_includes_recently_detected_past_release(pg_db):
    from crate.db.queries.user import get_upcoming_releases
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO new_releases (
                    artist_name,
                    album_title,
                    status,
                    detected_at,
                    release_date,
                    release_type
                )
                VALUES (
                    'Recently Detected Artist',
                    'Recent Album',
                    'detected',
                    '2026-05-20T09:00:00+00:00',
                    '2026-05-10',
                    'Album'
                )
                """
            )
        )

    rows = get_upcoming_releases(
        ["Recently Detected Artist"],
        today=date(2026, 6, 1),
        recent_cutoff="2026-05-01T00:00:00+00:00",
        limit=10,
    )

    assert [row["album_title"] for row in rows] == ["Recent Album"]


def test_home_upcoming_trims_preview_items_but_keeps_full_summary(monkeypatch):
    releases = [
        {
            "id": 1,
            "artist_name": "Converge",
            "artist_id": 7,
            "artist_slug": "converge",
            "album_title": f"Release {index}",
            "release_type": "Album",
            "status": "detected",
            "release_date": f"2026-05-{index + 1:02d}",
            "detected_at": "2026-04-28T10:00:00+00:00",
        }
        for index in range(8)
    ]
    shows = [
        {
            "id": 100 + index,
            "artist_name": "Converge",
            "artist_id": 7,
            "artist_slug": "converge",
            "date": f"2026-06-{index + 1:02d}",
            "local_time": "20:00",
            "venue": f"Venue {index}",
            "city": "Madrid",
            "country": "Spain",
        }
        for index in range(7)
    ]

    monkeypatch.setattr(
        "crate.db.home_builder_upcoming_feed.get_followed_artists",
        lambda user_id: [{"artist_name": "Converge"}],
    )
    monkeypatch.setattr(
        "crate.db.queries.user.get_upcoming_releases", lambda *args, **kwargs: releases
    )
    monkeypatch.setattr(
        "crate.db.queries.user.get_upcoming_shows", lambda *args, **kwargs: shows
    )
    monkeypatch.setattr(
        "crate.db.queries.shows.get_attending_show_ids", lambda user_id, ids: {100, 102}
    )
    monkeypatch.setattr(
        "crate.db.repositories.auth.get_user_by_id",
        lambda user_id: {"latitude": None, "longitude": None, "show_radius_km": 60},
    )
    monkeypatch.setattr(
        "crate.db.home_builder_upcoming_feed._build_upcoming_insights_home",
        lambda user_id, shows, attending_show_ids: [
            {"type": "show_prep", "show_id": 100}
        ],
    )
    monkeypatch.setattr(
        "crate.db.home_builder_upcoming_feed._load_probable_setlists",
        lambda _artist_names: {},
    )

    payload = _build_home_upcoming(1, lookup_limit=120, item_limit=5)

    assert len(payload["items"]) == 5
    assert payload["summary"]["release_count"] == 8
    assert payload["summary"]["show_count"] == 7
    assert payload["summary"]["attending_count"] == 2
    assert payload["summary"]["insight_count"] == 1
    assert payload["insights"][0]["show_id"] == 100
