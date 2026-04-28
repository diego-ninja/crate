"""Schema models for social endpoints."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from crate.api.schemas.common import OkResponse
from crate.api.schemas.playlists import PlaylistSummaryResponse


class RelationshipStateResponse(BaseModel):
    following: bool
    followed_by: bool
    is_friend: bool


class SocialAffinityResponse(BaseModel):
    affinity_score: int
    affinity_band: str
    affinity_reasons: list[str] = Field(default_factory=list)
    computed_at: datetime | str | None = None


class SocialUserRelationResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    username: str | None = None
    display_name: str | None = None
    avatar: str | None = None
    followed_at: datetime | str | None = None


class SocialSearchResultResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    username: str | None = None
    display_name: str | None = None
    avatar: str | None = None
    bio: str | None = None
    joined_at: datetime | str | None = None


class SocialPublicProfileResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    username: str | None = None
    display_name: str | None = None
    avatar: str | None = None
    bio: str | None = None
    joined_at: datetime | str | None = None
    followers_count: int = 0
    following_count: int = 0
    friends_count: int = 0


class SocialProfileDetailResponse(SocialPublicProfileResponse):
    public_playlists: list[PlaylistSummaryResponse] = Field(default_factory=list)
    relationship_state: RelationshipStateResponse
    affinity_score: int
    affinity_band: str
    affinity_reasons: list[str] = Field(default_factory=list)
    computed_at: datetime | str | None = None


class SocialProfilePageResponse(SocialProfileDetailResponse):
    followers_preview: list[SocialUserRelationResponse] = Field(default_factory=list)
    following_preview: list[SocialUserRelationResponse] = Field(default_factory=list)


class SocialMeResponse(BaseModel):
    followers_count: int
    following_count: int
    friends_count: int
    profile: SocialPublicProfileResponse


class SocialFollowResponse(OkResponse):
    added: bool
    relationship_state: RelationshipStateResponse


class SocialUnfollowResponse(OkResponse):
    relationship_state: RelationshipStateResponse
