"""Schema models for personal-library and stats endpoints."""

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, RootModel, field_validator, model_validator

from crate.api.schemas.common import OkResponse


class _StorageIdMixin(BaseModel):
    """Coerce UUID track_storage_id to str for JSON serialization."""

    @field_validator("track_storage_id", mode="before", check_fields=False)
    @classmethod
    def coerce_storage_id(cls, v: Any) -> str | None:
        return str(v) if v is not None else None
from crate.api.schemas.playlists import PlaylistSummaryResponse


class FollowRequest(BaseModel):
    artist_name: str


class SaveAlbumRequest(BaseModel):
    album_id: int


class LikeTrackRequest(BaseModel):
    track_id: int | None = None
    track_storage_id: str | None = None
    track_path: str | None = None


class RecordPlayRequest(BaseModel):
    track_id: int | None = None
    track_storage_id: str | None = None
    track_path: str | None = None
    title: str = ""
    artist: str = ""
    album: str = ""


class NowPlayingRequest(BaseModel):
    playing: bool = True
    track_id: int | None = None
    track_storage_id: str | None = None
    track_path: str | None = None
    title: str = ""
    artist: str = ""
    album: str = ""
    started_at: datetime | None = None
    device_type: str | None = None
    app_platform: str | None = None


class RecordPlayEventRequest(BaseModel):
    track_id: int | None = None
    track_storage_id: str | None = None
    track_path: str | None = None
    title: str = ""
    artist: str = ""
    album: str = ""
    started_at: datetime
    ended_at: datetime
    played_seconds: float = 0
    track_duration_seconds: float | None = None
    completion_ratio: float | None = None
    was_skipped: bool = False
    was_completed: bool = False
    play_source_type: str | None = None
    play_source_id: str | None = None
    play_source_name: str | None = None
    context_artist: str | None = None
    context_album: str | None = None
    context_playlist_id: int | None = None
    device_type: str | None = None
    app_platform: str | None = None

    @field_validator("played_seconds")
    @classmethod
    def _validate_played_seconds(cls, value: float) -> float:
        if value < 0:
            raise ValueError("played_seconds must be >= 0")
        return value

    @field_validator("track_duration_seconds")
    @classmethod
    def _validate_track_duration(cls, value: float | None) -> float | None:
        if value is not None and value <= 0:
            raise ValueError("track_duration_seconds must be > 0")
        return value

    @field_validator("completion_ratio")
    @classmethod
    def _validate_completion_ratio(cls, value: float | None) -> float | None:
        if value is not None and not 0 <= value <= 1:
            raise ValueError("completion_ratio must be between 0 and 1")
        return value

    @model_validator(mode="after")
    def _validate_consistency(self):
        if self.started_at > self.ended_at:
            raise ValueError("started_at must be <= ended_at")
        if self.was_skipped and self.was_completed:
            raise ValueError("was_skipped and was_completed cannot both be true")
        if self.track_duration_seconds and self.completion_ratio is not None:
            derived = min(1.0, max(0.0, self.played_seconds / self.track_duration_seconds))
            if abs(derived - self.completion_ratio) > 0.15:
                raise ValueError("completion_ratio does not match played_seconds and track_duration_seconds")
        return self


class ShowReminderRequest(BaseModel):
    reminder_type: str


class ListenBrainzConnectRequest(BaseModel):
    token: str


class LastfmCallbackRequest(BaseModel):
    token: str


class UpdateLocationBody(BaseModel):
    city: str | None = None
    country: str | None = None
    country_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    show_radius_km: int | None = None
    show_location_mode: str | None = None


class UserLibraryCountsResponse(BaseModel):
    followed_artists: int
    saved_albums: int
    liked_tracks: int
    playlists: int


class ShowAttendanceAddResponse(OkResponse):
    added: bool


class ShowAttendanceRemoveResponse(OkResponse):
    removed: bool


class ShowReminderCreateResponse(OkResponse):
    added: bool


class UpdateProfileRequest(BaseModel):
    name: str


class UpdateProfileResponse(OkResponse):
    name: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class ScrobbleConnectionResponse(BaseModel):
    connected: bool
    username: str | None = None


class ScrobbleStatusResponse(RootModel[dict[str, ScrobbleConnectionResponse]]):
    pass


class ListenBrainzConnectResponse(OkResponse):
    username: str


class LastfmAuthUrlResponse(BaseModel):
    api_key: str


class GeolocationResponse(BaseModel):
    city: str
    country: str
    country_code: str
    latitude: float
    longitude: float


class LocationPreferencesResponse(BaseModel):
    city: str | None = None
    country: str | None = None
    country_code: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    show_radius_km: int
    show_location_mode: str


class CitySearchResultResponse(BaseModel):
    city: str
    country: str
    country_code: str
    display_name: str
    latitude: float
    longitude: float


class SyncStatusResponse(BaseModel):
    services: list[Any] = Field(default_factory=list)


class FollowedPlaylistResponse(PlaylistSummaryResponse):
    follower_count: int | None = None
    is_followed: bool = True
    followed_at: datetime | str | None = None


class FollowedArtistResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    artist_name: str
    created_at: datetime | str | None = None
    artist_id: int | None = None
    artist_slug: str | None = None
    album_count: int | None = None
    track_count: int | None = None
    has_photo: bool | int | None = None


class FollowMutationResponse(OkResponse):
    added: bool


class FollowingStateResponse(BaseModel):
    following: bool


class SavedAlbumResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    saved_at: datetime | str | None = None
    id: int
    slug: str | None = None
    artist: str | None = None
    artist_id: int | None = None
    artist_slug: str | None = None
    name: str | None = None
    year: int | str | None = None
    has_cover: bool | int | None = None
    track_count: int | None = None
    total_duration: float | int | None = None


class SaveAlbumResponse(OkResponse):
    added: bool


class LikedTrackResponse(_StorageIdMixin, BaseModel):
    model_config = ConfigDict(extra="allow")

    track_id: int | None = None
    track_storage_id: str | None = None
    liked_at: datetime | str | None = None
    path: str | None = None
    relative_path: str | None = None
    title: str | None = None
    artist: str | None = None
    artist_id: int | None = None
    artist_slug: str | None = None
    album: str | None = None
    album_id: int | None = None
    album_slug: str | None = None
    duration: float | int | None = None


class LikeMutationResponse(OkResponse):
    added: bool


class UnlikeMutationResponse(OkResponse):
    removed: bool


class PlayHistoryEntryResponse(_StorageIdMixin, BaseModel):
    model_config = ConfigDict(extra="allow")

    track_id: int | None = None
    track_storage_id: str | None = None
    track_path: str | None = None
    relative_path: str | None = None
    title: str | None = None
    artist: str | None = None
    artist_id: int | None = None
    artist_slug: str | None = None
    album: str | None = None
    album_id: int | None = None
    album_slug: str | None = None
    played_at: datetime | str | None = None


class PlayEventRecordedResponse(OkResponse):
    id: int


class PlayStatsArtistResponse(BaseModel):
    artist: str
    plays: int


class PlayStatsResponse(BaseModel):
    total_plays: int
    top_artists: list[PlayStatsArtistResponse] = Field(default_factory=list)


class StatsOverviewTopArtistResponse(BaseModel):
    artist_name: str
    play_count: int
    minutes_listened: float | int
    artist_id: int | None = None
    artist_slug: str | None = None


class StatsOverviewResponse(BaseModel):
    window: str
    play_count: int
    complete_play_count: int
    skip_count: int
    minutes_listened: float | int
    active_days: int
    skip_rate: float | int
    top_artist: StatsOverviewTopArtistResponse | None = None


class TrendPointResponse(BaseModel):
    day: date | str
    play_count: int
    complete_play_count: int
    skip_count: int
    minutes_listened: float | int


class StatsTrendsResponse(BaseModel):
    window: str
    points: list[TrendPointResponse] = Field(default_factory=list)


class StatsTrackResponse(_StorageIdMixin, BaseModel):
    model_config = ConfigDict(extra="allow")

    track_id: int | None = None
    track_storage_id: str | None = None
    track_path: str | None = None
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    artist_id: int | None = None
    artist_slug: str | None = None
    album_id: int | None = None
    album_slug: str | None = None
    play_count: int
    complete_play_count: int
    minutes_listened: float | int
    first_played_at: datetime | str | None = None
    last_played_at: datetime | str | None = None


class StatsArtistResponse(BaseModel):
    artist_name: str
    artist_id: int | None = None
    artist_slug: str | None = None
    play_count: int
    complete_play_count: int
    minutes_listened: float | int
    first_played_at: datetime | str | None = None
    last_played_at: datetime | str | None = None


class StatsAlbumResponse(BaseModel):
    artist: str
    artist_id: int | None = None
    artist_slug: str | None = None
    album: str
    album_id: int | None = None
    album_slug: str | None = None
    play_count: int
    complete_play_count: int
    minutes_listened: float | int
    first_played_at: datetime | str | None = None
    last_played_at: datetime | str | None = None


class StatsGenreResponse(BaseModel):
    genre_name: str
    play_count: int
    complete_play_count: int
    minutes_listened: float | int
    first_played_at: datetime | str | None = None
    last_played_at: datetime | str | None = None


class TopTracksResponse(BaseModel):
    window: str
    items: list[StatsTrackResponse] = Field(default_factory=list)


class TopArtistsResponse(BaseModel):
    window: str
    items: list[StatsArtistResponse] = Field(default_factory=list)


class TopAlbumsResponse(BaseModel):
    window: str
    items: list[StatsAlbumResponse] = Field(default_factory=list)


class TopGenresResponse(BaseModel):
    window: str
    items: list[StatsGenreResponse] = Field(default_factory=list)


class ReplayMixResponse(BaseModel):
    window: str
    title: str
    subtitle: str
    track_count: int
    minutes_listened: float | int
    items: list[StatsTrackResponse] = Field(default_factory=list)


class HomeArtworkRefResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    artist: str | None = None
    artist_id: int | None = None
    artist_slug: str | None = None
    album: str | None = None
    album_id: int | None = None
    album_slug: str | None = None
    artist_name: str | None = None


class HomeTrackResponse(_StorageIdMixin, BaseModel):
    model_config = ConfigDict(extra="allow")

    track_id: int | None = None
    track_storage_id: str | None = None
    track_path: str | None = None
    title: str | None = None
    artist: str | None = None
    artist_id: int | None = None
    artist_slug: str | None = None
    album: str | None = None
    album_id: int | None = None
    album_slug: str | None = None
    duration: float | int | None = None
    format: str | None = None
    bitrate: int | None = None
    sample_rate: int | None = None
    bit_depth: int | None = None


class HomeCardResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str | int | None = None
    name: str | None = None
    title: str | None = None
    description: str | None = None
    subtitle: str | None = None
    badge: str | None = None
    kind: str | None = None
    track_count: int | None = None
    total_duration: float | int | None = None
    artwork_tracks: list[HomeArtworkRefResponse] = Field(default_factory=list)
    artwork_artists: list[HomeArtworkRefResponse] = Field(default_factory=list)
    tracks: list[HomeTrackResponse] = Field(default_factory=list)
    items: list[dict[str, Any]] = Field(default_factory=list)


class HomeDiscoveryResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    hero: dict[str, Any] | list[dict[str, Any]] | None = None
    recently_played: list[dict[str, Any]] = Field(default_factory=list)
    custom_mixes: list[HomeCardResponse] = Field(default_factory=list)
    suggested_albums: list[dict[str, Any]] = Field(default_factory=list)
    recommended_tracks: list[HomeTrackResponse] = Field(default_factory=list)
    radio_stations: list[dict[str, Any]] = Field(default_factory=list)
    favorite_artists: list[dict[str, Any]] = Field(default_factory=list)
    essentials: list[HomeCardResponse] = Field(default_factory=list)


class HomeSectionResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    title: str
    subtitle: str | None = None
    items: list[dict[str, Any]] = Field(default_factory=list)


class FeedItemResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    artist: str | None = None
    title: str | None = None
    date: date | datetime | str | None = None


class MeUpcomingInsightResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    show_id: int | None = None
    artist: str | None = None
    date: date | datetime | str | None = None
    title: str | None = None
    subtitle: str | None = None
    message: str | None = None


class MeUpcomingSummaryResponse(BaseModel):
    followed_artists: int
    show_count: int
    release_count: int
    attending_count: int
    insight_count: int


class MeUpcomingResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    items: list[dict[str, Any]] = Field(default_factory=list)
    insights: list[MeUpcomingInsightResponse] = Field(default_factory=list)
    summary: MeUpcomingSummaryResponse
