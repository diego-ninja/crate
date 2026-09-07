from datetime import date

from crate.setlistfm import (
    get_upcoming_shows,
    is_shows_sync_enabled,
    normalize_upcoming_show,
    shows_sync_max_artists,
)


def _event(**overrides):
    event = {
        "id": "setlist-123",
        "eventDate": "31-12-2099",
        "artist": {"name": "The Example"},
        "venue": {
            "name": "The Venue",
            "city": {
                "name": "Madrid",
                "state": "Madrid",
                "stateCode": "MD",
                "country": {"name": "Spain", "code": "ES"},
                "coords": {"lat": 40.4168, "long": -3.7038},
            },
        },
        "url": "https://www.setlist.fm/setlist/example/setlist-123.html",
    }
    event.update(overrides)
    return event


def test_normalize_upcoming_show_maps_stable_event_fields():
    result = normalize_upcoming_show(_event(), today=date(2026, 8, 22))

    assert result == {
        "external_id": "setlistfm:setlist-123",
        "artist_name": "The Example",
        "date": "2099-12-31",
        "local_time": None,
        "venue": "The Venue",
        "address_line1": None,
        "city": "Madrid",
        "region": "Madrid",
        "postal_code": None,
        "country": "Spain",
        "country_code": "ES",
        "latitude": 40.4168,
        "longitude": -3.7038,
        "url": "https://www.setlist.fm/setlist/example/setlist-123.html",
        "image_url": None,
        "lineup": ["The Example"],
        "price_range": None,
        "tickets_url": None,
        "status": "scheduled",
        "source": "setlistfm",
    }


def test_normalize_upcoming_show_rejects_past_and_malformed_dates():
    assert (
        normalize_upcoming_show(_event(eventDate="21-08-2026"), today=date(2026, 8, 22))
        is None
    )
    assert (
        normalize_upcoming_show(_event(eventDate="2026-08-23"), today=date(2026, 8, 22))
        is None
    )


def test_normalize_upcoming_show_keeps_today_without_fabricating_time_or_ticketing():
    result = normalize_upcoming_show(
        _event(eventDate="22-08-2026"), today=date(2026, 8, 22)
    )

    assert result is not None
    assert result["date"] == "2026-08-22"
    assert result["local_time"] is None
    assert result["price_range"] is None
    assert result["tickets_url"] is None


def test_normalize_upcoming_show_uses_fallback_artist_name():
    result = normalize_upcoming_show(
        _event(artist=None),
        fallback_artist_name="Fallback Artist",
        today=date(2026, 8, 22),
    )

    assert result is not None
    assert result["artist_name"] == "Fallback Artist"
    assert result["lineup"] == ["Fallback Artist"]


def test_normalize_upcoming_show_requires_id_artist_venue_and_date():
    assert normalize_upcoming_show(_event(id=""), today=date(2026, 8, 22)) is None
    assert (
        normalize_upcoming_show(_event(artist={"name": ""}), today=date(2026, 8, 22))
        is None
    )
    assert (
        normalize_upcoming_show(_event(venue={"name": ""}), today=date(2026, 8, 22))
        is None
    )
    assert (
        normalize_upcoming_show(_event(eventDate=""), today=date(2026, 8, 22)) is None
    )


def test_normalize_upcoming_show_does_not_trust_invalid_coordinates():
    event = _event()
    event["venue"]["city"]["coords"] = {"lat": "not-a-number", "long": None}

    result = normalize_upcoming_show(event, today=date(2026, 8, 22))

    assert result is not None
    assert result["latitude"] is None
    assert result["longitude"] is None


def test_get_upcoming_shows_is_bounded_filters_past_events_and_deduplicates(
    monkeypatch,
):
    calls = []
    duplicate = _event(id="show-a", eventDate="23-08-2026")

    def fake_get_setlists(mbid, page=1, per_page=20):
        calls.append((mbid, page, per_page))
        return {
            "setlist": [
                duplicate,
                _event(id="show-past", eventDate="21-08-2026"),
                {**duplicate, "venue": {"name": "Updated Venue"}},
            ]
        }

    monkeypatch.setattr("crate.setlistfm.get_setlists", fake_get_setlists)

    result = get_upcoming_shows("artist-mbid", limit=10, today=date(2026, 8, 22))

    assert [show["external_id"] for show in result] == ["setlistfm:show-a"]
    assert result[0]["venue"] == "Updated Venue"
    assert calls == [("artist-mbid", 1, 20)]


def test_get_upcoming_shows_does_not_call_provider_without_mbid(monkeypatch):
    called = False

    def fail_get_setlists(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("provider should not be called")

    monkeypatch.setattr("crate.setlistfm.get_setlists", fail_get_setlists)

    assert get_upcoming_shows("", limit=10) == []
    assert called is False


def test_setlist_shows_sync_is_opt_in(monkeypatch):
    monkeypatch.delenv("SETLISTFM_SHOWS_SYNC_ENABLED", raising=False)
    assert is_shows_sync_enabled() is False

    monkeypatch.setenv("SETLISTFM_SHOWS_SYNC_ENABLED", "true")
    assert is_shows_sync_enabled() is True


def test_setlist_shows_sync_artist_limit_is_bounded(monkeypatch):
    monkeypatch.setenv("SETLISTFM_SHOWS_SYNC_MAX_ARTISTS", "5000")
    assert shows_sync_max_artists() == 1000

    monkeypatch.setenv("SETLISTFM_SHOWS_SYNC_MAX_ARTISTS", "invalid")
    assert shows_sync_max_artists() == 100
