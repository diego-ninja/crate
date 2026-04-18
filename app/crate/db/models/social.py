"""Typed models for social graph data."""


from datetime import datetime
from pydantic import BaseModel, ConfigDict


class FollowedArtist(BaseModel):
    """An artist the user follows."""
    model_config = ConfigDict(from_attributes=True)

    artist_id: int | None = None
    artist_slug: str | None = None
    artist_name: str
    followed_at: datetime | None = None


class UserFollow(BaseModel):
    """A user-to-user follow relationship."""
    model_config = ConfigDict(from_attributes=True)

    follower_id: int
    followed_id: int
    created_at: datetime | None = None


class AffinityResult(BaseModel):
    """Computed affinity between two users."""
    model_config = ConfigDict(from_attributes=True)

    score: float = 0.0
    band: str = "unknown"  # "kindred" | "aligned" | "adjacent" | "distant" | "unknown"
    reasons: list[str] = []


class PublicProfile(BaseModel):
    """A user's public-facing profile."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str | None = None
    display_name: str | None = None
    avatar: str | None = None
    bio: str | None = None
    joined_at: datetime | None = None
    follower_count: int = 0
    following_count: int = 0
    friend_count: int = 0
    public_playlist_count: int = 0
