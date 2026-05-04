from unittest.mock import patch

from sqlalchemy import text

from crate.db.queries.lyrics import get_album_track_lyrics_status, list_tracks_for_lyrics
from crate.db.repositories.lyrics import get_cached_lyrics, store_lyrics
from crate.db.tx import transaction_scope
from crate.lyrics import sync_lyrics_for_tracks


def test_store_and_get_cached_lyrics(pg_db):
    store_lyrics(
        "Birds In Row",
        "Noah",
        synced_lyrics="[00:01.00]Noah",
        plain_lyrics="Noah",
        source_json={"id": 123},
    )

    cached = get_cached_lyrics(" birds   in row ", "NOAH")

    assert cached is not None
    assert cached["syncedLyrics"] == "[00:01.00]Noah"
    assert cached["plainLyrics"] == "Noah"
    assert cached["found"] is True


def test_api_lyrics_uses_durable_cache(pg_db, test_app):
    store_lyrics("High Vis", "Trauma Bonds", plain_lyrics="Cached words")

    with patch("crate.lyrics.requests.get") as live_fetch:
        response = test_app.get("/api/lyrics?artist=High%20Vis&title=Trauma%20Bonds")

    assert response.status_code == 200
    assert response.json() == {"syncedLyrics": None, "plainLyrics": "Cached words"}
    live_fetch.assert_not_called()


def test_api_lyrics_stores_not_found_miss(pg_db, test_app):
    class NotFoundResponse:
        status_code = 404

    with patch("crate.lyrics.requests.get", return_value=NotFoundResponse()) as live_fetch:
        response = test_app.get("/api/lyrics?artist=Rival%20Schools&title=Missing")

    assert response.status_code == 200
    assert response.json() == {"syncedLyrics": None, "plainLyrics": None}
    live_fetch.assert_called_once()

    cached = get_cached_lyrics("Rival Schools", "Missing")
    assert cached is not None
    assert cached["found"] is False

    with patch("crate.lyrics.requests.get") as second_live_fetch:
        second_response = test_app.get("/api/lyrics?artist=Rival%20Schools&title=Missing")

    assert second_response.status_code == 200
    assert second_response.json() == {"syncedLyrics": None, "plainLyrics": None}
    second_live_fetch.assert_not_called()


def test_sync_lyrics_for_tracks_fetches_and_persists(pg_db):
    class LyricsResponse:
        status_code = 200

        def json(self):
            return {"syncedLyrics": "[00:01.00]Talk", "plainLyrics": "Talk"}

    tracks = [
        {
            "entity_uid": "33333333-3333-4333-8333-333333333333",
            "artist": "High Vis",
            "title": "Talk For Hours",
        }
    ]

    events: list[dict] = []
    with patch("crate.lyrics.requests.get", return_value=LyricsResponse()) as live_fetch:
        result = sync_lyrics_for_tracks(tracks, delay_seconds=0, progress_callback=events.append)

    assert result["found"] == 1
    live_fetch.assert_called_once()
    cached = get_cached_lyrics("High Vis", "Talk For Hours")
    assert cached is not None
    assert cached["plainLyrics"] == "Talk"
    done_event = next(event for event in events if event.get("event") == "track_done")
    assert done_event["status"] == "synced"
    assert done_event["has_plain"] is True
    assert done_event["has_synced"] is True


def test_album_track_lyrics_status_reports_none_txt_and_synced(pg_db, tmp_path):
    album_dir = tmp_path / "High Vis" / "Blending"
    album_dir.mkdir(parents=True)

    with transaction_scope() as session:
        session.execute(text("INSERT INTO library_artists (name, updated_at) VALUES ('High Vis', NOW())"))
        album_id = session.execute(
            text(
                """
                INSERT INTO library_albums (artist, name, path, track_count, updated_at)
                VALUES ('High Vis', 'Blending', :path, 3, NOW())
                RETURNING id
                """
            ),
            {"path": str(album_dir)},
        ).scalar_one()
        track_ids = [
            session.execute(
                text(
                    """
                    INSERT INTO library_tracks (album_id, artist, album, filename, title, path, updated_at)
                    VALUES (:album_id, 'High Vis', 'Blending', :filename, :title, :path, NOW())
                    RETURNING id
                    """
                ),
                {
                    "album_id": album_id,
                    "filename": f"0{index} {title}.flac",
                    "title": title,
                    "path": str(album_dir / f"0{index} {title}.flac"),
                },
            ).scalar_one()
            for index, title in enumerate(["Plain", "Synced", "Missing"], start=1)
        ]

    store_lyrics("High Vis", "Plain", plain_lyrics="Plain lyric", track_id=track_ids[0])
    store_lyrics("High Vis", "Synced", plain_lyrics="Synced lyric", synced_lyrics="[00:01.00]Synced", track_id=track_ids[1])

    status = get_album_track_lyrics_status(album_id)

    assert status[track_ids[0]]["status"] == "txt"
    assert status[track_ids[0]]["has_plain"] is True
    assert status[track_ids[1]]["status"] == "synced"
    assert status[track_ids[1]]["has_synced"] is True
    assert status[track_ids[2]]["status"] == "none"


def test_list_tracks_for_lyrics_can_target_track_and_album_entity(pg_db, tmp_path):
    album_dir = tmp_path / "High Vis" / "Guided Tour"
    album_dir.mkdir(parents=True)
    album_uid = "11111111-2222-4333-8444-555555555555"
    target_uid = "22222222-3333-4444-8555-666666666666"
    other_uid = "33333333-4444-4555-8666-777777777777"

    with transaction_scope() as session:
        session.execute(text("INSERT INTO library_artists (name, updated_at) VALUES ('High Vis', NOW())"))
        album_id = session.execute(
            text(
                """
                INSERT INTO library_albums (artist, name, path, entity_uid, track_count, updated_at)
                VALUES ('High Vis', 'Guided Tour', :path, CAST(:album_uid AS uuid), 2, NOW())
                RETURNING id
                """
            ),
            {"path": str(album_dir), "album_uid": album_uid},
        ).scalar_one()
        target_id = session.execute(
            text(
                """
                INSERT INTO library_tracks (album_id, artist, album, filename, title, path, entity_uid, updated_at)
                VALUES (:album_id, 'High Vis', 'Guided Tour', '01 Drop Me Out.flac', 'Drop Me Out', :path, CAST(:uid AS uuid), NOW())
                RETURNING id
                """
            ),
            {"album_id": album_id, "path": str(album_dir / "01 Drop Me Out.flac"), "uid": target_uid},
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO library_tracks (album_id, artist, album, filename, title, path, entity_uid, updated_at)
                VALUES (:album_id, 'High Vis', 'Guided Tour', :filename, :title, :path, CAST(:uid AS uuid), NOW())
                """
            ),
            {
                "album_id": album_id,
                "filename": "02 Mind's a Lie.flac",
                "title": "Mind's a Lie",
                "path": str(album_dir / "02 Mind's a Lie.flac"),
                "uid": other_uid,
            },
        )

    by_id = list_tracks_for_lyrics(track_id=target_id, limit=10)
    by_uid = list_tracks_for_lyrics(track_entity_uid=target_uid, limit=10)
    by_album_uid = list_tracks_for_lyrics(album_entity_uid=album_uid, limit=10)

    assert [row["id"] for row in by_id] == [target_id]
    assert [str(row["entity_uid"]) for row in by_uid] == [target_uid]
    assert {str(row["entity_uid"]) for row in by_album_uid} == {target_uid, other_uid}


def test_lyrics_track_event_payload_is_rich(monkeypatch):
    from crate.worker_handlers.enrichment import _emit_lyrics_track_event

    emitted: list[tuple[str, str, dict]] = []
    monkeypatch.setattr(
        "crate.worker_handlers.enrichment.emit_task_event",
        lambda task_id, event_type, payload: emitted.append((task_id, event_type, payload)),
    )

    _emit_lyrics_track_event(
        "task-lyrics",
        {
            "event": "track_done",
            "done": 1,
            "total": 2,
            "track_id": 7,
            "track_entity_uid": "track-uid",
            "album_id": 3,
            "artist": "High Vis",
            "album": "Blending",
            "title": "Talk For Hours",
            "status": "txt",
            "found": True,
            "has_plain": True,
            "has_synced": False,
            "provider": "lrclib",
            "updated_at": "2026-05-01T10:00:00+00:00",
        },
    )

    assert emitted[0][0] == "task-lyrics"
    assert emitted[0][1] == "lyrics_track"
    payload = emitted[0][2]
    assert payload["track_id"] == 7
    assert payload["status"] == "txt"
    assert payload["lyrics"]["has_plain"] is True


def test_process_new_content_lyrics_step_runs_post_acquisition_sync(monkeypatch):
    from crate.task_progress import TaskProgress
    from crate.worker_handlers.enrichment import _process_new_content_lyrics

    tracks = [{"id": 7, "artist": "High Vis", "title": "Talk For Hours"}]
    captured: dict = {}

    def fake_sync_lyrics_for_tracks(tracks_arg, **kwargs):
        captured["tracks"] = tracks_arg
        captured["force"] = kwargs["force"]
        return {"tracks": 1, "found": 1, "missing": 0, "skipped": 0, "errors": 0}

    monkeypatch.setattr("crate.worker_handlers.enrichment.get_library_tracks", lambda album_id: tracks)
    monkeypatch.setattr("crate.worker_handlers.enrichment.emit_progress", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.enrichment.emit_task_event", lambda *args, **kwargs: None)
    monkeypatch.setattr("crate.worker_handlers.enrichment.is_cancelled", lambda task_id: False)
    monkeypatch.setattr("crate.lyrics.sync_lyrics_for_tracks", fake_sync_lyrics_for_tracks)

    result = {"steps": {}}
    _process_new_content_lyrics(
        "task-1",
        result,
        [{"id": 42, "name": "Blending"}],
        "High Vis",
        "",
        TaskProgress(phase_count=7),
    )

    assert captured["tracks"] == tracks
    assert captured["force"] is False
    assert result["steps"]["lyrics"]["found"] == 1
