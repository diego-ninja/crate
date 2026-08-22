import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException


def _run(value):
    return asyncio.run(value) if asyncio.iscoroutine(value) else value


def _request_for(role: str | None, user_id: int = 1):
    return SimpleNamespace(
        state=SimpleNamespace(
            user={"id": user_id, "email": "test@cratemusic.app", "role": role}
        )
    )


def test_admin_and_owner_have_all_capabilities():
    from crate.api.permissions import ALL_CAPABILITIES, get_user_capabilities

    assert get_user_capabilities({"role": "admin"}) == set(ALL_CAPABILITIES)
    assert get_user_capabilities({"role": "owner"}) == set(ALL_CAPABILITIES)


def test_roles_are_checked_through_casbin_policy():
    from crate.api.permissions import has_capability

    assert has_capability({"role": "editor"}, "library.metadata.write")
    assert has_capability({"role": "librarian"}, "library.analysis.manage")
    assert not has_capability({"role": "editor"}, "users.manage")
    assert not has_capability({"role": "editor"}, "users.status.manage")
    assert has_capability({"role": "admin"}, "users.manage")
    assert has_capability({"role": "admin"}, "users.delete")
    assert has_capability({"role": "admin"}, "roles.assign")
    assert not has_capability({"role": "user"}, "admin.access")


def test_multi_roles_union_capabilities():
    from crate.api.permissions import get_user_capabilities, has_capability

    user = {"roles": ["librarian", "curator"]}

    assert has_capability(user, "library.analysis.manage")
    assert has_capability(user, "curation.playlists.write")
    assert "library.analysis.manage" in get_user_capabilities(user)
    assert "curation.playlists.write" in get_user_capabilities(user)


def test_federation_import_request_is_librarian_admin_only():
    from crate.api.permissions import has_capability

    assert has_capability({"role": "admin"}, "federation.import.request")
    assert has_capability({"role": "librarian"}, "federation.import.request")
    assert not has_capability({"role": "curator"}, "federation.import.request")
    assert not has_capability({"role": "contributor"}, "federation.import.request")
    assert not has_capability({"role": "user"}, "federation.import.request")


def test_federation_listen_access_is_available_to_regular_users():
    from crate.api.permissions import has_capability

    assert has_capability({"role": "user"}, "federation.catalog.search")
    assert has_capability({"role": "user"}, "federation.stream.play")
    assert not has_capability({"role": "user"}, "federation.import.request")


def test_require_permission_returns_user_for_allowed_role():
    from crate.api.permissions import require_permission

    user = require_permission(
        _request_for("librarian"),
        "library.metadata.write",  # type: ignore[arg-type]
    )

    assert user["role"] == "librarian"


def test_require_permission_rejects_authenticated_user_without_capability():
    from crate.api.permissions import require_permission

    with pytest.raises(HTTPException) as exc:
        require_permission(
            _request_for("user"),
            "library.metadata.write",  # type: ignore[arg-type]
        )

    assert exc.value.status_code == 403


def test_require_permission_rejects_anonymous_user():
    from crate.api.permissions import require_permission

    request = SimpleNamespace(state=SimpleNamespace(user=None))

    with pytest.raises(HTTPException) as exc:
        require_permission(request, "library.metadata.write")  # type: ignore[arg-type]

    assert exc.value.status_code == 401


def test_validate_role_rejects_unknown_role():
    from crate.api.permissions import validate_role

    with pytest.raises(HTTPException) as exc:
        validate_role("viewer")

    assert exc.value.status_code == 422


def test_require_admin_uses_admin_access_capability_for_owner():
    from crate.api.auth import _require_admin

    request = _request_for("owner")

    user = _require_admin(request)  # type: ignore[arg-type]

    assert user["role"] == "owner"


def test_require_admin_does_not_grant_legacy_admin_to_partial_roles():
    from crate.api.auth import _require_admin

    with pytest.raises(HTTPException) as exc:
        _require_admin(_request_for("ops"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_admin_update_user_role_validates_persists_and_audits(monkeypatch):
    from crate.api.auth import admin_update_user_role
    from crate.api.schemas.auth import UpdateUserRoleRequest

    target = {
        "id": 2,
        "email": "editor@test.com",
        "name": "Editor",
        "avatar": None,
        "role": "user",
        "roles": ["user"],
    }
    updated = {**target, "role": "editor", "roles": ["editor"]}
    lookups = [target, updated, updated]
    audit = MagicMock()
    role_updates: list[tuple[int, list[str]]] = []

    monkeypatch.setattr(
        "crate.api.auth.get_user_by_id", lambda _user_id: lookups.pop(0)
    )
    monkeypatch.setattr(
        "crate.api.auth.set_user_roles",
        lambda user_id, roles, **_kwargs: (
            role_updates.append((user_id, list(roles))) or list(roles)
        ),
    )
    monkeypatch.setattr("crate.api.auth.list_user_external_identities", lambda _id: [])
    monkeypatch.setattr("crate.api.auth.list_sessions", lambda *_args, **_kwargs: [])
    monkeypatch.setattr("crate.api.auth.get_user_presence", lambda _id: {})
    monkeypatch.setattr("crate.api.auth.log_audit", audit)

    result = _run(
        admin_update_user_role(
            _request_for("admin", user_id=1),  # type: ignore[arg-type]
            2,
            UpdateUserRoleRequest(role="editor"),
        )
    )

    assert result["role"] == "editor"
    assert result["roles"] == ["editor"]
    assert "library.metadata.write" in result["capabilities"]
    assert role_updates == [(2, ["editor"])]
    audit.assert_called_once()
    assert audit.call_args.args[:3] == ("update_user_role", "user", "editor@test.com")
    assert audit.call_args.kwargs["user_id"] == 1
    assert audit.call_args.kwargs["details"]["before"] == {"roles": ["user"]}
    assert audit.call_args.kwargs["details"]["after"] == {"roles": ["editor"]}


def test_admin_update_user_role_prevents_self_lockout(monkeypatch):
    from crate.api.auth import admin_update_user_role
    from crate.api.schemas.auth import UpdateUserRoleRequest

    monkeypatch.setattr(
        "crate.api.auth.get_user_by_id",
        lambda _id: {
            "id": 1,
            "email": "admin@test.com",
            "name": "Admin",
            "avatar": None,
            "role": "admin",
        },
    )

    with pytest.raises(HTTPException) as exc:
        _run(
            admin_update_user_role(
                _request_for("admin", user_id=1),  # type: ignore[arg-type]
                1,
                UpdateUserRoleRequest(role="user"),
            )
        )

    assert exc.value.status_code == 400


def test_admin_update_user_status_suspends_revokes_and_audits(monkeypatch):
    from crate.api.auth import admin_update_user_status
    from crate.api.schemas.auth import UpdateUserStatusRequest

    target = {
        "id": 2,
        "email": "listener@test.com",
        "name": "Listener",
        "avatar": None,
        "role": "user",
        "status": "active",
    }
    updated = {**target, "status": "suspended", "status_reason": "abuse"}
    lookups = [target, updated]
    audit = MagicMock()
    revoked: list[tuple[int, str | None]] = []

    monkeypatch.setattr(
        "crate.api.auth.get_user_by_id", lambda _user_id: lookups.pop(0)
    )
    monkeypatch.setattr(
        "crate.api.auth.update_user_status",
        lambda _user_id, _status, **_kwargs: updated,
    )
    monkeypatch.setattr(
        "crate.api.auth.list_sessions",
        lambda *_args, **_kwargs: [{"id": "session-1"}, {"id": "session-2"}],
    )
    monkeypatch.setattr(
        "crate.api.auth.revoke_other_sessions",
        lambda user_id, current_session_id: (
            revoked.append((user_id, current_session_id)) or 2
        ),
    )
    monkeypatch.setattr("crate.api.auth._invalidate_auth_session", lambda _id: None)
    monkeypatch.setattr("crate.api.auth._invalidate_auth_user", lambda _id: None)
    monkeypatch.setattr("crate.api.auth.list_user_external_identities", lambda _id: [])
    monkeypatch.setattr("crate.api.auth.get_user_presence", lambda _id: {})
    monkeypatch.setattr("crate.api.auth.log_audit", audit)

    result = _run(
        admin_update_user_status(
            _request_for("admin", user_id=1),  # type: ignore[arg-type]
            2,
            UpdateUserStatusRequest(status="suspended", reason="abuse"),
        )
    )

    assert result["status"] == "suspended"
    assert revoked == [(2, None)]
    audit.assert_called_once()
    assert audit.call_args.args[:3] == (
        "update_user_status",
        "user",
        "listener@test.com",
    )
    assert audit.call_args.kwargs["details"]["before"] == {"status": "active"}
    assert audit.call_args.kwargs["details"]["after"] == {"status": "suspended"}


def test_admin_update_user_status_prevents_self_disable(monkeypatch):
    from crate.api.auth import admin_update_user_status
    from crate.api.schemas.auth import UpdateUserStatusRequest

    monkeypatch.setattr(
        "crate.api.auth.get_user_by_id",
        lambda _id: {
            "id": 1,
            "email": "admin@test.com",
            "name": "Admin",
            "avatar": None,
            "role": "admin",
            "status": "active",
        },
    )

    with pytest.raises(HTTPException) as exc:
        _run(
            admin_update_user_status(
                _request_for("admin", user_id=1),  # type: ignore[arg-type]
                1,
                UpdateUserStatusRequest(status="suspended"),
            )
        )

    assert exc.value.status_code == 400


def test_admin_delete_user_is_soft_delete(monkeypatch):
    from crate.api.auth import admin_delete_user

    target = {
        "id": 2,
        "email": "deleted@test.com",
        "name": "Deleted",
        "avatar": None,
        "role": "user",
        "status": "active",
    }
    status_updates: list[tuple[int, str]] = []

    monkeypatch.setattr("crate.api.auth.get_user_by_id", lambda _user_id: target)
    monkeypatch.setattr("crate.api.auth.list_user_album_contributions", lambda _id: [])
    monkeypatch.setattr("crate.api.auth.create_task", MagicMock())
    monkeypatch.setattr(
        "crate.api.auth.update_user_status",
        lambda user_id, status, **_kwargs: (
            status_updates.append((user_id, status)) or {**target, "status": status}
        ),
    )
    monkeypatch.setattr("crate.api.auth._revoke_user_sessions", lambda *_args: 0)
    monkeypatch.setattr("crate.api.auth._invalidate_auth_user", lambda _id: None)
    monkeypatch.setattr("crate.api.auth.log_audit", MagicMock())

    result = _run(
        admin_delete_user(_request_for("admin", user_id=1), 2)  # type: ignore[arg-type]
    )

    assert result == {"ok": True}
    assert status_updates == [(2, "deleted")]


def test_admin_list_users_rejects_regular_user():
    from crate.api.auth import admin_list_users

    with pytest.raises(HTTPException) as exc:
        admin_list_users(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_admin_create_invite_rejects_user_without_manage_capability():
    from crate.api.auth import admin_create_auth_invite
    from crate.api.schemas.auth import AuthInviteRequest

    with pytest.raises(HTTPException) as exc:
        _run(
            admin_create_auth_invite(  # type: ignore[arg-type]
                _request_for("user"),
                AuthInviteRequest(email="invitee@example.test"),
            )
        )

    assert exc.value.status_code == 403


def test_auth_provider_config_requires_auth_manage():
    from crate.api.auth import admin_get_auth_config

    with pytest.raises(HTTPException) as exc:
        _run(
            admin_get_auth_config(_request_for("ops"))  # type: ignore[arg-type]
        )

    assert exc.value.status_code == 403


def test_settings_requires_settings_manage():
    from crate.api.settings import get_settings

    with pytest.raises(HTTPException) as exc:
        get_settings(_request_for("ops"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_paths_settings_requires_settings_manage():
    from crate.api.settings import update_paths_settings
    from crate.api.schemas.settings import PathsSettingsUpdateRequest

    with pytest.raises(HTTPException) as exc:
        update_paths_settings(  # type: ignore[arg-type]
            _request_for("ops"),
            PathsSettingsUpdateRequest(llm_refinement_enabled=True),
        )

    assert exc.value.status_code == 403


def test_paths_settings_update_persists_toggle(monkeypatch):
    from crate.api.settings import update_paths_settings
    from crate.api.schemas.settings import PathsSettingsUpdateRequest

    writes: dict[str, str] = {}
    monkeypatch.setattr(
        "crate.api.settings.set_setting",
        lambda key, value: writes.__setitem__(key, value),
    )

    result = update_paths_settings(  # type: ignore[arg-type]
        _request_for("admin"),
        PathsSettingsUpdateRequest(llm_refinement_enabled=False),
    )

    assert result == {"ok": True}
    assert writes["paths_llm_refinement_enabled"] == "false"


def test_music_paths_llm_cache_clear_deletes_refinement_prefix(monkeypatch):
    from crate.api.settings import clear_cache
    from crate.api.schemas.settings import CacheClearRequest

    deleted_prefixes: list[str] = []
    monkeypatch.setattr(
        "crate.api.settings.delete_cache_prefix",
        lambda prefix: deleted_prefixes.append(prefix),
    )

    result = clear_cache(  # type: ignore[arg-type]
        _request_for("admin"),
        CacheClearRequest(type="paths_llm"),
    )

    assert result == {"ok": True, "type": "paths_llm"}
    assert deleted_prefixes == ["paths:llm_refinement:"]


def test_admin_update_user_role_requires_roles_manage():
    from crate.api.auth import admin_update_user_role
    from crate.api.schemas.auth import UpdateUserRoleRequest

    with pytest.raises(HTTPException) as exc:
        _run(
            admin_update_user_role(  # type: ignore[arg-type]
                _request_for("editor"),
                2,
                UpdateUserRoleRequest(role="curator"),
            )
        )

    assert exc.value.status_code == 403


def test_tags_api_queues_actor_user_id_for_metadata_edit(tmp_path, monkeypatch):
    from crate.api.schemas.utility import TrackTagsUpdate
    from crate.api.tags import _update_track_tags

    album_dir = tmp_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    track = album_dir / "01 - Song.flac"
    track.write_bytes(b"fake")
    created: list[tuple[str, dict]] = []

    monkeypatch.setattr("crate.api.tags.library_path", lambda: tmp_path)
    monkeypatch.setattr(
        "crate.api.tags.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-1",
    )

    response = _update_track_tags(
        _request_for("editor", user_id=42),  # type: ignore[arg-type]
        "Artist/Album/01 - Song.flac",
        TrackTagsUpdate(title="Song"),
    )

    assert response == {"task_id": "task-1"}
    assert created == [
        (
            "update_track_tags",
            {
                "filepath": "Artist/Album/01 - Song.flac",
                "tags": {"title": "Song"},
                "actor_user_id": 42,
            },
        )
    ]


def test_artist_metadata_api_queues_actor_user_id(monkeypatch):
    from crate.api.schemas.utility import ArtistMetadataUpdate
    from crate.api.tags import _update_artist_metadata

    created: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        "crate.api.tags.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-2",
    )

    response = _update_artist_metadata(
        _request_for("editor", user_id=77),  # type: ignore[arg-type]
        {"id": 12, "entity_uid": "artist-uid", "name": "High Vis"},
        ArtistMetadataUpdate(bio="South London", tags=["post-punk"]),
    )

    assert response == {"task_id": "task-2"}
    assert created == [
        (
            "update_artist_metadata",
            {
                "artist_id": 12,
                "artist_entity_uid": "artist-uid",
                "artist_name": "High Vis",
                "metadata": {"bio": "South London", "tags": ["post-punk"]},
                "actor_user_id": 77,
            },
        )
    ]


def test_track_quarantine_api_queues_actor_user_id(monkeypatch):
    from crate.api.management import quarantine_track_by_id
    from crate.api.schemas.management import TrackQuarantineRequest

    track = {
        "id": 9,
        "entity_uid": "track-uid",
        "path": "/music/Artist/Album/01.flac",
    }
    created: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        "crate.api.management.get_library_track_by_id", lambda _track_id: track
    )
    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-3",
    )

    response = quarantine_track_by_id(
        _request_for("librarian", user_id=88),  # type: ignore[arg-type]
        9,
        TrackQuarantineRequest(reason="duplicate"),
    )

    assert response == {"task_id": "task-3"}
    assert created == [
        (
            "library_track_quarantine",
            {
                "track_id": 9,
                "track_entity_uid": "track-uid",
                "track_path": "/music/Artist/Album/01.flac",
                "reason": "duplicate",
                "actor_user_id": 88,
            },
        )
    ]


def test_track_restore_api_queues_actor_user_id(monkeypatch):
    from crate.api.management import restore_quarantined_track
    from crate.api.schemas.management import TrackRestoreRequest

    created: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-4",
    )

    response = restore_quarantined_track(
        _request_for("librarian", user_id=88),  # type: ignore[arg-type]
        TrackRestoreRequest(
            quarantine_path="Artist/Album/01.flac",
            reason="restore mistake",
        ),
    )

    assert response == {"task_id": "task-4"}
    assert created == [
        (
            "library_track_restore",
            {
                "quarantine_path": "Artist/Album/01.flac",
                "target_path": None,
                "reason": "restore mistake",
                "actor_user_id": 88,
            },
        )
    ]


def test_album_move_to_artist_api_queues_actor_user_id(monkeypatch):
    from crate.api.management import move_album_to_artist_by_id
    from crate.api.schemas.management import AlbumMoveToArtistRequest

    album = {
        "id": 4,
        "entity_uid": "album-uid",
        "path": "/music/Artist/Album",
    }
    target_artist = {
        "id": 22,
        "name": "Target Artist",
        "folder_name": "target-artist-uid",
    }
    created: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        "crate.api.management.get_library_album_by_id", lambda _album_id: album
    )
    monkeypatch.setattr(
        "crate.api.management.get_library_artist_by_id",
        lambda _artist_id: target_artist,
    )
    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-7",
    )

    response = move_album_to_artist_by_id(
        _request_for("librarian", user_id=88),  # type: ignore[arg-type]
        4,
        AlbumMoveToArtistRequest(target_artist_id=22, reason="wrong artist"),
    )

    assert response == {"task_id": "task-7"}
    assert created == [
        (
            "library_album_move_to_artist",
            {
                "album_id": 4,
                "album_entity_uid": "album-uid",
                "album_path": "/music/Artist/Album",
                "target_artist_id": 22,
                "target_artist": "Target Artist",
                "target_artist_folder": "target-artist-uid",
                "reason": "wrong artist",
                "actor_user_id": 88,
            },
        )
    ]


def test_album_merge_api_queues_actor_user_id(monkeypatch):
    from crate.api.management import merge_album_by_id
    from crate.api.schemas.management import AlbumMergeRequest

    source_album = {
        "id": 4,
        "entity_uid": "source-album-uid",
        "path": "/music/Artist/Source Album",
    }
    target_album = {
        "id": 22,
        "entity_uid": "target-album-uid",
        "path": "/music/Artist/Target Album",
    }
    created: list[tuple[str, dict]] = []

    def fake_get_album(album_id: int):
        if album_id == 4:
            return source_album
        if album_id == 22:
            return target_album
        return None

    monkeypatch.setattr("crate.api.management.get_library_album_by_id", fake_get_album)
    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-9",
    )

    response = merge_album_by_id(
        _request_for("librarian", user_id=88),  # type: ignore[arg-type]
        4,
        AlbumMergeRequest(target_album_id=22, reason="duplicate album"),
    )

    assert response == {"task_id": "task-9"}
    assert created == [
        (
            "library_album_merge",
            {
                "source_album_id": 4,
                "source_album_entity_uid": "source-album-uid",
                "source_album_path": "/music/Artist/Source Album",
                "target_album_id": 22,
                "target_album_entity_uid": "target-album-uid",
                "target_album_path": "/music/Artist/Target Album",
                "reason": "duplicate album",
                "actor_user_id": 88,
            },
        )
    ]


def test_album_split_api_queues_actor_user_id(monkeypatch):
    from crate.api.management import split_album_by_id
    from crate.api.schemas.management import AlbumSplitRequest

    album = {
        "id": 4,
        "entity_uid": "album-uid",
        "path": "/music/Artist/Album",
    }
    created: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        "crate.api.management.get_library_album_by_id", lambda _album_id: album
    )
    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-11",
    )

    response = split_album_by_id(
        _request_for("librarian", user_id=88),  # type: ignore[arg-type]
        4,
        AlbumSplitRequest(
            target_album_name="New Album",
            track_ids=[1, 2],
            reason="wrong album",
        ),
    )

    assert response == {"task_id": "task-11"}
    assert created == [
        (
            "library_album_split",
            {
                "album_id": 4,
                "album_entity_uid": "album-uid",
                "album_path": "/music/Artist/Album",
                "target_album_name": "New Album",
                "track_ids": [1, 2],
                "reason": "wrong album",
                "actor_user_id": 88,
            },
        )
    ]


def test_artist_merge_api_queues_actor_user_id(monkeypatch):
    from crate.api.management import merge_artist_by_id
    from crate.api.schemas.management import ArtistMergeRequest

    source_artist = {
        "id": 4,
        "entity_uid": "source-artist-uid",
        "name": "Source Artist",
        "folder_name": "source-artist-uid",
    }
    target_artist = {
        "id": 22,
        "entity_uid": "target-artist-uid",
        "name": "Target Artist",
        "folder_name": "target-artist-uid",
    }
    created: list[tuple[str, dict]] = []

    def fake_get_artist(artist_id: int):
        if artist_id == 4:
            return source_artist
        if artist_id == 22:
            return target_artist
        return None

    monkeypatch.setattr(
        "crate.api.management.get_library_artist_by_id", fake_get_artist
    )
    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-10",
    )

    response = merge_artist_by_id(
        _request_for("librarian", user_id=88),  # type: ignore[arg-type]
        4,
        ArtistMergeRequest(target_artist_id=22, reason="same artist"),
    )

    assert response == {"task_id": "task-10"}
    assert created == [
        (
            "library_artist_merge",
            {
                "source_artist_id": 4,
                "source_artist_entity_uid": "source-artist-uid",
                "source_artist": "Source Artist",
                "source_artist_folder": "source-artist-uid",
                "target_artist_id": 22,
                "target_artist_entity_uid": "target-artist-uid",
                "target_artist": "Target Artist",
                "target_artist_folder": "target-artist-uid",
                "reason": "same artist",
                "actor_user_id": 88,
            },
        )
    ]


def test_track_hard_delete_api_requires_file_delete_and_queues(monkeypatch):
    from crate.api.management import hard_delete_track_by_id
    from crate.api.schemas.management import TrackQuarantineRequest

    track = {
        "id": 9,
        "entity_uid": "track-uid",
        "path": "/music/Artist/Album/01.flac",
    }
    created: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        "crate.api.management.get_library_track_by_id", lambda _track_id: track
    )
    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-5",
    )

    response = hard_delete_track_by_id(
        _request_for("librarian", user_id=88),  # type: ignore[arg-type]
        9,
        TrackQuarantineRequest(reason="bad duplicate"),
    )

    assert response == {"task_id": "task-5"}
    assert created == [
        (
            "library_track_hard_delete",
            {
                "track_id": 9,
                "track_entity_uid": "track-uid",
                "track_path": "/music/Artist/Album/01.flac",
                "reason": "bad duplicate",
                "actor_user_id": 88,
            },
        )
    ]


def test_list_quarantined_tracks_reads_crate_trash(tmp_path, monkeypatch):
    from crate.api.management import list_quarantined_tracks

    quarantined = tmp_path / ".crate-trash" / "tracks" / "Artist" / "Album"
    quarantined.mkdir(parents=True)
    track = quarantined / "01.flac"
    ignored = quarantined / "cover.jpg"
    track.write_bytes(b"fake")
    ignored.write_bytes(b"image")

    monkeypatch.setattr(
        "crate.config.load_config",
        lambda: {"library_path": str(tmp_path)},
    )
    monkeypatch.setattr("crate.api.management._require_track_removal", lambda _req: {})
    monkeypatch.setattr(
        "crate.api.management.read_tags",
        lambda _path: {
            "title": "Concubine",
            "artist": "Converge",
            "album": "Jane Doe",
            "albumartist": "Converge",
            "tracknumber": "1/12",
            "discnumber": "1",
            "date": "2001",
            "genre": "hardcore",
        },
    )
    monkeypatch.setattr(
        "crate.api.management.read_audio_quality",
        lambda _path: {
            "duration": 79.0,
            "bitrate": 912000,
            "sample_rate": 44100,
            "bit_depth": 16,
        },
    )

    response = list_quarantined_tracks(_request_for("librarian"))  # type: ignore[arg-type]

    assert response["count"] == 1
    assert response["items"][0]["quarantine_path"] == "Artist/Album/01.flac"
    assert response["items"][0]["filename"] == "01.flac"
    assert response["items"][0]["title"] == "Concubine"
    assert response["items"][0]["artist"] == "Converge"
    assert response["items"][0]["album"] == "Jane Doe"
    assert response["items"][0]["track_number"] == "1/12"
    assert response["items"][0]["duration"] == 79.0
    assert response["items"][0]["size_bytes"] == 4
    assert response["items"][0]["suggested_target_path"] == "Artist/Album/01.flac"


def test_quarantined_track_hard_delete_api_requires_file_delete(monkeypatch):
    from crate.api.management import hard_delete_quarantined_track
    from crate.api.schemas.management import TrackQuarantineFileRequest

    created: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-6",
    )

    response = hard_delete_quarantined_track(
        _request_for("librarian", user_id=88),  # type: ignore[arg-type]
        TrackQuarantineFileRequest(
            quarantine_path="Artist/Album/01.flac",
            reason="not needed",
        ),
    )

    assert response == {"task_id": "task-6"}
    assert created == [
        (
            "library_quarantined_track_hard_delete",
            {
                "quarantine_path": "Artist/Album/01.flac",
                "reason": "not needed",
                "actor_user_id": 88,
            },
        )
    ]


def test_quarantined_tracks_bulk_hard_delete_api_requires_file_delete(monkeypatch):
    from crate.api.management import hard_delete_all_quarantined_tracks
    from crate.api.schemas.management import TrackQuarantineRequest

    created: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-7",
    )

    response = hard_delete_all_quarantined_tracks(
        _request_for("librarian", user_id=88),  # type: ignore[arg-type]
        TrackQuarantineRequest(reason="empty trash"),
    )

    assert response == {"task_id": "task-7"}
    assert created == [
        (
            "library_quarantined_tracks_hard_delete_all",
            {
                "reason": "empty trash",
                "actor_user_id": 88,
            },
        )
    ]


def test_list_contributions_requires_import_manager(monkeypatch):
    from uuid import UUID

    from crate.api.management import list_contributions
    from crate.api.schemas.management import LibraryContributionListResponse

    monkeypatch.setattr(
        "crate.api.management.list_library_contributions",
        lambda **_kwargs: [
            {
                "id": 1,
                "user_id": 2,
                "user_email": "user@example.test",
                "source": "bandcamp",
                "source_ref": "bandcamp:123",
                "album_id": 44,
                "album_entity_uid": UUID("f05d1701-b2d0-5160-85f8-449053929f12"),
                "artist_name": "Artist",
                "album_name": "Album",
                "status": "active",
                "total_duration": 2423.0490000000004,
            }
        ],
    )
    monkeypatch.setattr(
        "crate.api.management._require_library_import_manager",
        lambda request: request.state.user,
    )

    response = list_contributions(_request_for("librarian"))  # type: ignore[arg-type]

    assert response["count"] == 1
    assert response["items"][0]["source"] == "bandcamp"
    assert response["items"][0]["user_email"] == "user@example.test"
    validated = LibraryContributionListResponse.model_validate(response)
    assert validated.items[0].album_entity_uid == "f05d1701-b2d0-5160-85f8-449053929f12"
    assert validated.items[0].total_duration == 2423


def test_update_track_tags_writes_audit_entry(tmp_path, monkeypatch):
    from crate.worker_handlers.management import _handle_update_track_tags

    track = tmp_path / "Artist" / "Album" / "01 - Song.flac"
    track.parent.mkdir(parents=True)
    track.write_bytes(b"fake")

    class FakeAudio(dict):
        def save(self):
            self.saved = True

    fake_audio = FakeAudio(title=["Old Song"])
    audit = MagicMock()

    monkeypatch.setattr("mutagen.File", lambda *_args, **_kwargs: fake_audio)
    monkeypatch.setattr("crate.worker_handlers.management.log_audit", audit)

    result = _handle_update_track_tags(
        "task-1",
        {
            "filepath": "Artist/Album/01 - Song.flac",
            "tags": {"title": "New Song"},
            "actor_user_id": 42,
        },
        {"library_path": str(tmp_path)},
    )

    assert result == {"status": "ok", "file": "01 - Song.flac"}
    audit.assert_called_once()
    _, _, target_name = audit.call_args.args[:3]
    assert target_name == "Artist/Album/01 - Song.flac"
    assert audit.call_args.kwargs["user_id"] == 42
    assert audit.call_args.kwargs["details"]["before"] == {"title": ["Old Song"]}
    assert audit.call_args.kwargs["details"]["after"] == {"title": ["New Song"]}


def test_update_artist_metadata_writes_audit_and_invalidates(monkeypatch):
    from crate.worker_handlers.management import _handle_update_artist_metadata

    audit = MagicMock()
    invalidations: list[tuple[str, ...]] = []

    monkeypatch.setattr("crate.worker_handlers.management.log_audit", audit)
    monkeypatch.setattr("crate.worker_handlers.management.emit_task_event", MagicMock())
    monkeypatch.setattr(
        "crate.worker_handlers.management.db_update_artist_metadata",
        lambda **_kwargs: {
            "artist_id": 12,
            "artist_entity_uid": "artist-uid",
            "artist_name": "High Vis",
            "before": {"bio": "Old"},
            "after": {"bio": "New"},
            "changed_fields": ["bio"],
        },
    )
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *scopes: invalidations.append(scopes),
    )

    result = _handle_update_artist_metadata(
        "task-2",
        {
            "artist_id": 12,
            "artist_entity_uid": "artist-uid",
            "artist_name": "High Vis",
            "metadata": {"bio": "New"},
            "actor_user_id": 77,
        },
        {},
    )

    assert result == {
        "status": "ok",
        "artist": "High Vis",
        "changed": 1,
        "changed_fields": ["bio"],
    }
    audit.assert_called_once()
    assert audit.call_args.args[:3] == (
        "manual_update_artist_metadata",
        "artist",
        "High Vis",
    )
    assert audit.call_args.kwargs["user_id"] == 77
    assert audit.call_args.kwargs["details"]["before"] == {"bio": "Old"}
    assert audit.call_args.kwargs["details"]["after"] == {"bio": "New"}
    assert invalidations == [("library", "home", "artist:12")]


def test_quarantine_track_moves_file_deletes_db_and_invalidates(tmp_path, monkeypatch):
    from crate.worker_handlers.management import _handle_quarantine_track

    source = tmp_path / "Artist" / "Album" / "01 - Song.flac"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"fake")
    deleted: list[str] = []
    invalidations: list[tuple[str, ...]] = []
    audit = MagicMock()

    monkeypatch.setattr(
        "crate.worker_handlers.management.resolve_library_track_reference",
        lambda **_kwargs: {
            "id": 9,
            "entity_uid": "track-uid",
            "album_id": 4,
            "artist": "Artist",
            "album": "Album",
            "title": "Song",
            "filename": "01 - Song.flac",
            "path": str(source),
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.db_delete_track",
        lambda path: deleted.append(path),
    )
    monkeypatch.setattr("crate.worker_handlers.management.log_audit", audit)
    monkeypatch.setattr("crate.worker_handlers.management.emit_task_event", MagicMock())
    monkeypatch.setattr("crate.worker_handlers.management.start_scan", MagicMock())
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *scopes: invalidations.append(scopes),
    )

    result = _handle_quarantine_track(
        "task-3",
        {"track_id": 9, "reason": "duplicate", "actor_user_id": 88},
        {"library_path": str(tmp_path)},
    )

    expected_destination = (
        tmp_path / ".crate-trash" / "tracks" / "Artist" / "Album" / "01 - Song.flac"
    )
    assert result == {
        "status": "ok",
        "track_id": 9,
        "source_path": str(source),
        "quarantine_path": str(expected_destination),
    }
    assert not source.exists()
    assert expected_destination.read_bytes() == b"fake"
    assert deleted == [str(source)]
    audit.assert_called_once()
    assert audit.call_args.args[:3] == (
        "quarantine_track",
        "track",
        "Artist/Album/Song",
    )
    assert audit.call_args.kwargs["user_id"] == 88
    assert audit.call_args.kwargs["details"]["reason"] == "duplicate"
    assert invalidations == [("library", "home", "album:4")]


def test_restore_track_moves_file_back_and_invalidates(tmp_path, monkeypatch):
    from crate.worker_handlers.management import _handle_restore_track

    quarantined = tmp_path / ".crate-trash" / "tracks" / "Artist" / "Album" / "01.flac"
    quarantined.parent.mkdir(parents=True)
    quarantined.write_bytes(b"fake")
    invalidations: list[tuple[str, ...]] = []
    audit = MagicMock()

    monkeypatch.setattr("crate.worker_handlers.management.log_audit", audit)
    monkeypatch.setattr("crate.worker_handlers.management.emit_task_event", MagicMock())
    monkeypatch.setattr("crate.worker_handlers.management.start_scan", MagicMock())
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *scopes: invalidations.append(scopes),
    )

    result = _handle_restore_track(
        "task-4",
        {
            "quarantine_path": "Artist/Album/01.flac",
            "actor_user_id": 88,
            "reason": "mistake",
        },
        {"library_path": str(tmp_path)},
    )

    restored = tmp_path / "Artist" / "Album" / "01.flac"
    assert result == {
        "status": "ok",
        "quarantine_path": str(quarantined),
        "target_path": str(restored),
    }
    assert restored.read_bytes() == b"fake"
    assert not quarantined.exists()
    audit.assert_called_once()
    assert audit.call_args.args[:3] == (
        "restore_quarantined_track",
        "track",
        "Artist/Album/01.flac",
    )
    assert audit.call_args.kwargs["user_id"] == 88
    assert invalidations == [("library", "home")]


def test_hard_delete_quarantined_track_deletes_crate_trash_file(tmp_path, monkeypatch):
    from crate.worker_handlers.management import _handle_hard_delete_quarantined_track

    quarantined = tmp_path / ".crate-trash" / "tracks" / "Artist" / "Album" / "01.flac"
    quarantined.parent.mkdir(parents=True)
    quarantined.write_bytes(b"fake")
    audit = MagicMock()

    monkeypatch.setattr("crate.worker_handlers.management.log_audit", audit)
    monkeypatch.setattr("crate.worker_handlers.management.emit_task_event", MagicMock())
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *_scopes: None,
    )

    result = _handle_hard_delete_quarantined_track(
        "task-7",
        {
            "quarantine_path": "Artist/Album/01.flac",
            "actor_user_id": 88,
            "reason": "not needed",
        },
        {"library_path": str(tmp_path)},
    )

    assert result == {
        "status": "ok",
        "quarantine_path": str(quarantined),
        "deleted": True,
    }
    assert not quarantined.exists()
    audit.assert_called_once()
    assert audit.call_args.args[:3] == (
        "hard_delete_quarantined_track",
        "track",
        "Artist/Album/01.flac",
    )


def test_hard_delete_all_quarantined_tracks_deletes_audio_only(tmp_path, monkeypatch):
    from crate.worker_handlers.management import (
        _handle_hard_delete_all_quarantined_tracks,
    )

    trash_root = tmp_path / ".crate-trash" / "tracks"
    album_dir = trash_root / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    first = album_dir / "01.flac"
    second = album_dir / "02.m4a"
    cover = album_dir / "cover.jpg"
    outside_target = tmp_path / "outside.flac"
    symlink = album_dir / "03.flac"
    first.write_bytes(b"fake-1")
    second.write_bytes(b"fake-2")
    cover.write_bytes(b"cover")
    outside_target.write_bytes(b"outside")
    symlink.symlink_to(outside_target)
    audit = MagicMock()
    invalidations: list[tuple[str, ...]] = []

    monkeypatch.setattr("crate.worker_handlers.management.log_audit", audit)
    monkeypatch.setattr("crate.worker_handlers.management.emit_task_event", MagicMock())
    monkeypatch.setattr("crate.worker_handlers.management.emit_progress", MagicMock())
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *scopes: invalidations.append(tuple(scopes)),
    )

    result = _handle_hard_delete_all_quarantined_tracks(
        "task-8",
        {"actor_user_id": 88, "reason": "empty trash"},
        {"library_path": str(tmp_path)},
    )

    assert result["status"] == "ok"
    assert result["deleted"] == 2
    assert result["skipped"] == 1
    assert result["errors"] == []
    assert result["bytes_deleted"] == len(b"fake-1") + len(b"fake-2")
    assert not first.exists()
    assert not second.exists()
    assert cover.exists()
    assert outside_target.exists()
    assert symlink.exists()
    audit.assert_called_once()
    assert audit.call_args.args[:3] == (
        "hard_delete_all_quarantined_tracks",
        "track",
        ".crate-trash/tracks",
    )
    assert audit.call_args.kwargs["user_id"] == 88
    assert invalidations == [("library", "home")]


def test_hard_delete_track_deletes_file_and_db(tmp_path, monkeypatch):
    from crate.worker_handlers.management import _handle_hard_delete_track

    source = tmp_path / "Artist" / "Album" / "01.flac"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"fake")
    deleted: list[str] = []
    audit = MagicMock()

    monkeypatch.setattr(
        "crate.worker_handlers.management.resolve_library_track_reference",
        lambda **_kwargs: {
            "id": 9,
            "entity_uid": "track-uid",
            "album_id": 4,
            "artist": "Artist",
            "album": "Album",
            "title": "Song",
            "filename": "01.flac",
            "path": str(source),
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.db_delete_track",
        lambda path: deleted.append(path),
    )
    monkeypatch.setattr("crate.worker_handlers.management.log_audit", audit)
    monkeypatch.setattr("crate.worker_handlers.management.emit_task_event", MagicMock())
    monkeypatch.setattr("crate.worker_handlers.management.start_scan", MagicMock())
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *_scopes: None,
    )

    result = _handle_hard_delete_track(
        "task-5",
        {"track_id": 9, "reason": "bad duplicate", "actor_user_id": 88},
        {"library_path": str(tmp_path)},
    )

    assert result == {
        "status": "ok",
        "track_id": 9,
        "deleted_path": str(source),
    }
    assert not source.exists()
    assert deleted == [str(source)]
    audit.assert_called_once()
    assert audit.call_args.args[:3] == (
        "hard_delete_track",
        "track",
        "Artist/Album/Song",
    )


def test_move_track_moves_file_to_target_album_and_rescans(tmp_path, monkeypatch):
    from crate.worker_handlers.management import _handle_move_track

    source = tmp_path / "Artist" / "Source Album" / "01.flac"
    target_album_dir = tmp_path / "Artist" / "Target Album"
    source.parent.mkdir(parents=True)
    target_album_dir.mkdir(parents=True)
    source.write_bytes(b"fake")
    deleted: list[str] = []

    monkeypatch.setattr(
        "crate.worker_handlers.management.resolve_library_track_reference",
        lambda **_kwargs: {
            "id": 9,
            "entity_uid": "track-uid",
            "album_id": 4,
            "artist": "Artist",
            "album": "Source Album",
            "title": "Song",
            "filename": "01.flac",
            "path": str(source),
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.get_library_album_by_id",
        lambda _album_id: {
            "id": 22,
            "artist": "Artist",
            "name": "Target Album",
            "path": str(target_album_dir),
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.db_delete_track",
        lambda path: deleted.append(path),
    )
    monkeypatch.setattr("crate.worker_handlers.management.log_audit", MagicMock())
    monkeypatch.setattr("crate.worker_handlers.management.emit_task_event", MagicMock())
    monkeypatch.setattr("crate.worker_handlers.management.start_scan", MagicMock())
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *_scopes: None,
    )

    result = _handle_move_track(
        "task-6",
        {"track_id": 9, "target_album_id": 22, "actor_user_id": 88},
        {"library_path": str(tmp_path)},
    )

    destination = target_album_dir / "01.flac"
    assert result == {
        "status": "ok",
        "track_id": 9,
        "source_path": str(source),
        "target_path": str(destination),
    }
    assert destination.read_bytes() == b"fake"
    assert not source.exists()
    assert deleted == [str(source)]


def test_move_album_to_artist_moves_directory_and_updates_db(tmp_path, monkeypatch):
    from crate.worker_handlers.management import _handle_move_album_to_artist

    source_dir = tmp_path / "Source Artist" / "Album"
    target_artist_dir = tmp_path / "target-artist-uid"
    source_dir.mkdir(parents=True)
    (source_dir / "01.flac").write_bytes(b"fake")
    updated: list[tuple[int, str, str, str]] = []
    audit = MagicMock()

    monkeypatch.setattr(
        "crate.worker_handlers.management.get_library_album_by_id",
        lambda _album_id: {
            "id": 4,
            "entity_uid": "album-uid",
            "artist": "Source Artist",
            "name": "Album",
            "path": str(source_dir),
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.get_library_artist_by_id",
        lambda _artist_id: {
            "id": 22,
            "name": "Target Artist",
            "folder_name": "target-artist-uid",
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.get_library_album",
        lambda _artist, _album: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.update_album_artist_and_path",
        lambda album_id, old_path, new_path, artist_name: updated.append(
            (album_id, old_path, new_path, artist_name)
        ),
    )
    monkeypatch.setattr("crate.worker_handlers.management.log_audit", audit)
    monkeypatch.setattr("crate.worker_handlers.management.emit_task_event", MagicMock())
    monkeypatch.setattr("crate.worker_handlers.management.start_scan", MagicMock())
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *_scopes: None,
    )

    result = _handle_move_album_to_artist(
        "task-8",
        {
            "album_id": 4,
            "target_artist_id": 22,
            "actor_user_id": 88,
            "reason": "wrong artist",
        },
        {"library_path": str(tmp_path)},
    )

    destination = target_artist_dir / "Album"
    assert result == {
        "status": "ok",
        "album_id": 4,
        "source_path": str(source_dir),
        "target_path": str(destination),
        "target_artist": "Target Artist",
    }
    assert destination.joinpath("01.flac").read_bytes() == b"fake"
    assert not source_dir.exists()
    assert updated == [(4, str(source_dir), str(destination), "Target Artist")]
    audit.assert_called_once()
    assert audit.call_args.args[:3] == (
        "move_album_to_artist",
        "album",
        "Source Artist/Album",
    )


def test_merge_album_moves_files_reassigns_tracks_and_rescans(tmp_path, monkeypatch):
    from crate.worker_handlers.management import _handle_merge_album

    source_dir = tmp_path / "Artist" / "Duplicate Album"
    target_dir = tmp_path / "Artist" / "Canonical Album"
    source_dir.mkdir(parents=True)
    target_dir.mkdir(parents=True)
    (source_dir / "01.flac").write_bytes(b"source")
    (target_dir / "01.flac").write_bytes(b"target")
    updated: list[tuple[int, int, str, str, list[tuple[str, str]], str, str]] = []
    audit = MagicMock()

    def fake_get_album(album_id: int):
        if album_id == 4:
            return {
                "id": 4,
                "entity_uid": "source-album-uid",
                "artist": "Artist",
                "name": "Duplicate Album",
                "path": str(source_dir),
            }
        if album_id == 22:
            return {
                "id": 22,
                "entity_uid": "target-album-uid",
                "artist": "Artist",
                "name": "Canonical Album",
                "path": str(target_dir),
            }
        return None

    monkeypatch.setattr(
        "crate.worker_handlers.management.get_library_album_by_id", fake_get_album
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.get_library_tracks",
        lambda _album_id: [{"id": 9}],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.merge_album_into_album",
        lambda source_album_id, target_album_id, old_path, new_path, path_map, target_artist, target_album: (
            updated.append(
                (
                    source_album_id,
                    target_album_id,
                    old_path,
                    new_path,
                    path_map,
                    target_artist,
                    target_album,
                )
            )
        ),
    )
    monkeypatch.setattr("crate.worker_handlers.management.log_audit", audit)
    monkeypatch.setattr("crate.worker_handlers.management.emit_task_event", MagicMock())
    monkeypatch.setattr("crate.worker_handlers.management.start_scan", MagicMock())
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *_scopes: None,
    )

    result = _handle_merge_album(
        "task-9",
        {
            "source_album_id": 4,
            "target_album_id": 22,
            "actor_user_id": 88,
            "reason": "duplicate",
        },
        {"library_path": str(tmp_path)},
    )

    moved_file = target_dir / "01.task-9-1.flac"
    assert result == {
        "status": "ok",
        "source_album_id": 4,
        "target_album_id": 22,
        "source_path": str(source_dir),
        "target_path": str(target_dir),
        "moved_paths": 1,
        "source_tracks": 1,
    }
    assert moved_file.read_bytes() == b"source"
    assert (target_dir / "01.flac").read_bytes() == b"target"
    assert not source_dir.exists()
    assert updated == [
        (
            4,
            22,
            str(source_dir),
            str(target_dir),
            [(str(source_dir / "01.flac"), str(moved_file))],
            "Artist",
            "Canonical Album",
        )
    ]
    audit.assert_called_once()
    assert audit.call_args.args[:3] == (
        "merge_album",
        "album",
        "Artist/Duplicate Album",
    )


def test_split_album_moves_selected_tracks_to_new_album(tmp_path, monkeypatch):
    from crate.worker_handlers.management import _handle_split_album

    source_dir = tmp_path / "Artist" / "Source Album"
    source_dir.mkdir(parents=True)
    selected_file = source_dir / "01.flac"
    kept_file = source_dir / "02.flac"
    selected_file.write_bytes(b"selected")
    kept_file.write_bytes(b"kept")
    created: list[tuple[int, dict, str, str, list[tuple[int, str, str]]]] = []
    audit = MagicMock()

    monkeypatch.setattr(
        "crate.worker_handlers.management.get_library_album_by_id",
        lambda _album_id: {
            "id": 4,
            "entity_uid": "album-uid",
            "artist": "Artist",
            "name": "Source Album",
            "path": str(source_dir),
            "formats": ["FLAC"],
            "year": "2026",
            "genre": "rock",
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.get_library_tracks",
        lambda _album_id: [
            {"id": 1, "path": str(selected_file), "filename": "01.flac"},
            {"id": 2, "path": str(kept_file), "filename": "02.flac"},
        ],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.create_split_album_and_move_tracks",
        lambda source_album_id, source_album, target_album_name, target_album_path, track_moves: (
            created.append(
                (
                    source_album_id,
                    source_album,
                    target_album_name,
                    target_album_path,
                    track_moves,
                )
            )
            or 33
        ),
    )
    monkeypatch.setattr("crate.worker_handlers.management.log_audit", audit)
    monkeypatch.setattr("crate.worker_handlers.management.emit_task_event", MagicMock())
    monkeypatch.setattr("crate.worker_handlers.management.start_scan", MagicMock())
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *_scopes: None,
    )

    result = _handle_split_album(
        "task-11",
        {
            "album_id": 4,
            "target_album_name": "New Album",
            "track_ids": [1],
            "actor_user_id": 88,
            "reason": "wrong album",
        },
        {"library_path": str(tmp_path)},
    )

    target_dir = tmp_path / "Artist" / "New Album"
    target_file = target_dir / "01.flac"
    assert result == {
        "status": "ok",
        "source_album_id": 4,
        "target_album_id": 33,
        "target_album": "New Album",
        "source_path": str(source_dir),
        "target_path": str(target_dir),
        "moved_tracks": 1,
    }
    assert target_file.read_bytes() == b"selected"
    assert kept_file.read_bytes() == b"kept"
    assert created[0][0] == 4
    assert created[0][2:] == (
        "New Album",
        str(target_dir),
        [(1, str(selected_file), str(target_file))],
    )
    audit.assert_called_once()
    assert audit.call_args.args[:3] == (
        "split_album",
        "album",
        "Artist/Source Album",
    )


def test_merge_artist_moves_albums_reassigns_db_and_rescans(tmp_path, monkeypatch):
    from crate.worker_handlers.management import _handle_merge_artist

    source_dir = tmp_path / "source-artist-uid"
    target_dir = tmp_path / "target-artist-uid"
    source_album_dir = source_dir / "Alias Album"
    source_album_dir.mkdir(parents=True)
    target_dir.mkdir(parents=True)
    (source_album_dir / "01.flac").write_bytes(b"fake")
    merged: list[tuple[str, str, str, str]] = []
    audit = MagicMock()

    def fake_get_artist(artist_id: int):
        if artist_id == 4:
            return {
                "id": 4,
                "entity_uid": "source-artist-uid",
                "name": "Source Artist",
                "folder_name": "source-artist-uid",
            }
        if artist_id == 22:
            return {
                "id": 22,
                "entity_uid": "target-artist-uid",
                "name": "Target Artist",
                "folder_name": "target-artist-uid",
            }
        return None

    monkeypatch.setattr(
        "crate.worker_handlers.management.get_library_artist_by_id",
        fake_get_artist,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.get_library_albums",
        lambda artist_name: (
            [{"id": 7, "name": "Alias Album", "track_count": 1}]
            if artist_name == "Source Artist"
            else []
        ),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.get_library_album",
        lambda _artist, _album: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.merge_artist_into_artist",
        lambda source_artist, target_artist, old_path, new_path: merged.append(
            (source_artist, target_artist, old_path, new_path)
        ),
    )
    monkeypatch.setattr("crate.worker_handlers.management.log_audit", audit)
    monkeypatch.setattr("crate.worker_handlers.management.emit_task_event", MagicMock())
    monkeypatch.setattr("crate.worker_handlers.management.start_scan", MagicMock())
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *_scopes: None,
    )

    result = _handle_merge_artist(
        "task-10",
        {
            "source_artist_id": 4,
            "target_artist_id": 22,
            "actor_user_id": 88,
            "reason": "alias",
        },
        {"library_path": str(tmp_path)},
    )

    assert result == {
        "status": "ok",
        "source_artist_id": 4,
        "target_artist_id": 22,
        "source_artist": "Source Artist",
        "target_artist": "Target Artist",
        "source_path": str(source_dir),
        "target_path": str(target_dir),
        "moved_items": 1,
        "artist_sidecars_preserved": 0,
        "source_albums": 1,
        "source_tracks": 1,
    }
    assert (target_dir / "Alias Album" / "01.flac").read_bytes() == b"fake"
    assert not source_dir.exists()
    assert merged == [
        ("Source Artist", "Target Artist", str(source_dir), str(target_dir))
    ]
    audit.assert_called_once()
    assert audit.call_args.args[:3] == (
        "merge_artist",
        "artist",
        "Source Artist",
    )


def test_merge_artist_preserves_duplicate_artist_photo_sidecar(tmp_path, monkeypatch):
    from crate.worker_handlers.management import _handle_merge_artist

    source_dir = tmp_path / "source-artist-uid"
    target_dir = tmp_path / "target-artist-uid"
    source_album_dir = source_dir / "Alias Album"
    source_album_dir.mkdir(parents=True)
    target_dir.mkdir(parents=True)
    (source_album_dir / "01.flac").write_bytes(b"fake")
    (source_dir / "artist.jpg").write_bytes(b"source art")
    (target_dir / "artist.jpg").write_bytes(b"target art")

    def fake_get_artist(artist_id: int):
        if artist_id == 4:
            return {
                "id": 4,
                "entity_uid": "source-artist-uid",
                "name": "Source Artist",
                "folder_name": "source-artist-uid",
            }
        if artist_id == 22:
            return {
                "id": 22,
                "entity_uid": "target-artist-uid",
                "name": "Target Artist",
                "folder_name": "target-artist-uid",
            }
        return None

    monkeypatch.setattr(
        "crate.worker_handlers.management.get_library_artist_by_id",
        fake_get_artist,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.get_library_albums",
        lambda artist_name: (
            [{"id": 7, "name": "Alias Album", "track_count": 1}]
            if artist_name == "Source Artist"
            else []
        ),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.get_library_album",
        lambda _artist, _album: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.management.merge_artist_into_artist",
        MagicMock(),
    )
    monkeypatch.setattr("crate.worker_handlers.management.log_audit", MagicMock())
    monkeypatch.setattr("crate.worker_handlers.management.emit_task_event", MagicMock())
    monkeypatch.setattr("crate.worker_handlers.management.start_scan", MagicMock())
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *_scopes: None,
    )

    result = _handle_merge_artist(
        "task-sidecar",
        {"source_artist_id": 4, "target_artist_id": 22},
        {"library_path": str(tmp_path)},
    )

    assert result["status"] == "ok"
    assert result["moved_items"] == 1
    assert result["artist_sidecars_preserved"] == 1
    assert (target_dir / "artist.jpg").read_bytes() == b"target art"
    assert (target_dir / "Alias Album" / "01.flac").read_bytes() == b"fake"
    trashed = list((tmp_path / ".crate-trash" / "artist-sidecars").rglob("artist.jpg"))
    assert len(trashed) == 1
    assert trashed[0].read_bytes() == b"source art"
    assert not source_dir.exists()


def test_system_playlists_allow_playlist_curator(monkeypatch):
    from crate.api.system_playlists import admin_list_system_playlists

    playlist = {
        "id": 23,
        "name": "Curated Mix",
        "description": "Test",
        "scope": "system",
        "generation_mode": "static",
        "is_curated": True,
        "is_active": True,
        "artwork_tracks": [],
        "follower_count": 0,
    }

    monkeypatch.setattr(
        "crate.api.system_playlists.list_system_playlists",
        lambda **_kwargs: [playlist],
    )

    response = admin_list_system_playlists(  # type: ignore[arg-type]
        _request_for("curator"),
    )

    assert response[0]["id"] == 23


def test_system_playlists_reject_metadata_editor():
    from crate.api.system_playlists import admin_list_system_playlists

    with pytest.raises(HTTPException) as exc:
        admin_list_system_playlists(  # type: ignore[arg-type]
            _request_for("editor"),
        )

    assert exc.value.status_code == 403


def test_genre_curator_can_queue_taxonomy_cleanup(monkeypatch):
    from crate.api.genres import cleanup_invalid_taxonomy_nodes

    monkeypatch.setattr("crate.api.genres.list_tasks", lambda **_kwargs: [])
    monkeypatch.setattr(
        "crate.api.genres.create_task",
        lambda task_type, params: f"{task_type}:{params}",
    )

    response = cleanup_invalid_taxonomy_nodes(  # type: ignore[arg-type]
        _request_for("curator")
    )

    assert response == {
        "task_id": "cleanup_invalid_genre_taxonomy:{}",
        "status": "queued",
        "deduplicated": False,
    }


def test_genre_taxonomy_cleanup_rejects_metadata_editor():
    from crate.api.genres import cleanup_invalid_taxonomy_nodes

    with pytest.raises(HTTPException) as exc:
        cleanup_invalid_taxonomy_nodes(  # type: ignore[arg-type]
            _request_for("editor")
        )

    assert exc.value.status_code == 403


def test_sync_shows_allows_show_curator(monkeypatch):
    from crate.api.tasks import api_sync_shows

    monkeypatch.setattr("crate.api.tasks.list_tasks", lambda **_kwargs: [])
    monkeypatch.setattr(
        "crate.api.tasks.create_task",
        lambda task_type: f"task:{task_type}",
    )

    response = api_sync_shows(_request_for("curator"))  # type: ignore[arg-type]

    assert response == {"task_id": "task:sync_shows"}


def test_sync_shows_rejects_metadata_editor():
    from crate.api.tasks import api_sync_shows

    with pytest.raises(HTTPException) as exc:
        api_sync_shows(_request_for("editor"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_new_release_check_allows_release_curator(monkeypatch):
    from crate.api.acquisition import api_check_new_releases

    monkeypatch.setattr(
        "crate.api.acquisition.create_task",
        lambda task_type, params: f"{task_type}:{params}",
    )

    response = api_check_new_releases(  # type: ignore[arg-type]
        _request_for("curator")
    )

    assert response == {"task_id": "check_new_releases:{}"}


def test_new_release_dismiss_requires_release_curator(monkeypatch):
    from crate.api.acquisition import api_dismiss_release

    dismissed: list[int] = []
    monkeypatch.setattr(
        "crate.api.acquisition.mark_release_dismissed",
        lambda release_id: dismissed.append(release_id),
    )

    response = api_dismiss_release(  # type: ignore[arg-type]
        _request_for("curator"),
        77,
    )

    assert response == {"ok": True}
    assert dismissed == [77]

    with pytest.raises(HTTPException) as exc:
        api_dismiss_release(  # type: ignore[arg-type]
            _request_for("user"),
            77,
        )

    assert exc.value.status_code == 403


def test_tidal_refresh_allows_librarian_without_admin_access(monkeypatch):
    from crate.api.tidal import tidal_refresh

    monkeypatch.setattr("crate.api.tidal.tidal.refresh_token", lambda: True)

    response = tidal_refresh(_request_for("librarian"))  # type: ignore[arg-type]

    assert response == {"success": True}


def test_tidal_refresh_rejects_regular_user():
    from crate.api.tidal import tidal_refresh

    with pytest.raises(HTTPException) as exc:
        tidal_refresh(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_acquisition_queue_cleanup_allows_librarian_without_admin_access(
    monkeypatch,
):
    from crate.api.acquisition import clear_completed

    monkeypatch.setattr(
        "crate.api.acquisition.soulseek.clear_completed_downloads",
        lambda: True,
    )

    response = clear_completed(_request_for("librarian"))  # type: ignore[arg-type]

    assert response == {"cleared": True}


def test_acquisition_queue_cleanup_rejects_metadata_editor():
    from crate.api.acquisition import clear_completed

    with pytest.raises(HTTPException) as exc:
        clear_completed(_request_for("editor"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_bandcamp_admin_collection_allows_librarian_without_admin_access(
    monkeypatch,
):
    from crate.api.bandcamp import api_admin_bandcamp_collection

    monkeypatch.setattr(
        "crate.api.bandcamp.list_admin_user_collections",
        lambda _relation_type, limit: [{"id": 1, "limit": limit}],
    )

    response = api_admin_bandcamp_collection(  # type: ignore[arg-type]
        _request_for("librarian"),
        relation_type="collection",
        limit=25,
    )

    assert response.total == 1
    assert response.items[0]["limit"] == 25


def test_bandcamp_admin_collection_rejects_regular_user():
    from crate.api.bandcamp import api_admin_bandcamp_collection

    with pytest.raises(HTTPException) as exc:
        api_admin_bandcamp_collection(  # type: ignore[arg-type]
            _request_for("user"),
            relation_type="collection",
        )

    assert exc.value.status_code == 403


def test_ops_snapshot_allows_ops_role_without_admin_access(monkeypatch):
    from crate.api.admin_ops import api_admin_ops_snapshot

    monkeypatch.setattr(
        "crate.api.admin_ops.get_cached_ops_snapshot",
        lambda fresh=False: {"fresh": fresh, "ok": True},
    )

    response = api_admin_ops_snapshot(  # type: ignore[arg-type]
        _request_for("ops"),
        fresh=True,
    )

    assert response == {"fresh": True, "ok": True}


def test_ops_snapshot_rejects_regular_user():
    from crate.api.admin_ops import api_admin_ops_snapshot

    with pytest.raises(HTTPException) as exc:
        api_admin_ops_snapshot(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_tasks_snapshot_allows_ops_role_without_admin_access(monkeypatch):
    from crate.api.tasks import api_admin_tasks_snapshot

    monkeypatch.setattr(
        "crate.api.tasks.get_cached_tasks_surface",
        lambda limit=100, fresh=False: {"limit": limit, "fresh": fresh},
    )

    response = api_admin_tasks_snapshot(  # type: ignore[arg-type]
        _request_for("ops"),
        fresh=True,
        limit=25,
    )

    assert response == {"limit": 25, "fresh": True}


def test_tasks_snapshot_rejects_metadata_editor():
    from crate.api.tasks import api_admin_tasks_snapshot

    with pytest.raises(HTTPException) as exc:
        api_admin_tasks_snapshot(_request_for("editor"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_backfill_audio_fingerprints_allows_librarian_without_admin_access(
    monkeypatch,
):
    from crate.api.tasks import api_backfill_track_fingerprints

    monkeypatch.setattr("crate.api.tasks.list_tasks", lambda **_kwargs: [])
    monkeypatch.setattr(
        "crate.api.tasks.create_task",
        lambda task_type: f"task:{task_type}",
    )

    response = api_backfill_track_fingerprints(  # type: ignore[arg-type]
        _request_for("librarian")
    )

    assert response == {"task_id": "task:backfill_track_audio_fingerprints"}


def test_backfill_audio_fingerprints_rejects_metadata_editor():
    from crate.api.tasks import api_backfill_track_fingerprints

    with pytest.raises(HTTPException) as exc:
        api_backfill_track_fingerprints(  # type: ignore[arg-type]
            _request_for("editor")
        )

    assert exc.value.status_code == 403


def test_stack_status_allows_runtime_ops_role_without_admin_access(monkeypatch):
    from crate.api.stack import stack_status

    monkeypatch.setattr(
        "crate.api.stack.get_cached_stack_surface",
        lambda fresh=False: {"stack": {"available": True, "fresh": fresh}},
    )

    response = stack_status(_request_for("ops"), fresh=True)  # type: ignore[arg-type]

    assert response == {"available": True, "fresh": True}


def test_stack_status_rejects_metadata_editor():
    from crate.api.stack import stack_status

    with pytest.raises(HTTPException) as exc:
        stack_status(_request_for("editor"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_logs_snapshot_allows_ops_role_without_admin_access(monkeypatch):
    from crate.api.admin_metrics import admin_logs_snapshot

    monkeypatch.setattr(
        "crate.api.admin_metrics.get_cached_logs_surface",
        lambda limit=100, fresh=False: {"limit": limit, "fresh": fresh},
    )

    response = admin_logs_snapshot(  # type: ignore[arg-type]
        _request_for("ops"),
        fresh=True,
        limit=40,
    )

    assert response == {"limit": 40, "fresh": True}


def test_logs_snapshot_rejects_regular_user():
    from crate.api.admin_metrics import admin_logs_snapshot

    with pytest.raises(HTTPException) as exc:
        admin_logs_snapshot(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_llm_status_allows_curator_without_admin_access(monkeypatch):
    from crate.api.admin_metrics import llm_status

    monkeypatch.setattr(
        "crate.llm.get_config",
        lambda: {
            "provider": "gemini",
            "model": "gemini/gemini-2.5-flash",
            "ollama_url": "http://ollama:11434",
        },
    )
    monkeypatch.setattr("crate.llm.get_provider_key_names", lambda _provider: ["KEY"])
    monkeypatch.setattr("crate.llm.get_provider_api_key", lambda _provider: "secret")

    response = llm_status(_request_for("curator"))  # type: ignore[arg-type]

    assert response["available"] is True
    assert response["provider"] == "gemini"


def test_llm_status_rejects_regular_user():
    from crate.api.admin_metrics import llm_status

    with pytest.raises(HTTPException) as exc:
        llm_status(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_users_map_allows_admin_user_view(monkeypatch):
    from crate.api.admin_metrics import users_map

    monkeypatch.setattr(
        "crate.db.repositories.auth.list_users_map_rows",
        lambda: [{"id": 1, "name": "Diego"}],
    )

    response = users_map(_request_for("admin"))  # type: ignore[arg-type]

    assert response == {"users": [{"id": 1, "name": "Diego"}]}


def test_users_map_rejects_regular_user():
    from crate.api.admin_metrics import users_map

    with pytest.raises(HTTPException) as exc:
        users_map(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_admin_user_detail_exposes_derived_activity(monkeypatch):
    from crate.api.auth import admin_get_user_detail

    monkeypatch.setattr(
        "crate.api.auth.get_user_by_id",
        lambda _user_id: {
            "id": 7,
            "email": "inactive@example.com",
            "name": "Inactive",
            "avatar": None,
            "role": "user",
            "status": "active",
            "created_at": datetime.now(timezone.utc) - timedelta(days=60),
            "last_login": datetime.now(timezone.utc) - timedelta(days=31),
            "password_hash": None,
            "username": "inactive",
            "bio": None,
        },
    )
    monkeypatch.setattr("crate.api.auth.list_user_external_identities", lambda _id: [])
    monkeypatch.setattr("crate.api.auth.list_sessions", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        "crate.api.auth.get_user_presence",
        lambda _id: {
            "online_now": False,
            "active_devices": 0,
            "active_sessions": 0,
            "listening_now": False,
            "current_track": None,
            "last_played_at": None,
            "last_seen_at": None,
        },
    )

    response = admin_get_user_detail(_request_for("admin"), 7)  # type: ignore[arg-type]

    assert response["activity_status"] == "inactive"
    assert response["last_activity_at"] is not None


def test_library_health_check_allows_librarian_without_admin_access(monkeypatch):
    from crate.api.management import run_health_check

    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: f"{task_type}:{params['triggered_by']}",
    )

    response = run_health_check(_request_for("librarian"))  # type: ignore[arg-type]

    assert response == {"task_id": "health_check:console"}


def test_library_health_check_rejects_metadata_editor():
    from crate.api.management import run_health_check

    with pytest.raises(HTTPException) as exc:
        run_health_check(_request_for("editor"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_release_type_backfill_queues_metadata_only_enrichment(monkeypatch):
    from crate.api.management import enrich_mbids
    from crate.api.schemas.management import EnrichMbidsRequest

    created: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-1",
    )

    response = enrich_mbids(  # type: ignore[arg-type]
        _request_for("editor"),
        EnrichMbidsRequest(release_types_only=True),
    )

    assert response == {"task_id": "task-1"}
    assert created == [
        ("enrich_mbids", {"release_types_only": True}),
    ]


def test_release_date_backfill_queues_date_only_enrichment(monkeypatch):
    from crate.api.management import enrich_mbids
    from crate.api.schemas.management import EnrichMbidsRequest

    created: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-1",
    )

    response = enrich_mbids(  # type: ignore[arg-type]
        _request_for("editor"),
        EnrichMbidsRequest(release_dates_only=True),
    )

    assert response == {"task_id": "task-1"}
    assert created == [
        ("enrich_mbids", {"release_dates_only": True}),
    ]


def test_full_album_delete_requires_librarian_file_delete_capability(monkeypatch):
    from crate.api.management import delete_album_by_id
    from crate.api.schemas.management import DeleteRequest

    created: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        "crate.api.management.album_names_from_id",
        lambda _album_id: ("Artist", "Album"),
    )
    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-1",
    )

    response = delete_album_by_id(  # type: ignore[arg-type]
        _request_for("librarian"),
        123,
        DeleteRequest(mode="full"),
    )

    assert response == {"task_id": "task-1"}
    assert created == [
        ("delete_album", {"artist": "Artist", "album": "Album", "mode": "full"})
    ]

    with pytest.raises(HTTPException) as exc:
        delete_album_by_id(  # type: ignore[arg-type]
            _request_for("editor"),
            123,
            DeleteRequest(mode="full"),
        )

    assert exc.value.status_code == 403


def test_import_queue_allows_librarian_without_admin_access(monkeypatch):
    from crate.api.imports import api_imports_pending

    monkeypatch.setattr(
        "crate.api.imports.list_import_queue_items",
        lambda status: [{"status": status}],
    )

    response = api_imports_pending(_request_for("librarian"))  # type: ignore[arg-type]

    assert response == [{"status": "pending"}]


def test_import_queue_rejects_regular_user():
    from crate.api.imports import api_imports_pending

    with pytest.raises(HTTPException) as exc:
        api_imports_pending(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_scanner_start_allows_librarian_without_admin_access(monkeypatch):
    from crate.api.scanner import start_scan
    from crate.api.schemas.operations import ScanRequest

    monkeypatch.setattr("crate.api.scanner.list_tasks", lambda **_kwargs: [])
    monkeypatch.setattr(
        "crate.api.scanner.create_task",
        lambda task_type, params: f"{task_type}:{params.get('only')}",
    )

    response = start_scan(  # type: ignore[arg-type]
        _request_for("librarian"),
        ScanRequest(only="High Vis"),
    )

    assert response == {
        "status": "started",
        "task_id": "scan:High Vis",
        "only": "High Vis",
    }


def test_scanner_start_rejects_regular_user():
    from crate.api.scanner import start_scan

    with pytest.raises(HTTPException) as exc:
        start_scan(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_metadata_editor_can_queue_lyrics_sync(monkeypatch):
    from crate.api.management import sync_lyrics
    from crate.api.schemas.management import LyricsSyncRequest

    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: f"{task_type}:{params['artist']}",
    )

    response = sync_lyrics(  # type: ignore[arg-type]
        _request_for("editor"),
        LyricsSyncRequest(artist="High Vis"),
    )

    assert response == {"task_id": "sync_lyrics:High Vis"}


def test_metadata_task_rejects_regular_user():
    from crate.api.management import sync_lyrics
    from crate.api.schemas.management import LyricsSyncRequest

    with pytest.raises(HTTPException) as exc:
        sync_lyrics(  # type: ignore[arg-type]
            _request_for("user"),
            LyricsSyncRequest(artist="High Vis"),
        )

    assert exc.value.status_code == 403


def test_analysis_status_allows_librarian_without_admin_access(monkeypatch):
    from crate.api.management import analysis_status

    monkeypatch.setattr(
        "crate.api.management.get_cached_ops_snapshot",
        lambda: {"analysis": {"total": 1, "analysis_done": 1}},
    )

    response = analysis_status(_request_for("librarian"))  # type: ignore[arg-type]

    assert response == {"total": 1, "analysis_done": 1}


def test_analysis_status_rejects_metadata_editor():
    from crate.api.management import analysis_status

    with pytest.raises(HTTPException) as exc:
        analysis_status(_request_for("editor"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_library_maintenance_remains_admin_only_capability():
    from crate.api.management import rebuild_library

    with pytest.raises(HTTPException) as exc:
        rebuild_library(_request_for("librarian"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_artwork_fetch_allows_metadata_editor_without_admin_access(monkeypatch):
    from crate.api.artwork import api_artwork_fetch
    from crate.api.schemas.artwork import ArtworkFetchRequest

    monkeypatch.setattr(
        "crate.api.artwork.create_task",
        lambda task_type, params: f"{task_type}:{params['mbid']}",
    )

    response = api_artwork_fetch(  # type: ignore[arg-type]
        _request_for("editor"),
        ArtworkFetchRequest(mbid="release-mbid", path="Artist/Album"),
    )

    assert response == {"status": "queued", "task_id": "fetch_cover:release-mbid"}


def test_artwork_fetch_rejects_regular_user():
    from crate.api.artwork import api_artwork_fetch
    from crate.api.schemas.artwork import ArtworkFetchRequest

    with pytest.raises(HTTPException) as exc:
        api_artwork_fetch(  # type: ignore[arg-type]
            _request_for("user"),
            ArtworkFetchRequest(mbid="release-mbid", path="Artist/Album"),
        )

    assert exc.value.status_code == 403


def test_match_candidates_allow_metadata_editor_without_admin_access(
    tmp_path,
    monkeypatch,
):
    from crate.api.matcher import api_match_album

    album_dir = tmp_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    monkeypatch.setattr("crate.api.matcher.library_path", lambda: tmp_path)
    monkeypatch.setattr("crate.api.matcher.extensions", lambda: {".flac"})
    monkeypatch.setattr("crate.api.matcher.find_album_dir", lambda *_args: album_dir)
    monkeypatch.setattr(
        "crate.api.matcher.match_album",
        lambda _album_dir, _exts: [{"title": "Album"}],
    )

    response = api_match_album(  # type: ignore[arg-type]
        _request_for("editor"),
        "Artist",
        "Album",
    )

    assert response == [{"title": "Album"}]


def test_match_candidates_reject_regular_user():
    from crate.api.matcher import api_match_album

    with pytest.raises(HTTPException) as exc:
        api_match_album(  # type: ignore[arg-type]
            _request_for("user"),
            "Artist",
            "Album",
        )

    assert exc.value.status_code == 403


def test_album_enrich_allows_metadata_editor_without_admin_access(monkeypatch):
    from crate.api.browse_album import api_enrich_album

    created: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        "crate.api.browse_album.get_library_album_by_id",
        lambda _album_id: {"artist": "High Vis", "name": "Blending"},
    )
    monkeypatch.setattr(
        "crate.api.browse_album.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-1",
    )

    response = api_enrich_album(_request_for("editor"), 7)  # type: ignore[arg-type]

    assert response == {"task_id": "task-1"}
    assert created == [
        (
            "process_new_content",
            {
                "artist": "High Vis",
                "album": "Blending",
                "force": True,
                "triggered_by": "ui",
            },
        )
    ]


def test_album_enrich_rejects_regular_user():
    from crate.api.browse_album import api_enrich_album

    with pytest.raises(HTTPException) as exc:
        api_enrich_album(_request_for("user"), 7)  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_artist_enrich_allows_metadata_editor_without_admin_access(monkeypatch):
    import importlib

    from crate.api.browse_artist import api_artist_enrich

    queued: list[tuple[str, bool, str]] = []
    content = importlib.import_module("crate.content")
    monkeypatch.setattr(
        content,
        "queue_process_new_content_if_needed",
        lambda name, force, triggered_by: (
            queued.append((name, force, triggered_by)) or "task-artist"
        ),
    )

    response = api_artist_enrich(  # type: ignore[arg-type]
        _request_for("editor"),
        "High Vis",
    )

    assert response == {"status": "queued", "task_id": "task-artist"}
    assert queued == [("High Vis", True, "ui")]


def test_artist_enrich_rejects_regular_user():
    from crate.api.browse_artist import api_artist_enrich

    with pytest.raises(HTTPException) as exc:
        api_artist_enrich(  # type: ignore[arg-type]
            _request_for("user"),
            "High Vis",
        )

    assert exc.value.status_code == 403


def test_organizer_presets_allow_metadata_editor_without_admin_access():
    from crate.api.organizer import api_organize_presets
    from crate.organizer import PRESETS

    response = api_organize_presets(_request_for("editor"))  # type: ignore[arg-type]

    assert response == PRESETS


def test_organizer_presets_reject_regular_user():
    from crate.api.organizer import api_organize_presets

    with pytest.raises(HTTPException) as exc:
        api_organize_presets(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_batch_retag_allows_metadata_editor_without_admin_access(monkeypatch):
    from crate.api.batch import api_batch_retag
    from crate.api.schemas.operations import BatchAlbumItem, BatchRetagRequest

    monkeypatch.setattr(
        "crate.api.batch.create_task",
        lambda task_type, params: f"{task_type}:{len(params['albums'])}",
    )

    response = api_batch_retag(  # type: ignore[arg-type]
        _request_for("editor"),
        BatchRetagRequest(albums=[BatchAlbumItem(artist="High Vis", album="Blending")]),
    )

    assert response == {"status": "queued", "task_id": "batch_retag:1", "count": 1}


def test_batch_retag_rejects_regular_user():
    from crate.api.batch import api_batch_retag
    from crate.api.schemas.operations import BatchRetagRequest

    with pytest.raises(HTTPException) as exc:
        api_batch_retag(  # type: ignore[arg-type]
            _request_for("user"),
            BatchRetagRequest(albums=[]),
        )

    assert exc.value.status_code == 403


def test_playback_delivery_allows_ops_health_without_admin_access(monkeypatch):
    from crate.api.playback_admin import api_admin_playback_delivery

    monkeypatch.setattr(
        "crate.api.playback_admin.get_playback_delivery_snapshot",
        lambda limit=20: {"limit": limit, "items": []},
    )
    monkeypatch.setattr("crate.api.playback_admin.load_config", lambda: {})
    monkeypatch.setattr(
        "crate.api.playback_admin.get_stream_transcode_runtime",
        lambda _config: {"available": True},
    )

    response = api_admin_playback_delivery(  # type: ignore[arg-type]
        _request_for("ops"),
        limit=8,
    )

    assert response == {"limit": 8, "items": [], "runtime": {"available": True}}


def test_playback_delivery_rejects_regular_user():
    from crate.api.playback_admin import api_admin_playback_delivery

    with pytest.raises(HTTPException) as exc:
        api_admin_playback_delivery(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_sync_library_allows_librarian_without_admin_access(monkeypatch):
    from crate.api.tasks import api_sync_library

    monkeypatch.setattr("crate.api.tasks.list_tasks", lambda **_kwargs: [])
    monkeypatch.setattr(
        "crate.api.tasks.create_task",
        lambda task_type: f"task:{task_type}",
    )

    response = api_sync_library(_request_for("librarian"))  # type: ignore[arg-type]

    assert response == {"task_id": "task:library_sync", "status": "started"}


def test_sync_library_rejects_metadata_editor():
    from crate.api.tasks import api_sync_library

    with pytest.raises(HTTPException) as exc:
        api_sync_library(_request_for("editor"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_backfill_similarities_allows_metadata_editor_without_admin_access(
    monkeypatch,
):
    from crate.api.tasks import api_backfill_similarities

    monkeypatch.setattr("crate.api.tasks.list_tasks", lambda **_kwargs: [])
    monkeypatch.setattr(
        "crate.api.tasks.create_task",
        lambda task_type: f"task:{task_type}",
    )

    response = api_backfill_similarities(  # type: ignore[arg-type]
        _request_for("editor")
    )

    assert response == {"task_id": "task:backfill_similarities"}


def test_backfill_similarities_rejects_regular_user():
    from crate.api.tasks import api_backfill_similarities

    with pytest.raises(HTTPException) as exc:
        api_backfill_similarities(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_artist_enrichment_allows_library_viewer_without_admin_access(monkeypatch):
    from crate.api.enrichment import get_artist_enrichment

    monkeypatch.setattr(
        "crate.api.enrichment.get_cache", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr("crate.api.enrichment.get_library_artist", lambda _name: None)
    monkeypatch.setattr(
        "crate.api.enrichment._fetch_enrichment",
        lambda _name: {"lastfm": {"bio": "Bio"}},
    )
    monkeypatch.setattr(
        "crate.api.enrichment.set_cache", lambda *_args, **_kwargs: None
    )

    response = get_artist_enrichment(  # type: ignore[arg-type]
        _request_for("user"),
        "High Vis",
    )

    assert response == {"lastfm": {"bio": "Bio"}}


def test_artist_enrichment_rejects_anonymous_request():
    from crate.api.enrichment import get_artist_enrichment

    request = SimpleNamespace(state=SimpleNamespace(user=None))

    with pytest.raises(HTTPException) as exc:
        get_artist_enrichment(request, "High Vis")  # type: ignore[arg-type]

    assert exc.value.status_code == 401
