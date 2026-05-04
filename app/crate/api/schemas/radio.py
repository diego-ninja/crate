"""Schema models for radio and recommendation endpoints."""

from pydantic import BaseModel, ConfigDict

from crate.api.schemas.common import IdentityFieldsMixin


class RadioTrack(IdentityFieldsMixin):
    model_config = ConfigDict(extra="allow")

    track_id: int | None = None
    track_entity_uid: str | None = None
    track_path: str | None = None
    path: str | None = None
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    duration: float | None = None
    score: float | None = None


class RadioSeed(IdentityFieldsMixin):
    model_config = ConfigDict(extra="allow")

    artist_id: int | None = None
    artist_name: str | None = None
    track_id: int | None = None
    track_entity_uid: str | None = None
    track_path: str | None = None
    title: str | None = None
    artist: str | None = None
    album_id: int | None = None
    album: str | None = None
    playlist_id: int | str | None = None
    name: str | None = None


class RadioSession(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    name: str
    seed: RadioSeed


class RadioResponse(BaseModel):
    session: RadioSession
    tracks: list[RadioTrack]
