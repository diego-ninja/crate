def _vector(value: float) -> list[float]:
    return [value] * 20


def _candidate(track_id: int, *, title: str, artist: str, vector: list[float], bpm: float = 120.0) -> dict:
    return {
        "id": track_id,
        "entity_uid": None,
        "title": title,
        "artist": artist,
        "album": "Album",
        "album_id": 1,
        "bpm": bpm,
        "audio_key": "C",
        "audio_scale": "minor",
        "energy": 0.7,
        "danceability": 0.5,
        "valence": 0.4,
        "duration": 180.0,
        "year": 2020,
        "bliss_vector": vector,
        "distance": 0.1,
    }


def test_discovery_seed_keeps_structured_context(monkeypatch):
    from crate import radio_engine

    rows = [
        {"track_id": index, "artist": f"Artist {index % 2}", "bliss_vector": _vector(float(index))}
        for index in range(5)
    ]

    monkeypatch.setattr(radio_engine, "get_recent_liked_seed_rows", lambda *_args, **_kwargs: rows)

    resolved = radio_engine.resolve_discovery_seed(9)

    assert resolved is not None
    _seed_vec, label, context = resolved
    assert label == "Your recent likes"
    assert context["seed_artists"] == ["Artist 0", "Artist 1"]
    assert context["seed_track_ids"] == [0, 1, 2, 3, 4]


def test_generate_batch_wires_hybrid_scoring_and_retries_disliked_candidates(monkeypatch):
    from crate import radio_engine

    captured = []
    candidates = [
        _candidate(1, title="Too Close", artist="Candidate", vector=_vector(0.0)),
        _candidate(2, title="Good", artist="Candidate", vector=_vector(0.4)),
    ]

    def fake_find_best_candidate(*args, **kwargs):
        captured.append({"args": args, "kwargs": kwargs})
        return candidates[len(captured) - 1] if len(captured) <= len(candidates) else None

    monkeypatch.setattr(radio_engine, "_load_radio_graphs", lambda: ({}, {}, {}))
    monkeypatch.setattr(radio_engine, "_find_best_candidate", fake_find_best_candidate)

    session = {
        "id": "session",
        "current_target": _vector(0.0),
        "seed_vector": _vector(0.5),
        "seed_type": "discovery",
        "seed_label": "Your recent likes",
        "seed_artists": ["Seed Artist"],
        "seed_genres": ["hardcore punk"],
        "used_track_ids": [],
        "used_titles": [],
        "recent_artists": [],
        "recent_tracks": [],
        "disliked_vectors": [_vector(0.0)],
    }

    tracks = radio_engine._generate_batch(session, count=1)

    assert [track["track_id"] for track in tracks] == [2]
    assert len(captured) == 2
    kwargs = captured[0]["kwargs"]
    assert kwargs["artist_affinity"] is radio_engine._artist_affinity
    assert kwargs["genre_overlap"] is radio_engine._genre_overlap
    assert kwargs["candidate_pool_size"] == 60
    assert captured[0]["args"][7] == ["Seed Artist", "__radio_seed_genres__"]
    assert set(session["used_track_ids"]) == {1, 2}
    assert session["current_target"][0] > 0.06


def test_next_tracks_resaves_session_to_refresh_ttl(monkeypatch):
    from crate import radio_engine

    session = {"id": "session", "track_count": 2}
    saved = []

    monkeypatch.setattr(radio_engine, "_load_session", lambda _session_id: session)
    monkeypatch.setattr(radio_engine, "_generate_batch", lambda _session, _count: [{"track_id": 3}])
    monkeypatch.setattr(radio_engine, "_save_session", lambda value: saved.append(dict(value)))

    result = radio_engine.next_tracks("session", count=1)

    assert result == {"session_id": "session", "tracks": [{"track_id": 3}]}
    assert saved
    assert saved[0]["track_count"] == 3


def test_best_candidate_prefers_compatible_audio_context(monkeypatch):
    from crate.db import paths_candidates

    rows = [
        _candidate(1, title="Far", artist="Artist", vector=_vector(0.1), bpm=180.0) | {
            "distance": 0.1,
            "energy": 0.1,
            "audio_key": "F#",
            "year": 1980,
        },
        _candidate(2, title="Close", artist="Artist", vector=_vector(0.1), bpm=122.0) | {
            "distance": 0.1,
            "energy": 0.72,
            "audio_key": "C",
            "year": 2021,
        },
    ]

    monkeypatch.setattr(paths_candidates, "find_candidate_rows", lambda *_args, **_kwargs: rows)

    candidate = paths_candidates._find_best_candidate(
        _vector(0.0),
        exclude_ids=set(),
        exclude_titles=set(),
        recent_artists=[],
        sim_graph={},
        genre_map={},
        member_graph={},
        target_artists=[],
        recent_tracks=[{"bpm": 120.0, "energy": 0.7, "audio_key": "C", "audio_scale": "minor", "year": 2020}],
    )

    assert candidate is not None
    assert candidate["title"] == "Close"


def test_genre_overlap_uses_taxonomy_ancestors():
    from crate.db.paths_similarity import _genre_overlap

    overlap = _genre_overlap(
        "Candidate",
        ["Target"],
        {
            "candidate": {"beatdown hardcore": 1.0},
            "target": {"hardcore punk": 1.0},
        },
    )

    assert overlap > 0.0


def test_home_mix_preparation_deprioritizes_liked_and_overplayed_tracks():
    from crate.db.home_builder_mix_generation import _prepare_mix_candidate_rows

    rows = [
        {"track_id": 1, "title": "Liked", "is_liked": True, "user_play_count": 0},
        {"track_id": 2, "title": "Overplayed", "is_liked": False, "user_play_count": 8},
        {"track_id": 3, "title": "Fresh", "is_liked": False, "user_play_count": 0},
    ]

    prepared = _prepare_mix_candidate_rows(rows)

    assert prepared[0]["title"] == "Fresh"


def test_daily_discovery_uses_cold_start_genres_when_profile_is_empty(monkeypatch):
    from crate.db import home_builder_mix_generation

    captured = {}

    def fake_query(_user_id, *, genres, excluded_artist_names, limit):
        captured["genres"] = genres
        return []

    monkeypatch.setattr(home_builder_mix_generation, "_query_discovery_tracks", fake_query)

    home_builder_mix_generation._build_mix_rows(
        1,
        interest_artists_lower=[],
        top_genres_lower=[],
        mix_id="daily-discovery",
        limit=3,
    )

    assert captured["genres"] == ["rock", "punk", "metal"]


def test_artist_bliss_centroid_refresh_and_resolution(pg_db):
    from sqlalchemy import text

    from crate.db.jobs.artist_bliss_centroids import refresh_artist_bliss_centroids_for_track_ids
    from crate.db.paths_vectors import resolve_bliss_centroid
    from crate.db.queries.artist_bliss_centroids import get_artist_bliss_centroid
    from crate.db.tx import transaction_scope

    pg_db.upsert_artist({"name": "Centroid Artist"})
    artist = pg_db.get_library_artist("Centroid Artist")
    album_id = pg_db.upsert_album({
        "artist": "Centroid Artist",
        "name": "Centroid Album",
        "path": "/music/Centroid Artist/Centroid Album",
    })
    pg_db.upsert_track({
        "album_id": album_id,
        "artist": "Centroid Artist",
        "album": "Centroid Album",
        "filename": "01 - Low.flac",
        "title": "Low",
        "track_number": 1,
        "format": "flac",
        "path": "/music/Centroid Artist/Centroid Album/01 - Low.flac",
    })
    pg_db.upsert_track({
        "album_id": album_id,
        "artist": "Centroid Artist",
        "album": "Centroid Album",
        "filename": "02 - High.flac",
        "title": "High",
        "track_number": 2,
        "format": "flac",
        "path": "/music/Centroid Artist/Centroid Album/02 - High.flac",
    })
    tracks = pg_db.get_library_tracks(album_id)
    vectors = {
        "Low": [0.0] * 20,
        "High": [2.0] * 20,
    }

    with transaction_scope() as session:
        for track in tracks:
            session.execute(
                text(
                    """
                    UPDATE library_tracks
                    SET bliss_vector = CAST(:vector AS DOUBLE PRECISION[])
                    WHERE id = :track_id
                    """
                ),
                {"track_id": track["id"], "vector": vectors[track["title"]]},
            )
        refreshed = refresh_artist_bliss_centroids_for_track_ids(session, [track["id"] for track in tracks])

    assert refreshed == 1
    centroid = get_artist_bliss_centroid(str(artist["id"]))
    assert centroid is not None
    assert centroid["track_count"] == 2
    assert centroid["bliss_vector"] == [1.0] * 20
    assert resolve_bliss_centroid("artist", str(artist["id"])) == [1.0] * 20
