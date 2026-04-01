"""Contract coverage for Upcoming intelligence surfaces."""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from crate.api.me import _build_upcoming_insights


class TestUpcomingIntelligenceContracts:
    def test_build_upcoming_insights_emits_show_prep_for_attending_hot_artist(self):
        show_date = (datetime.now(timezone.utc) + timedelta(days=6)).strftime("%Y-%m-%d")
        shows = [{
            "id": 42,
            "artist_name": "Converge",
            "venue": "Roadburn",
            "date": show_date,
            "probable_setlist": [{"title": "Concubine"}],
        }]

        with patch("crate.db.get_show_reminders", return_value=[]), patch(
            "crate.db.user_library.get_top_artists",
            return_value=[{"artist_name": "Converge"}],
        ):
            insights = _build_upcoming_insights(1, shows, {42})

        insight_types = {item["type"] for item in insights}
        assert "one_week" in insight_types
        assert "show_prep" in insight_types
        show_prep = next(item for item in insights if item["type"] == "show_prep")
        assert show_prep["weight"] == "high"
        assert show_prep["has_setlist"] is True

    def test_create_show_reminder_endpoint_accepts_supported_types(self, test_app):
        with patch("crate.db.create_show_reminder", return_value=True) as mock_create:
            resp = test_app.post("/api/me/shows/42/reminders", json={"reminder_type": "show_prep"})

        assert resp.status_code == 200
        assert resp.json() == {"ok": True, "added": True}
        mock_create.assert_called_once_with(1, 42, "show_prep")

    def test_create_show_reminder_endpoint_rejects_unknown_types(self, test_app):
        resp = test_app.post("/api/me/shows/42/reminders", json={"reminder_type": "banana"})

        assert resp.status_code == 400
        assert resp.json()["detail"] == "Unsupported reminder type"
