"""Contract checks for the generated OpenAPI schema."""


def test_openapi_exposes_security_schemes(test_app):
    resp = test_app.get("/openapi.json")

    assert resp.status_code == 200
    data = resp.json()
    assert data["servers"][0]["url"]  # URL varies by environment
    assert data["x-tagGroups"]
    security_schemes = data["components"]["securitySchemes"]

    assert security_schemes["bearerAuth"]["type"] == "http"
    assert security_schemes["bearerAuth"]["scheme"] == "bearer"
    assert security_schemes["cookieAuth"]["type"] == "apiKey"
    assert security_schemes["cookieAuth"]["in"] == "cookie"
    assert security_schemes["cookieAuth"]["name"] == "crate_session"
    assert security_schemes["queryTokenAuth"]["type"] == "apiKey"
    assert security_schemes["queryTokenAuth"]["in"] == "query"


def test_openapi_variants_split_crate_rest_and_subsonic(test_app):
    crate_schema = test_app.get("/openapi-crate.json").json()
    app_schema = test_app.get("/openapi-app.json").json()
    ops_schema = test_app.get("/openapi-collection-ops.json").json()
    admin_schema = test_app.get("/openapi-admin-system.json").json()
    subsonic_schema = test_app.get("/openapi-subsonic.json").json()

    assert crate_schema["info"]["title"] == "Crate API"
    assert "subsonic" not in {tag["name"] for tag in crate_schema["tags"]}
    assert all(not path.startswith("/rest") for path in crate_schema["paths"])

    assert app_schema["info"]["title"] == "Crate App & Listening API"
    assert "browse" in {tag["name"] for tag in app_schema["tags"]}
    assert "management" not in {tag["name"] for tag in app_schema["tags"]}

    assert ops_schema["info"]["title"] == "Crate Collection Operations API"
    assert "tidal" in {tag["name"] for tag in ops_schema["tags"]}
    assert "auth" not in {tag["name"] for tag in ops_schema["tags"]}

    assert admin_schema["info"]["title"] == "Crate Admin & System API"
    assert "management" in {tag["name"] for tag in admin_schema["tags"]}
    assert "browse" not in {tag["name"] for tag in admin_schema["tags"]}

    assert subsonic_schema["info"]["title"] == "Crate Subsonic Compatibility API"
    assert {tag["name"] for tag in subsonic_schema["tags"]} == {"subsonic"}
    assert subsonic_schema["x-tagGroups"][0]["tags"] == ["subsonic"]
    assert all(path.startswith("/rest") for path in subsonic_schema["paths"])


def test_openapi_marks_radio_routes_as_authenticated_and_typed(test_app):
    data = test_app.get("/openapi.json").json()
    operation = data["paths"]["/api/radio/track"]["get"]

    assert operation["tags"] == ["radio"]
    assert operation["summary"] == "Build track radio"
    assert {parameter["name"] for parameter in operation["parameters"]} == {"track_id", "entity_uid", "path", "limit"}
    assert operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/RadioResponse")
    assert operation["responses"]["404"]["content"]["application/json"]["schema"]["$ref"].endswith("/ApiErrorResponse")


def test_openapi_marks_genre_routes_as_authenticated_and_typed(test_app):
    data = test_app.get("/openapi.json").json()
    detail_operation = data["paths"]["/api/genres/{slug}"]["get"]
    eq_operation = data["paths"]["/api/genres/{slug}/eq-preset"]["patch"]
    invalid_operation = data["paths"]["/api/genres/taxonomy/invalid"]["get"]
    cleanup_operation = data["paths"]["/api/genres/taxonomy/cleanup-invalid"]["post"]

    assert detail_operation["tags"] == ["genres"]
    assert detail_operation["summary"] == "Get detailed genre information"
    assert detail_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert detail_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/GenreDetailResponse")
    assert detail_operation["responses"]["404"]["content"]["application/json"]["schema"]["$ref"].endswith("/ApiErrorResponse")

    assert eq_operation["summary"] == "Update the EQ preset for a canonical genre"
    assert eq_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/EqPresetUpdateResponse")
    assert invalid_operation["summary"] == "Inspect invalid genre taxonomy nodes"
    assert invalid_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert invalid_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/GenreTaxonomyInvalidStatusResponse")
    assert cleanup_operation["summary"] == "Queue cleanup of invalid genre taxonomy nodes"
    assert cleanup_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert cleanup_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TaskEnqueueResponse")


def test_openapi_types_jam_routes_and_marks_them_authenticated(test_app):
    data = test_app.get("/openapi.json").json()
    create_operation = data["paths"]["/api/jam/rooms"]["post"]
    list_operation = data["paths"]["/api/jam/rooms"]["get"]
    get_operation = data["paths"]["/api/jam/rooms/{room_id}"]["get"]
    update_operation = data["paths"]["/api/jam/rooms/{room_id}"]["patch"]
    delete_operation = data["paths"]["/api/jam/rooms/{room_id}"]["delete"]
    public_join_operation = data["paths"]["/api/jam/rooms/{room_id}/join"]["post"]
    invite_operation = data["paths"]["/api/jam/rooms/{room_id}/invites"]["post"]
    join_operation = data["paths"]["/api/jam/rooms/invites/{token}/join"]["post"]
    end_operation = data["paths"]["/api/jam/rooms/{room_id}/end"]["post"]

    for operation in (
        create_operation,
        list_operation,
        get_operation,
        update_operation,
        delete_operation,
        public_join_operation,
        invite_operation,
        join_operation,
        end_operation,
    ):
        assert operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]

    assert create_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/JamRoomResponse")
    assert list_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/JamRoomListResponse")
    assert update_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/JamRoomResponse")
    assert delete_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/JamRoomDeleteResponse")
    assert public_join_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/JamJoinResponse")
    assert invite_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/JamInviteResponse")
    assert join_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/JamJoinResponse")
    assert end_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/JamRoomResponse")


def test_openapi_documents_sse_event_routes(test_app):
    data = test_app.get("/openapi.json").json()
    global_events = data["paths"]["/api/events"]["get"]
    task_events = data["paths"]["/api/events/task/{task_id}"]["get"]
    cache_events = data["paths"]["/api/cache/events"]["get"]

    for operation in (global_events, task_events):
        assert operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
        assert operation["responses"]["200"]["content"]["text/event-stream"]["schema"]["type"] == "string"

    assert cache_events["security"] == [{"cookieAuth": []}, {"bearerAuth": []}, {"queryTokenAuth": []}]
    assert cache_events["responses"]["200"]["content"]["text/event-stream"]["schema"]["type"] == "string"


def test_openapi_types_auth_routes_and_only_secures_protected_endpoints(test_app):
    data = test_app.get("/openapi.json").json()
    login_operation = data["paths"]["/api/auth/login"]["post"]
    me_operation = data["paths"]["/api/auth/me"]["get"]
    admin_invites_operation = data["paths"]["/api/admin/auth/invites"]["post"]

    assert login_operation["summary"] == "Log in with email and password"
    assert "security" not in login_operation
    assert login_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/AuthLoginResponse")

    assert me_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert me_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/AuthMeResponse")

    assert admin_invites_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert admin_invites_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/AuthInviteResponse")


def test_openapi_types_playlist_routes_and_keeps_filter_options_public(test_app):
    data = test_app.get("/openapi.json").json()
    list_operation = data["paths"]["/api/playlists"]["get"]
    filter_operation = data["paths"]["/api/playlists/filter-options"]["get"]
    invite_accept_operation = data["paths"]["/api/playlists/invites/{token}/accept"]["post"]
    cover_operation = data["paths"]["/api/playlists/{playlist_id}/cover"]["get"]

    assert list_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert list_operation["responses"]["200"]["content"]["application/json"]["schema"]["type"] == "array"
    assert list_operation["responses"]["200"]["content"]["application/json"]["schema"]["items"]["$ref"].endswith("/PlaylistSummaryResponse")

    assert "security" not in filter_operation
    assert filter_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/PlaylistFilterOptionsResponse")

    assert invite_accept_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert invite_accept_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/PlaylistInviteAcceptResponse")

    assert cover_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert cover_operation["responses"]["200"]["content"]["image/jpeg"]["schema"]["format"] == "binary"


def test_openapi_types_settings_routes_and_marks_them_authenticated(test_app):
    data = test_app.get("/openapi.json").json()
    get_operation = data["paths"]["/api/settings"]["get"]
    clear_cache_operation = data["paths"]["/api/settings/cache/clear"]["post"]

    assert get_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert get_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SettingsResponse")

    assert clear_cache_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert clear_cache_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/CacheClearResponse")


def test_openapi_types_task_routes_and_marks_them_authenticated(test_app):
    data = test_app.get("/openapi.json").json()
    list_operation = data["paths"]["/api/tasks"]["get"]
    admin_snapshot_operation = data["paths"]["/api/admin/tasks-snapshot"]["get"]
    worker_status_operation = data["paths"]["/api/worker/status"]["get"]
    retry_operation = data["paths"]["/api/tasks/retry"]["post"]

    assert list_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert list_operation["responses"]["200"]["content"]["application/json"]["schema"]["type"] == "array"
    assert list_operation["responses"]["200"]["content"]["application/json"]["schema"]["items"]["$ref"].endswith("/TaskResponse")

    assert admin_snapshot_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert admin_snapshot_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/AdminTasksSnapshotResponse")

    assert worker_status_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert worker_status_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/WorkerStatusResponse")

    assert retry_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert retry_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TaskRetryResponse")


def test_openapi_types_setup_routes_and_only_secures_protected_endpoints(test_app):
    data = test_app.get("/openapi.json").json()
    status_operation = data["paths"]["/api/setup/status"]["get"]
    admin_operation = data["paths"]["/api/setup/admin"]["post"]
    scan_operation = data["paths"]["/api/setup/scan"]["post"]

    assert "security" not in status_operation
    assert status_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SetupStatusResponse")

    assert "security" not in admin_operation
    assert admin_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SetupAdminResponse")

    assert scan_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert scan_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TaskEnqueueResponse")


def test_openapi_types_scanner_and_operations_routes(test_app):
    data = test_app.get("/openapi.json").json()
    scanner_status_operation = data["paths"]["/api/status"]["get"]
    scanner_start_operation = data["paths"]["/api/scan"]["post"]
    match_operation = data["paths"]["/api/match/albums/{album_id}"]["get"]
    duplicates_operation = data["paths"]["/api/duplicates/compare"]["get"]
    batch_operation = data["paths"]["/api/batch/retag"]["post"]

    assert "security" not in scanner_status_operation
    assert scanner_status_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ScannerStatusResponse")

    assert scanner_start_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert scanner_start_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ScanStartResponse")

    assert match_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert match_operation["responses"]["200"]["content"]["application/json"]["schema"]["items"]["$ref"].endswith("/MatchCandidateResponse")

    assert duplicates_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert duplicates_operation["responses"]["200"]["content"]["application/json"]["schema"]["items"]["$ref"].endswith("/DuplicateAlbumCompareResponse")

    assert batch_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert batch_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/BatchTaskEnqueueResponse")


def test_openapi_types_social_routes_and_marks_them_authenticated(test_app):
    data = test_app.get("/openapi.json").json()
    me_social_operation = data["paths"]["/api/me/social"]["get"]
    profile_operation = data["paths"]["/api/users/{username}"]["get"]
    profile_page_operation = data["paths"]["/api/users/{username}/page"]["get"]
    followers_operation = data["paths"]["/api/users/{username}/followers"]["get"]
    follow_operation = data["paths"]["/api/users/{user_id}/follow"]["post"]

    assert me_social_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert me_social_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SocialMeResponse")

    assert profile_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert profile_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SocialProfileDetailResponse")

    assert profile_page_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert profile_page_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SocialProfilePageResponse")

    assert followers_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert followers_operation["responses"]["200"]["content"]["application/json"]["schema"]["items"]["$ref"].endswith("/SocialUserRelationResponse")

    assert follow_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert follow_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SocialFollowResponse")


def test_openapi_types_me_routes_and_marks_them_authenticated(test_app):
    data = test_app.get("/openapi.json").json()
    library_operation = data["paths"]["/api/me"]["get"]
    playlists_page_operation = data["paths"]["/api/me/playlists-page"]["get"]
    history_operation = data["paths"]["/api/me/history"]["get"]
    play_events_operation = data["paths"]["/api/me/play-events"]["post"]
    overview_operation = data["paths"]["/api/me/stats/overview"]["get"]
    dashboard_operation = data["paths"]["/api/me/stats/dashboard"]["get"]
    replay_operation = data["paths"]["/api/me/stats/replay"]["get"]

    assert library_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert library_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/UserLibraryCountsResponse")

    assert playlists_page_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert playlists_page_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/LibraryPlaylistsPageResponse")

    assert history_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert history_operation["responses"]["200"]["content"]["application/json"]["schema"]["items"]["$ref"].endswith("/PlayHistoryEntryResponse")

    assert play_events_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert play_events_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/RecordPlayEventRequest")
    assert play_events_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/PlayEventRecordedResponse")

    assert overview_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert overview_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/StatsOverviewResponse")

    assert dashboard_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert dashboard_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/StatsDashboardResponse")

    assert replay_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert replay_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ReplayMixResponse")


def test_openapi_types_offline_routes_and_marks_them_authenticated(test_app):
    data = test_app.get("/openapi.json").json()
    track_by_entity_operation = data["paths"]["/api/offline/tracks/by-entity/{entity_uid}/manifest"]["get"]
    track_by_id_operation = data["paths"]["/api/offline/tracks/{track_id}/manifest"]["get"]
    track_by_path_operation = data["paths"]["/api/offline/tracks/by-path/{path}/manifest"]["get"]
    album_operation = data["paths"]["/api/offline/albums/{album_id}/manifest"]["get"]
    playlist_operation = data["paths"]["/api/offline/playlists/{playlist_id}/manifest"]["get"]

    for operation in (
        track_by_entity_operation,
        track_by_id_operation,
        track_by_path_operation,
        album_operation,
        playlist_operation,
    ):
        assert operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
        assert operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/OfflineManifestResponse")

    assert track_by_entity_operation["summary"] == "Get an offline manifest for a track by entity UID"
    assert "/api/offline/tracks/by-storage/{storage_id}/manifest" not in data["paths"]
    assert playlist_operation["responses"]["409"]["content"]["application/json"]["schema"]["$ref"].endswith("/ApiErrorResponse")


def test_openapi_types_me_profile_scrobble_and_location_routes(test_app):
    data = test_app.get("/openapi.json").json()
    profile_operation = data["paths"]["/api/me/profile"]["put"]
    password_operation = data["paths"]["/api/me/password"]["put"]
    scrobble_status_operation = data["paths"]["/api/me/scrobble/status"]["get"]
    listenbrainz_operation = data["paths"]["/api/me/scrobble/listenbrainz"]["post"]
    lastfm_auth_operation = data["paths"]["/api/me/scrobble/lastfm/auth-url"]["get"]
    geolocation_operation = data["paths"]["/api/me/geolocation"]["get"]
    location_operation = data["paths"]["/api/me/location"]["get"]
    city_search_operation = data["paths"]["/api/me/cities/search"]["get"]

    assert profile_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert profile_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("UpdateProfileRequest")
    assert profile_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/UpdateProfileResponse")

    assert password_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert password_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("ChangePasswordRequest")

    assert scrobble_status_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert scrobble_status_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ScrobbleStatusResponse")

    assert listenbrainz_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert listenbrainz_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ListenBrainzConnectResponse")

    assert lastfm_auth_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert lastfm_auth_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/LastfmAuthUrlResponse")

    assert geolocation_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert geolocation_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/GeolocationResponse")

    assert location_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert location_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/LocationPreferencesResponse")

    assert city_search_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert city_search_operation["responses"]["200"]["content"]["application/json"]["schema"]["items"]["$ref"].endswith("/CitySearchResultResponse")


def test_openapi_types_me_home_feed_and_upcoming_routes(test_app):
    data = test_app.get("/openapi.json").json()
    discovery_operation = data["paths"]["/api/me/home/discovery"]["get"]
    mix_operation = data["paths"]["/api/me/home/mixes/{mix_id}"]["get"]
    playlist_operation = data["paths"]["/api/me/home/playlists/{playlist_id}"]["get"]
    section_operation = data["paths"]["/api/me/home/sections/{section_id}"]["get"]
    feed_operation = data["paths"]["/api/me/feed"]["get"]
    upcoming_operation = data["paths"]["/api/me/upcoming"]["get"]

    for operation in (discovery_operation, mix_operation, playlist_operation, section_operation, feed_operation, upcoming_operation):
        assert operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]

    assert discovery_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/HomeDiscoveryResponse")
    assert mix_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/HomeCardResponse")
    assert playlist_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/HomeCardResponse")
    assert section_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/HomeSectionResponse")
    assert feed_operation["responses"]["200"]["content"]["application/json"]["schema"]["items"]["$ref"].endswith("/FeedItemResponse")
    assert upcoming_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/MeUpcomingResponse")


def test_openapi_types_acquisition_routes_and_marks_them_authenticated(test_app):
    data = test_app.get("/openapi.json").json()
    status_operation = data["paths"]["/api/acquisition/status"]["get"]
    search_operation = data["paths"]["/api/acquisition/search/soulseek"]["post"]
    poll_operation = data["paths"]["/api/acquisition/search/soulseek/{search_id}"]["get"]
    upload_operation = data["paths"]["/api/acquisition/upload"]["post"]
    releases_operation = data["paths"]["/api/acquisition/new-releases"]["get"]
    queue_operation = data["paths"]["/api/acquisition/queue"]["get"]

    assert status_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert status_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/AcquisitionStatusResponse")

    assert search_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert search_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/SoulseekSearchRequest")
    assert search_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SoulseekSearchStartResponse")

    assert poll_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert poll_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SoulseekSearchPollResponse")

    assert upload_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert "multipart/form-data" in upload_operation["requestBody"]["content"]
    assert upload_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/AcquisitionUploadResponse")

    assert releases_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert releases_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/NewReleasesResponse")

    assert queue_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert queue_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/AcquisitionQueueResponse")


def test_openapi_types_tidal_routes_and_marks_them_authenticated(test_app):
    data = test_app.get("/openapi.json").json()
    status_operation = data["paths"]["/api/tidal/status"]["get"]
    login_operation = data["paths"]["/api/tidal/auth/login"]["post"]
    search_operation = data["paths"]["/api/tidal/search"]["get"]
    download_operation = data["paths"]["/api/tidal/download"]["post"]
    batch_operation = data["paths"]["/api/tidal/download-batch"]["post"]
    queue_operation = data["paths"]["/api/tidal/queue"]["get"]
    wishlist_operation = data["paths"]["/api/tidal/wishlist"]["post"]
    discography_operation = data["paths"]["/api/tidal/artists/{artist_id}/discography"]["get"]
    match_missing_operation = data["paths"]["/api/tidal/artists/{artist_id}/match-missing"]["get"]
    monitored_operation = data["paths"]["/api/tidal/monitored"]["get"]

    assert status_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert status_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TidalStatusResponse")

    assert login_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert "text/event-stream" in login_operation["responses"]["200"]["content"]

    assert search_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert search_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TidalSearchResponse")

    assert download_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert download_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/DownloadRequest")
    assert download_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TidalDownloadResponse")

    assert batch_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert batch_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/BatchDownloadRequest")
    assert batch_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/BatchDownloadResponse")

    assert queue_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert queue_operation["responses"]["200"]["content"]["application/json"]["schema"]["type"] == "array"
    assert queue_operation["responses"]["200"]["content"]["application/json"]["schema"]["items"]["$ref"].endswith("/TidalQueueItemResponse")

    assert wishlist_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert wishlist_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/WishlistRequest")
    assert wishlist_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/WishlistResponse")

    assert discography_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert discography_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TidalDiscographyResponse")

    assert match_missing_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert match_missing_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/MatchMissingResponse")

    assert monitored_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert monitored_operation["responses"]["200"]["content"]["application/json"]["schema"]["type"] == "array"
    assert monitored_operation["responses"]["200"]["content"]["application/json"]["schema"]["items"]["$ref"].endswith("/MonitoredArtistResponse")


def test_openapi_types_system_playlist_and_curation_routes(test_app):
    data = test_app.get("/openapi.json").json()
    system_list_operation = data["paths"]["/api/admin/system-playlists"]["get"]
    system_create_operation = data["paths"]["/api/admin/system-playlists"]["post"]
    system_detail_operation = data["paths"]["/api/admin/system-playlists/{playlist_id}"]["get"]
    system_generate_operation = data["paths"]["/api/admin/system-playlists/{playlist_id}/generate"]["post"]
    curated_list_operation = data["paths"]["/api/curation/playlists"]["get"]
    curated_detail_operation = data["paths"]["/api/curation/playlists/{playlist_id}"]["get"]
    curated_follow_operation = data["paths"]["/api/curation/playlists/{playlist_id}/follow"]["post"]
    curated_follow_status_operation = data["paths"]["/api/curation/playlists/{playlist_id}/follow"]["get"]
    curated_followed_operation = data["paths"]["/api/curation/followed"]["get"]

    assert system_list_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert system_list_operation["responses"]["200"]["content"]["application/json"]["schema"]["items"]["$ref"].endswith("/SystemPlaylistSummaryResponse")

    assert system_create_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert system_create_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/CreateSystemPlaylistRequest")
    assert system_create_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SystemPlaylistSummaryResponse")

    assert system_detail_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert system_detail_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SystemPlaylistDetailResponse")

    assert system_generate_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert system_generate_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SystemPlaylistGenerateResponse")

    assert curated_list_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert curated_list_operation["responses"]["200"]["content"]["application/json"]["schema"]["items"]["$ref"].endswith("/CuratedPlaylistSummaryResponse")

    assert curated_detail_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert curated_detail_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/CuratedPlaylistDetailResponse")

    assert curated_follow_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert curated_follow_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/CuratedFollowMutationResponse")

    assert curated_follow_status_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert curated_follow_status_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/CuratedFollowStatusResponse")

    assert curated_followed_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert curated_followed_operation["responses"]["200"]["content"]["application/json"]["schema"]["items"]["$ref"].endswith("/CuratedPlaylistSummaryResponse")


def test_openapi_types_imports_organizer_and_stack_routes(test_app):
    data = test_app.get("/openapi.json").json()
    logs_snapshot_operation = data["paths"]["/api/admin/logs-snapshot"]["get"]
    admin_stack_snapshot_operation = data["paths"]["/api/admin/stack-snapshot"]["get"]
    imports_pending_operation = data["paths"]["/api/imports/pending"]["get"]
    imports_import_operation = data["paths"]["/api/imports/import"]["post"]
    imports_all_operation = data["paths"]["/api/imports/import-all"]["post"]
    imports_remove_operation = data["paths"]["/api/imports/remove"]["post"]
    organize_presets_operation = data["paths"]["/api/organize/presets"]["get"]
    organize_preview_operation = data["paths"]["/api/organize/albums/{album_id}/preview"]["get"]
    organize_apply_operation = data["paths"]["/api/organize/albums/{album_id}/apply"]["post"]
    stack_status_operation = data["paths"]["/api/stack/status"]["get"]
    stack_logs_operation = data["paths"]["/api/stack/container/{name}/logs"]["get"]
    stack_restart_operation = data["paths"]["/api/stack/container/{name}/restart"]["post"]

    assert logs_snapshot_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert logs_snapshot_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/AdminLogsSnapshotResponse")

    assert admin_stack_snapshot_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert admin_stack_snapshot_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/AdminStackSnapshotResponse")

    assert imports_pending_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert imports_pending_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ImportPendingResponse")

    assert imports_import_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert imports_import_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/ImportItemRequest")
    assert imports_import_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TaskEnqueueResponse")

    assert imports_all_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert imports_all_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TaskEnqueueResponse")

    assert imports_remove_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert imports_remove_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/ImportRemoveRequest")
    assert imports_remove_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TaskEnqueueResponse")

    assert organize_presets_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert organize_presets_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/OrganizePresetsResponse")

    assert organize_preview_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert organize_preview_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/OrganizePreviewResponse")

    assert organize_apply_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert organize_apply_operation["requestBody"]["content"]["application/json"]["schema"]["anyOf"][0]["$ref"].endswith("/OrganizeApplyRequest")
    assert organize_apply_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/OrganizeApplyResponse")

    assert stack_status_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert stack_status_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/StackStatusResponse")

    assert stack_logs_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert stack_logs_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/StackContainerLogsResponse")

    assert stack_restart_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert stack_restart_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/StackActionResponse")


def test_openapi_types_events_cache_lyrics_tags_and_enrichment_routes(test_app):
    data = test_app.get("/openapi.json").json()
    events_operation = data["paths"]["/api/events"]["get"]
    task_events_operation = data["paths"]["/api/events/task/{task_id}"]["get"]
    cache_events_operation = data["paths"]["/api/cache/events"]["get"]
    cache_invalidate_operation = data["paths"]["/api/cache/invalidate"]["post"]
    lyrics_operation = data["paths"]["/api/lyrics"]["get"]
    album_tags_operation = data["paths"]["/api/albums/{album_id}/tags"]["put"]
    track_tags_operation = data["paths"]["/api/tracks/{track_id}/tags"]["put"]
    analysis_operation = data["paths"]["/api/artists/{artist_id}/analysis-data"]["get"]
    enrichment_operation = data["paths"]["/api/artists/{artist_id}/enrichment"]["get"]
    setlist_playlist_operation = data["paths"]["/api/artists/{artist_id}/setlist-playlist"]["post"]

    assert events_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert "text/event-stream" in events_operation["responses"]["200"]["content"]

    assert task_events_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert "text/event-stream" in task_events_operation["responses"]["200"]["content"]

    assert cache_events_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}, {"queryTokenAuth": []}]
    assert "text/event-stream" in cache_events_operation["responses"]["200"]["content"]

    assert "security" not in cache_invalidate_operation
    assert cache_invalidate_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/CacheInvalidationRequest")
    assert cache_invalidate_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/CacheInvalidationResponse")

    assert lyrics_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert lyrics_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/LyricsResponse")

    assert album_tags_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert album_tags_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/AlbumTagsUpdate")
    assert album_tags_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TaskEnqueueResponse")

    assert track_tags_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert track_tags_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/TrackTagsUpdate")
    assert track_tags_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TaskEnqueueResponse")

    assert analysis_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert analysis_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ArtistAnalysisDataResponse")

    assert enrichment_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert enrichment_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ArtistEnrichmentResponse")

    assert setlist_playlist_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert setlist_playlist_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SetlistPlaylistResponse")


def test_openapi_types_artwork_routes_and_marks_them_authenticated(test_app):
    data = test_app.get("/openapi.json").json()
    missing_operation = data["paths"]["/api/artwork/missing"]["get"]
    scan_operation = data["paths"]["/api/artwork/scan"]["post"]
    fetch_operation = data["paths"]["/api/artwork/fetch"]["post"]
    extract_operation = data["paths"]["/api/artwork/extract"]["post"]
    upload_operation = data["paths"]["/api/artwork/albums/{album_id}/upload-cover"]["post"]

    assert missing_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert missing_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ArtworkMissingResponse")

    assert scan_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert scan_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TaskEnqueueResponse")

    assert fetch_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert fetch_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ArtworkQueuedResponse")

    assert extract_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert extract_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ArtworkExtractResponse")

    assert upload_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert upload_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ArtworkQueuedResponse")


def test_openapi_types_browse_artist_and_album_routes(test_app):
    data = test_app.get("/openapi.json").json()
    explore_page_operation = data["paths"]["/api/browse/explore-page"]["get"]
    filters_operation = data["paths"]["/api/browse/filters"]["get"]
    artists_operation = data["paths"]["/api/artists"]["get"]
    artist_detail_operation = data["paths"]["/api/artists/{artist_id}"]["get"]
    artist_page_operation = data["paths"]["/api/artists/{artist_id}/page"]["get"]
    artist_enrich_operation = data["paths"]["/api/artists/{artist_id}/enrich"]["post"]
    album_detail_operation = data["paths"]["/api/albums/{album_id}"]["get"]
    related_albums_operation = data["paths"]["/api/albums/{album_id}/related"]["get"]
    fetch_cover_operation = data["paths"]["/api/albums/{album_id}/fetch-cover"]["post"]

    assert explore_page_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert explore_page_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/BrowseExplorePageResponse")

    assert filters_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert filters_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/BrowseFiltersResponse")

    assert artists_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert artists_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ArtistBrowseListResponse")

    assert artist_detail_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert artist_detail_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ArtistDetailResponse")

    assert artist_page_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert artist_page_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ArtistPageResponse")

    assert artist_enrich_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert artist_enrich_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ArtistEnqueueResponse")

    assert album_detail_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert album_detail_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/AlbumDetailResponse")

    assert related_albums_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert related_albums_operation["responses"]["200"]["content"]["application/json"]["schema"]["items"]["$ref"].endswith("/RelatedAlbumResponse")

    assert fetch_cover_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert fetch_cover_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TaskEnqueueResponse")


def test_openapi_types_browse_shows_upcoming_and_media_routes(test_app):
    data = test_app.get("/openapi.json").json()
    cached_shows_operation = data["paths"]["/api/shows/cached"]["get"]
    upcoming_operation = data["paths"]["/api/upcoming"]["get"]
    external_network_operation = data["paths"]["/api/network/external-artist"]["get"]
    artist_photo_operation = data["paths"]["/api/artists/{artist_id}/photo"]["get"]
    artist_background_operation = data["paths"]["/api/artists/{artist_id}/background"]["get"]
    album_cover_operation = data["paths"]["/api/albums/{album_id}/cover"]["get"]
    album_download_operation = data["paths"]["/api/albums/{album_id}/download"]["get"]

    assert cached_shows_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert cached_shows_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/CachedShowsResponse")

    assert upcoming_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert upcoming_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/UpcomingResponse")

    assert external_network_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert external_network_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ArtistNetworkResponse")

    assert artist_photo_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert "image/jpeg" in artist_photo_operation["responses"]["200"]["content"]
    assert "image/webp" in artist_photo_operation["responses"]["200"]["content"]
    assert any(param["name"] == "size" for param in artist_photo_operation.get("parameters", []))
    assert any(param["name"] == "format" for param in artist_photo_operation.get("parameters", []))

    assert artist_background_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert "image/svg+xml" in artist_background_operation["responses"]["200"]["content"]
    assert any(param["name"] == "size" for param in artist_background_operation.get("parameters", []))

    assert album_cover_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert "image/png" in album_cover_operation["responses"]["200"]["content"]
    assert "image/webp" in album_cover_operation["responses"]["200"]["content"]
    assert any(param["name"] == "size" for param in album_cover_operation.get("parameters", []))
    assert any(param["name"] == "format" for param in album_cover_operation.get("parameters", []))

    assert album_download_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}, {"queryTokenAuth": []}]
    assert "application/zip" in album_download_operation["responses"]["200"]["content"]


def test_openapi_types_subsonic_routes_and_hides_view_aliases(test_app):
    data = test_app.get("/openapi.json").json()

    assert "/rest/ping" in data["paths"]
    assert "/rest/ping.view" not in data["paths"]
    assert "/rest/getArtists.view" not in data["paths"]

    ping_operation = data["paths"]["/rest/ping"]["get"]
    artist_operation = data["paths"]["/rest/getArtists"]["get"]
    album_list_operation = data["paths"]["/rest/getAlbumList2"]["get"]
    search_operation = data["paths"]["/rest/search3"]["get"]
    stream_operation = data["paths"]["/rest/stream"]["get"]
    cover_operation = data["paths"]["/rest/getCoverArt"]["get"]
    scrobble_post_operation = data["paths"]["/rest/scrobble"]["post"]
    random_operation = data["paths"]["/rest/getRandomSongs"]["get"]

    common_params = {param["name"] for param in ping_operation["parameters"]}
    assert {"u", "p", "t", "s", "v", "c", "f"} <= common_params

    assert "security" not in ping_operation
    assert ping_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SubsonicOkResponse")
    assert artist_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SubsonicArtistsResponse")
    assert album_list_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SubsonicAlbumList2Response")
    assert search_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SubsonicSearchResult3Response")
    assert scrobble_post_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SubsonicOkResponse")
    assert random_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SubsonicRandomSongsResponse")

    stream_content = stream_operation["responses"]["200"]["content"]
    assert "application/json" in stream_content
    assert "audio/mpeg" in stream_content
    assert stream_content["application/json"]["schema"]["$ref"].endswith("/SubsonicOkResponse")
    assert stream_content["audio/mpeg"]["schema"]["format"] == "binary"

    cover_content = cover_operation["responses"]["200"]["content"]
    assert "application/json" in cover_content
    assert "image/jpeg" in cover_content
    assert cover_content["image/jpeg"]["schema"]["format"] == "binary"


def test_openapi_types_browse_media_routes_and_query_token_streams(test_app):
    data = test_app.get("/openapi.json").json()
    search_operation = data["paths"]["/api/search"]["get"]
    favorites_operation = data["paths"]["/api/favorites"]["get"]
    rate_operation = data["paths"]["/api/track/rate"]["post"]
    track_info_operation = data["paths"]["/api/tracks/{track_id}/info"]["get"]
    track_info_by_entity_operation = data["paths"]["/api/tracks/by-entity/{entity_uid}/info"]["get"]
    genre_operation = data["paths"]["/api/tracks/{track_id}/genre"]["get"]
    completeness_operation = data["paths"]["/api/discover/completeness"]["get"]
    similar_operation = data["paths"]["/api/similar-tracks"]["get"]
    moods_operation = data["paths"]["/api/browse/moods"]["get"]
    mood_tracks_operation = data["paths"]["/api/browse/mood/{mood}"]["get"]
    stream_by_id_operation = data["paths"]["/api/tracks/{track_id}/stream"]["get"]
    stream_by_entity_operation = data["paths"]["/api/tracks/by-entity/{entity_uid}/stream"]["get"]
    stream_operation = data["paths"]["/api/stream/{filepath}"]["get"]
    download_by_id_operation = data["paths"]["/api/tracks/{track_id}/download"]["get"]
    download_by_entity_operation = data["paths"]["/api/tracks/by-entity/{entity_uid}/download"]["get"]
    download_operation = data["paths"]["/api/download/track/{filepath}"]["get"]

    assert search_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert search_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SearchResponse")

    assert favorites_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert favorites_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/FavoritesResponse")

    assert rate_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert rate_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/TrackRatingRequest")
    assert rate_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TrackRatingResponse")

    assert track_info_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert track_info_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TrackInfoResponse")
    assert track_info_by_entity_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert track_info_by_entity_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TrackInfoResponse")
    assert "/api/tracks/by-storage/{storage_id}/info" not in data["paths"]
    assert "/api/tracks/by-storage/{storage_id}/eq-features" not in data["paths"]
    assert "/api/tracks/by-storage/{storage_id}/genre" not in data["paths"]
    assert "/api/tracks/by-storage/{storage_id}/stream" not in data["paths"]
    assert "/api/tracks/by-storage/{storage_id}/download" not in data["paths"]

    assert genre_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert genre_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TrackGenreResponse")

    assert completeness_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert completeness_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/DiscoverCompletenessResponse")

    assert similar_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert similar_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/SimilarTracksResponse")

    assert moods_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert moods_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/MoodPresetsResponse")

    assert mood_tracks_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert mood_tracks_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/MoodTracksResponse")

    for operation in (stream_by_id_operation, stream_by_entity_operation, stream_operation):
        assert operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}, {"queryTokenAuth": []}]
        assert operation["responses"]["200"]["content"]["audio/flac"]["schema"]["format"] == "binary"

    for operation in (download_by_id_operation, download_by_entity_operation, download_operation):
        assert operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}, {"queryTokenAuth": []}]
        assert operation["responses"]["200"]["content"]["application/octet-stream"]["schema"]["format"] == "binary"


def test_openapi_types_analytics_routes_and_marks_them_authenticated(test_app):
    data = test_app.get("/openapi.json").json()
    analytics_operation = data["paths"]["/api/analytics"]["get"]
    recent_activity_operation = data["paths"]["/api/activity/recent"]["get"]
    stats_operation = data["paths"]["/api/stats"]["get"]
    live_activity_operation = data["paths"]["/api/activity/live"]["get"]
    timeline_operation = data["paths"]["/api/timeline"]["get"]
    quality_operation = data["paths"]["/api/quality"]["get"]
    artist_missing_operation = data["paths"]["/api/artists/{artist_id}/missing"]["get"]
    missing_search_operation = data["paths"]["/api/missing-search"]["get"]
    artist_stats_operation = data["paths"]["/api/artists/{artist_id}/stats"]["get"]
    insights_operation = data["paths"]["/api/insights"]["get"]

    assert analytics_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert analytics_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/AnalyticsOverviewResponse")

    assert recent_activity_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert recent_activity_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ActivityRecentResponse")

    assert stats_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert stats_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/StatsResponse")

    assert live_activity_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert live_activity_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ActivityLiveResponse")

    assert timeline_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert timeline_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TimelineResponse")

    assert quality_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert quality_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/QualityReportResponse")

    assert artist_missing_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert artist_missing_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/MissingAlbumsResponse")

    assert missing_search_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert missing_search_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/MissingAlbumsResponse")

    assert artist_stats_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert artist_stats_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ArtistStatsResponse")

    assert insights_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert insights_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/InsightsResponse")


def test_openapi_types_management_routes_and_marks_them_authenticated(test_app):
    data = test_app.get("/openapi.json").json()
    admin_health_snapshot_operation = data["paths"]["/api/admin/health-snapshot"]["get"]
    health_check_operation = data["paths"]["/api/manage/health-check"]["post"]
    health_issues_operation = data["paths"]["/api/manage/health-issues"]["get"]
    resolve_issue_operation = data["paths"]["/api/manage/health-issues/{issue_id}/resolve"]["post"]
    fix_type_operation = data["paths"]["/api/manage/health-issues/fix-type/{check_type}"]["post"]
    artist_health_operation = data["paths"]["/api/manage/artists/{artist_id}/health-issues"]["get"]
    analysis_status_operation = data["paths"]["/api/manage/analysis-status"]["get"]
    audit_log_operation = data["paths"]["/api/manage/audit-log"]["get"]
    storage_status_operation = data["paths"]["/api/manage/storage-v2-status"]["get"]
    portable_metadata_operation = data["paths"]["/api/manage/portable-metadata"]["post"]
    portable_rehydrate_operation = data["paths"]["/api/manage/portable-metadata/rehydrate"]["post"]
    rich_export_operation = data["paths"]["/api/manage/portable-metadata/export-rich"]["post"]
    sync_lyrics_operation = data["paths"]["/api/manage/sync-lyrics"]["post"]

    assert admin_health_snapshot_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert admin_health_snapshot_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/AdminHealthSnapshotResponse")

    assert health_check_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert health_check_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TaskEnqueueResponse")

    assert health_issues_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert health_issues_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/HealthIssuesResponse")

    assert resolve_issue_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert resolve_issue_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/OkResponse")

    assert fix_type_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert fix_type_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/HealthFixTypeResponse")

    assert artist_health_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert artist_health_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/ArtistHealthIssuesResponse")

    assert analysis_status_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert analysis_status_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/AnalysisStatusResponse")

    assert audit_log_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert audit_log_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/AuditLogResponse")

    assert storage_status_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert storage_status_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/StorageV2StatusResponse")

    assert portable_metadata_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert portable_metadata_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/PortableMetadataRequest")
    assert portable_metadata_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TaskEnqueueResponse")

    assert portable_rehydrate_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert portable_rehydrate_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/PortableRehydrateRequest")
    assert portable_rehydrate_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TaskEnqueueResponse")

    assert rich_export_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert rich_export_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/RichMetadataExportRequest")
    assert rich_export_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TaskEnqueueResponse")

    assert sync_lyrics_operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert sync_lyrics_operation["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/LyricsSyncRequest")
    assert sync_lyrics_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/TaskEnqueueResponse")
