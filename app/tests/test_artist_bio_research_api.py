from unittest.mock import MagicMock


def test_artist_bio_research_endpoint_queues_deduplicated_worker_task(monkeypatch):
    from crate.api import artist_research

    artist = {"id": 7, "entity_uid": "artist-uid", "name": "High Vis"}
    monkeypatch.setattr(artist_research, "get_library_artist_by_id", lambda _id: artist)
    monkeypatch.setattr(artist_research, "require_permission", lambda *_args: {})
    queued = {}

    def create_task(task_type, params, *, dedup_key):
        queued.update(task_type=task_type, params=params, dedup_key=dedup_key)
        return "task-1"

    monkeypatch.setattr(artist_research, "create_task_dedup", create_task)

    result = artist_research.research_artist_bio_by_id(
        MagicMock(), 7, artist_research.ArtistBioResearchRequest(language="Spanish")
    )

    assert result == {"task_id": "task-1"}
    assert queued["task_type"] == "research_artist_bio"
    assert queued["params"]["language"] == "Spanish"
    assert queued["dedup_key"] == "artist-bio-research:artist-uid"


def test_artist_bio_research_status_reports_configured_search_providers(monkeypatch):
    from crate.api import artist_research

    monkeypatch.setenv("TAVILY_API_KEY", "tavily-test-key")
    monkeypatch.setenv("BRAVE_SEARCH_API_KEY", "brave-test-key")
    monkeypatch.setattr(artist_research, "require_permission", lambda *_args: {})

    result = artist_research.artist_bio_research_status(MagicMock())

    assert result["web_search_provider"] == "Tavily (primary), Brave (fallback)"
    assert result["web_search_providers"] == ["tavily", "brave"]
