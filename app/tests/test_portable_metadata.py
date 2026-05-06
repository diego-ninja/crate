import json
import shutil
import zipfile
from pathlib import Path
from unittest.mock import MagicMock

from sqlalchemy import text

from crate.db.queries.portable_metadata import get_portable_album_payload
from crate.download_cache import (
    cached_download_artifact_path,
    get_cached_download,
    prune_download_cache,
    register_cached_download,
    store_cached_download,
)
from crate.db.repositories.lyrics import store_lyrics
from crate.db.tx import transaction_scope
from crate.db.repositories.portable_metadata import rehydrate_album_payload
from crate.portable_metadata import (
    export_album_rich_metadata,
    load_album_sidecar,
    write_album_portable_metadata,
    write_track_identity_tags,
    write_track_rich_tags,
)
from crate.media_worker import _album_package_job, _track_artifact_job


def test_write_album_sidecar_includes_lyrics_and_artwork(tmp_path):
    album_dir = tmp_path / "Birds In Row" / "Gris Klein"
    album_dir.mkdir(parents=True)
    (album_dir / "cover.jpg").write_bytes(b"fake")
    payload = {
        "schema_version": 1,
        "artist": {"entity_uid": "artist-uid", "name": "Birds In Row"},
        "album": {
            "id": 7,
            "entity_uid": "album-uid",
            "artist": "Birds In Row",
            "name": "Gris Klein",
            "path": str(album_dir),
        },
        "tracks": [
            {
                "entity_uid": "track-uid",
                "path": str(album_dir / "01 Noah.flac"),
                "title": "Noah",
                "audio_fingerprint": "fp",
                "lyrics": {"provider": "lrclib", "found": True, "synced": "[00:01.00]Noah", "plain": "Noah"},
            }
        ],
    }

    result = write_album_portable_metadata(payload, write_audio_tags=False)

    sidecar_path = Path(result["sidecar_path"])
    data = json.loads(sidecar_path.read_text())
    assert sidecar_path == album_dir / ".crate" / "album.json"
    assert data["schema_version"] == 1
    assert data["album"]["artwork_files"] == ["cover.jpg"]
    assert data["tracks"][0]["lyrics"]["synced"] == "[00:01.00]Noah"
    assert data["tracks"][0]["audio_fingerprint"] == "fp"
    assert data["generated_at"]


def test_write_track_identity_tags_uses_mapping_tags(tmp_path, monkeypatch):
    track_path = tmp_path / "track.flac"
    track_path.write_bytes(b"fake")
    captured: dict[str, str] = {}

    def fake_write_mapping(path: Path, tags: dict[str, str]) -> None:
        assert path == track_path
        captured.update(tags)

    monkeypatch.setattr("crate.portable_metadata._write_mapping_tags", fake_write_mapping)

    result = write_track_identity_tags(
        track_path,
        artist_uid="artist-uid",
        album_uid="album-uid",
        track_uid="track-uid",
        audio_fingerprint="fingerprint",
        audio_fingerprint_source="chromaprint",
    )

    assert result["written"] is True
    assert captured["crate_artist_uid"] == "artist-uid"
    assert captured["crate_album_uid"] == "album-uid"
    assert captured["crate_track_uid"] == "track-uid"
    assert captured["crate_audio_fingerprint"] == "fingerprint"
    assert captured["crate_audio_fingerprint_source"] == "chromaprint"


def test_write_track_rich_tags_embeds_lyrics_and_artwork(tmp_path, monkeypatch):
    track_path = tmp_path / "track.flac"
    artwork_path = tmp_path / "cover.jpg"
    track_path.write_bytes(b"fake")
    artwork_path.write_bytes(b"cover")
    captured: dict[str, object] = {}

    def fake_write_tags(path: Path, tags: dict[str, str]) -> None:
        assert path == track_path
        captured["tags"] = tags

    def fake_embed_artwork(path: Path, artwork: Path) -> bool:
        assert path == track_path
        assert artwork == artwork_path
        captured["artwork"] = artwork
        return True

    monkeypatch.setattr("crate.portable_metadata._write_tags_for_path", fake_write_tags)
    monkeypatch.setattr("crate.portable_metadata._embed_artwork_for_path", fake_embed_artwork)

    result = write_track_rich_tags(
        track_path,
        artist_uid="artist-uid",
        album_uid="album-uid",
        track_payload={
            "entity_uid": "track-uid",
            "audio_fingerprint": "fingerprint",
            "audio_fingerprint_source": "chromaprint",
            "lyrics": {"plain": "Plain words", "synced": "[00:01.00]Plain words"},
            "analysis": {"bpm": 120.0},
            "bliss": {"vector": [0.1, 0.2]},
        },
        artwork_path=artwork_path,
    )

    tags = captured["tags"]
    assert result["written"] is True
    assert result["artwork_embedded"] is True
    assert tags["lyrics"] == "Plain words"
    assert tags["unsyncedlyrics"] == "Plain words"
    assert tags["syncedlyrics"] == "[00:01.00]Plain words"
    assert tags["crate_analysis_json"] == '{"bpm": 120.0}'
    assert tags["crate_bliss_vector"] == "0.1,0.2"
    assert captured["artwork"] == artwork_path


def test_download_cache_reuses_and_prunes_lru_artifacts(tmp_path, monkeypatch):
    cache_dir = tmp_path / "download-cache"
    monkeypatch.setenv("CRATE_DOWNLOAD_CACHE_DIR", str(cache_dir))
    source_a = tmp_path / "a.zip"
    source_b = tmp_path / "b.zip"
    source_a.write_bytes(b"a" * 10)
    source_b.write_bytes(b"b" * 10)

    stored_a = store_cached_download("album", "a" * 64, "A.zip", source_a)
    stored_b = store_cached_download("album", "b" * 64, "B.zip", source_b)

    assert stored_a is not None
    assert stored_b is not None
    assert get_cached_download("album", "a" * 64, "A.zip", ttl_seconds=3600) is not None
    result = prune_download_cache(max_bytes=12)

    assert result["removed"] == 1
    assert get_cached_download("album", "a" * 64, "A.zip", ttl_seconds=3600) is not None
    assert get_cached_download("album", "b" * 64, "B.zip", ttl_seconds=3600) is None


def test_download_cache_registers_worker_written_artifact(tmp_path, monkeypatch):
    cache_dir = tmp_path / "download-cache"
    monkeypatch.setenv("CRATE_DOWNLOAD_CACHE_DIR", str(cache_dir))
    artifact = cached_download_artifact_path("album", "c" * 64, "C.zip")
    artifact.parent.mkdir(parents=True)
    artifact.write_bytes(b"zip")

    cached = register_cached_download("album", "c" * 64, "C.zip", artifact, metadata={"engine": "crate-media-worker"})

    assert cached is not None
    assert cached.path == artifact
    assert get_cached_download("album", "c" * 64, "C.zip", ttl_seconds=3600) is not None


def test_media_worker_album_job_includes_rich_track_payload(tmp_path):
    album_dir = tmp_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    track_path = album_dir / "01 Song.flac"
    artwork_path = album_dir / "cover.jpg"
    track_path.write_bytes(b"fake")
    artwork_path.write_bytes(b"cover")

    job = _album_package_job(
        {
            "artist": {"entity_uid": "artist-uid", "name": "Artist"},
            "album": {"entity_uid": "album-uid", "name": "Album", "path": str(album_dir), "artwork_files": ["cover.jpg"]},
            "tracks": [
                {
                    "entity_uid": "track-uid",
                    "path": str(track_path),
                    "relative_path": "01 Song.flac",
                    "lyrics": {"plain": "Words", "synced": "[00:01.00]Words"},
                    "analysis": {"bpm": 120},
                    "bliss": {"vector": [0.1, 0.2]},
                }
            ],
        },
        output_path=tmp_path / "album.zip",
        filename="Album.zip",
        job_id="job",
        artwork_path=artwork_path,
        write_rich_tags=True,
        cache_kind="album",
        cache_key="cache-key",
        cache_metadata={"engine": "crate-media-worker"},
    )

    assert job["write_rich_tags"] is True
    assert job["cache"]["kind"] == "album"
    assert job["cache"]["key"] == "cache-key"
    assert job["cache"]["metadata"]["engine"] == "crate-media-worker"
    assert job["primary_artwork_path"] == str(artwork_path)
    assert job["tracks"][0]["metadata"]["artist_entity_uid"] == "artist-uid"
    assert job["tracks"][0]["metadata"]["album_entity_uid"] == "album-uid"
    assert job["tracks"][0]["metadata"]["lyrics"]["synced"] == "[00:01.00]Words"
    assert job["artwork_files"][0]["source_path"] == str(artwork_path)


def test_media_worker_track_job_includes_rich_track_payload(tmp_path):
    track_path = tmp_path / "song.flac"
    artwork_path = tmp_path / "cover.jpg"
    track_path.write_bytes(b"fake")
    artwork_path.write_bytes(b"cover")

    job = _track_artifact_job(
        {
            "artist": {"entity_uid": "artist-uid", "name": "Artist"},
            "album": {"entity_uid": "album-uid", "name": "Album"},
            "track": {
                "entity_uid": "track-uid",
                "lyrics": {"plain": "Words"},
                "analysis": {"bpm": 120},
                "bliss": {"vector": [0.1, 0.2]},
            },
        },
        source_path=track_path,
        output_path=tmp_path / "out.flac",
        filename="song.flac",
        job_id="job",
        artwork_path=artwork_path,
        write_rich_tags=True,
        cache_kind="track",
        cache_key="cache-key",
        cache_metadata={"engine": "crate-media-worker"},
    )

    assert job["write_rich_tags"] is True
    assert job["cache"]["kind"] == "track"
    assert job["cache"]["key"] == "cache-key"
    assert job["source_path"] == str(track_path)
    assert job["metadata"]["artist_entity_uid"] == "artist-uid"
    assert job["metadata"]["album_entity_uid"] == "album-uid"
    assert job["artwork_path"] == str(artwork_path)


def test_portable_album_payload_contains_cached_lyrics_analysis_and_bliss(pg_db, tmp_path):
    artist_uid = "11111111-1111-4111-8111-111111111111"
    album_uid = "22222222-2222-4222-8222-222222222222"
    track_uid = "33333333-3333-4333-8333-333333333333"
    album_dir = tmp_path / "High Vis" / "Blending"
    track_path = album_dir / "01 Talk For Hours.flac"
    album_dir.mkdir(parents=True)
    track_path.write_bytes(b"fake")

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO library_artists (name, entity_uid, updated_at)
                VALUES ('High Vis', CAST(:artist_uid AS uuid), NOW())
                """
            ),
            {"artist_uid": artist_uid},
        )
        album_id = session.execute(
            text(
                """
                INSERT INTO library_albums (artist, name, path, entity_uid, updated_at)
                VALUES ('High Vis', 'Blending', :path, CAST(:album_uid AS uuid), NOW())
                RETURNING id
                """
            ),
            {"path": str(album_dir), "album_uid": album_uid},
        ).scalar_one()
        track_id = session.execute(
            text(
                """
                INSERT INTO library_tracks (
                    album_id, artist, album, filename, title, path, entity_uid,
                    audio_fingerprint, audio_fingerprint_source, bliss_vector, bliss_computed_at, updated_at
                )
                VALUES (
                    :album_id, 'High Vis', 'Blending', '01 Talk For Hours.flac', 'Talk For Hours',
                    :track_path, CAST(:track_uid AS uuid), 'fp-1', 'chromaprint',
                    CAST(:bliss_vector AS double precision[]), NOW(), NOW()
                )
                RETURNING id
                """
            ),
            {
                "album_id": album_id,
                "track_path": str(track_path),
                "track_uid": track_uid,
                "bliss_vector": [0.1] * 20,
            },
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO track_analysis_features (track_id, bpm, audio_key, energy, updated_at)
                VALUES (:track_id, 132.0, 'C', 0.91, NOW())
                """
            ),
            {"track_id": track_id},
        )

    store_lyrics(
        "High Vis",
        "Talk For Hours",
        plain_lyrics="Cached lyric",
        track_id=track_id,
        track_entity_uid=track_uid,
    )

    payload = get_portable_album_payload(album_id)

    assert payload is not None
    track = payload["tracks"][0]
    assert str(payload["artist"]["entity_uid"]) == artist_uid
    assert str(payload["album"]["entity_uid"]) == album_uid
    assert str(track["entity_uid"]) == track_uid
    assert track["lyrics"]["plain"] == "Cached lyric"
    assert track["analysis"]["bpm"] == 132.0
    assert track["analysis"]["audio_key"] == "C"
    assert track["bliss"]["vector"] == [0.1] * 20
    assert track["audio_fingerprint"] == "fp-1"


def test_rehydrate_album_payload_restores_catalog_features_and_lyrics(pg_db, tmp_path):
    album_dir = tmp_path / "Rival Schools" / "United By Fate"
    album_dir.mkdir(parents=True)
    track_path = album_dir / "01 Travel By Telephone.flac"
    track_path.write_bytes(b"fake")
    sidecar_payload = {
        "schema_version": 1,
        "artist": {
            "name": "Rival Schools",
            "entity_uid": "11111111-2222-4333-8444-555555555555",
            "folder_name": "Rival Schools",
        },
        "album": {
            "entity_uid": "22222222-3333-4444-8555-666666666666",
            "artist": "Rival Schools",
            "name": "United By Fate",
            "path": str(album_dir),
            "track_count": 1,
        },
        "tracks": [
            {
                "entity_uid": "33333333-4444-4555-8666-777777777777",
                "path": str(track_path),
                "relative_path": "01 Travel By Telephone.flac",
                "filename": "01 Travel By Telephone.flac",
                "title": "Travel By Telephone",
                "artist": "Rival Schools",
                "album": "United By Fate",
                "audio_fingerprint": "fp-rival",
                "audio_fingerprint_source": "chromaprint-v1",
                "analysis": {"bpm": 120.0, "audio_key": "G", "energy": 0.8, "updated_at": None},
                "bliss": {"vector": [0.2] * 20, "computed_at": None},
                "lyrics": {"provider": "lrclib", "found": True, "plain": "Travel", "synced": None},
            }
        ],
    }
    sidecar = album_dir / ".crate" / "album.json"
    sidecar.parent.mkdir()
    sidecar.write_text(json.dumps(sidecar_payload), encoding="utf-8")

    result = rehydrate_album_payload(load_album_sidecar(sidecar))

    assert result["tracks"] == 1
    with transaction_scope() as session:
        row = session.execute(
            text(
                """
                SELECT lt.title, lt.audio_fingerprint, taf.bpm, tbe.bliss_vector
                FROM library_tracks lt
                LEFT JOIN track_analysis_features taf ON taf.track_id = lt.id
                LEFT JOIN track_bliss_embeddings tbe ON tbe.track_id = lt.id
                WHERE lt.path = :path
                """
            ),
            {"path": str(track_path)},
        ).mappings().first()
        lyrics = session.execute(text("SELECT plain_lyrics FROM track_lyrics LIMIT 1")).scalar_one()

    assert row["title"] == "Travel By Telephone"
    assert row["audio_fingerprint"] == "fp-rival"
    assert row["bpm"] == 120.0
    assert row["bliss_vector"] == [0.2] * 20
    assert lyrics == "Travel"


def test_export_album_rich_metadata_copies_audio_and_writes_sidecar(tmp_path, monkeypatch):
    source_dir = tmp_path / "source" / "High Vis" / "Blending"
    source_dir.mkdir(parents=True)
    source_track = source_dir / "01 Talk For Hours.flac"
    source_track.write_bytes(b"fake")
    (source_dir / "cover.jpg").write_bytes(b"cover")
    captured: list[dict] = []

    def fake_rich_tags(path: Path, **kwargs):
        captured.append({"path": path, **kwargs})
        return {"written": True, "path": str(path), "tags": ["crate_plain_lyrics"]}

    monkeypatch.setattr("crate.portable_metadata.write_track_rich_tags", fake_rich_tags)
    payload = {
        "schema_version": 1,
        "artist": {"entity_uid": "artist-uid", "name": "High Vis"},
        "album": {
            "id": 9,
            "entity_uid": "album-uid",
            "artist": "High Vis",
            "name": "Blending",
            "path": str(source_dir),
        },
        "tracks": [
            {
                "entity_uid": "track-uid",
                "path": str(source_track),
                "relative_path": "01 Talk For Hours.flac",
                "filename": "01 Talk For Hours.flac",
                "title": "Talk For Hours",
                "lyrics": {"provider": "lrclib", "found": True, "plain": "Talk"},
            }
        ],
    }

    result = export_album_rich_metadata(payload, export_root=tmp_path / "exports")

    export_dir = Path(result["export_path"])
    assert result["tracks"] == 1
    assert (export_dir / "01 Talk For Hours.flac").is_file()
    assert (export_dir / "cover.jpg").is_file()
    assert captured[0]["path"] == export_dir / "01 Talk For Hours.flac"
    assert captured[0]["artwork_path"] == source_dir / "cover.jpg"
    sidecar_data = json.loads(Path(result["sidecar_path"]).read_text())
    assert sidecar_data["tracks"][0]["lyrics"]["plain"] == "Talk"


def test_album_download_uses_rich_export_package(pg_db, tmp_path, monkeypatch):
    from crate.api import browse_album

    artist_uid = "11111111-aaaa-4aaa-8aaa-111111111111"
    album_uid = "22222222-bbbb-4bbb-8bbb-222222222222"
    track_uid = "33333333-cccc-4ccc-8ccc-333333333333"
    album_dir = tmp_path / "High Vis" / "Blending"
    track_path = album_dir / "01 Talk For Hours.flac"
    album_dir.mkdir(parents=True)
    track_path.write_bytes(b"fake-audio")
    (album_dir / "cover.jpg").write_bytes(b"cover")

    with transaction_scope() as session:
        session.execute(
            text("INSERT INTO library_artists (name, entity_uid, updated_at) VALUES ('High Vis', CAST(:uid AS uuid), NOW())"),
            {"uid": artist_uid},
        )
        album_id = session.execute(
            text(
                """
                INSERT INTO library_albums (artist, name, path, entity_uid, track_count, updated_at)
                VALUES ('High Vis', 'Blending', :path, CAST(:uid AS uuid), 1, NOW())
                RETURNING id
                """
            ),
            {"path": str(album_dir), "uid": album_uid},
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO library_tracks (album_id, artist, album, filename, title, path, entity_uid, updated_at)
                VALUES (:album_id, 'High Vis', 'Blending', '01 Talk For Hours.flac', 'Talk For Hours', :path, CAST(:uid AS uuid), NOW())
                """
            ),
            {"album_id": album_id, "path": str(track_path), "uid": track_uid},
        )

    captured: list[dict] = []
    cache_dir = tmp_path / "download-cache"
    monkeypatch.setenv("CRATE_DOWNLOAD_CACHE_DIR", str(cache_dir))
    monkeypatch.setattr("crate.api.browse_album._require_auth", lambda request: {"id": 1})
    monkeypatch.setattr("crate.api.browse_album.library_path", lambda: tmp_path)
    monkeypatch.setattr("crate.api.browse_album.extensions", lambda: {".flac"})
    monkeypatch.setattr("crate.api.browse_album.find_album_dir", lambda *args, **kwargs: album_dir)
    monkeypatch.setattr("crate.api.browse_album.find_album_row", lambda *args, **kwargs: {"id": album_id})
    monkeypatch.setattr(
        "crate.portable_metadata.write_track_rich_tags",
        lambda path, **kwargs: captured.append({"path": Path(path), **kwargs}) or {"written": True},
    )

    response = browse_album.api_download_album(MagicMock(), "High Vis", "Blending")
    zip_path = Path(response.path)
    try:
        with zipfile.ZipFile(zip_path) as archive:
            names = set(archive.namelist())
            assert "01 Talk For Hours.flac" in names
            assert "cover.jpg" in names
            assert ".crate/album.json" in names
            sidecar = json.loads(archive.read(".crate/album.json"))
        assert sidecar["tracks"][0]["entity_uid"] == track_uid
        assert captured[0]["path"].name == "01 Talk For Hours.flac"
        assert captured[0]["artwork_path"] == album_dir / "cover.jpg"
        second_response = browse_album.api_download_album(MagicMock(), "High Vis", "Blending")
        assert Path(second_response.path) == zip_path
        assert len(captured) == 1
    finally:
        shutil.rmtree(cache_dir, ignore_errors=True)


def test_track_download_returns_enriched_temp_copy(pg_db, tmp_path, monkeypatch):
    from crate.api import browse_media

    artist_uid = "11111111-dddd-4ddd-8ddd-111111111111"
    album_uid = "22222222-eeee-4eee-8eee-222222222222"
    track_uid = "33333333-ffff-4fff-8fff-333333333333"
    library_dir = tmp_path / "library"
    album_dir = library_dir / "High Vis" / "Blending"
    track_path = album_dir / "01 Talk For Hours.flac"
    album_dir.mkdir(parents=True)
    track_path.write_bytes(b"fake-audio")

    with transaction_scope() as session:
        session.execute(
            text("INSERT INTO library_artists (name, entity_uid, updated_at) VALUES ('High Vis', CAST(:uid AS uuid), NOW())"),
            {"uid": artist_uid},
        )
        album_id = session.execute(
            text(
                """
                INSERT INTO library_albums (artist, name, path, entity_uid, track_count, updated_at)
                VALUES ('High Vis', 'Blending', :path, CAST(:uid AS uuid), 1, NOW())
                RETURNING id
                """
            ),
            {"path": str(album_dir), "uid": album_uid},
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO library_tracks (album_id, artist, album, filename, title, path, entity_uid, updated_at)
                VALUES (:album_id, 'High Vis', 'Blending', '01 Talk For Hours.flac', 'Talk For Hours', :path, CAST(:uid AS uuid), NOW())
                """
            ),
            {"album_id": album_id, "path": str(track_path), "uid": track_uid},
        )

    (album_dir / "cover.jpg").write_bytes(b"cover")
    captured: list[dict] = []
    cache_dir = tmp_path / "download-cache"
    monkeypatch.setenv("CRATE_DOWNLOAD_CACHE_DIR", str(cache_dir))
    monkeypatch.setattr("crate.api.browse_media._require_auth", lambda request: {"id": 1})
    monkeypatch.setattr("crate.api.browse_media.library_path", lambda: library_dir)
    monkeypatch.setattr(
        "crate.portable_metadata.write_track_rich_tags",
        lambda path, **kwargs: captured.append({"path": Path(path), **kwargs}) or {"written": True},
    )

    response = browse_media._download_track(MagicMock(), "High Vis/Blending/01 Talk For Hours.flac")
    download_path = Path(response.path)
    try:
        assert download_path != track_path
        assert download_path.read_bytes() == b"fake-audio"
        assert captured[0]["path"].name == download_path.name
        assert captured[0]["artwork_path"] == album_dir / "cover.jpg"
        second_response = browse_media._download_track(MagicMock(), "High Vis/Blending/01 Talk For Hours.flac")
        assert Path(second_response.path) == download_path
        assert len(captured) == 1
    finally:
        shutil.rmtree(cache_dir, ignore_errors=True)
