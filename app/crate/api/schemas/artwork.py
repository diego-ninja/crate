"""Schema models for artwork endpoints."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from crate.api.schemas.common import TaskEnqueueResponse
from crate.api.schemas.artist_hero import (
    ArtistHeroCompositionView,
    ArtistHeroRenderManifestView,
)
from crate.artist_hero_artwork import ARTIST_HERO_RENDER_VERSION


class ArtworkMissingAlbumResponse(BaseModel):
    name: str
    display_name: str
    artist: str
    year: str | int | None = None
    mbid: str | None = None
    path: str | None = None


class ArtworkMissingResponse(BaseModel):
    missing_count: int
    albums: list[ArtworkMissingAlbumResponse]


class ArtworkScanRequest(BaseModel):
    auto_apply: bool = False


class ArtworkApplyRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


class ArtworkFetchRequest(BaseModel):
    mbid: str
    path: str | None = None


class ArtworkExtractRequest(BaseModel):
    path: str


class ArtworkQueuedResponse(TaskEnqueueResponse):
    status: str | None = None


class ArtistHeroMigrationRequest(BaseModel):
    after_artist_id: int = Field(default=0, ge=0)
    batch_size: int = Field(default=25, ge=1, le=100)
    dry_run: bool = True


class ArtworkExtractResponse(BaseModel):
    status: str
    path: str


class ArtistHeroCrop(BaseModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class ArtistHeroRecipe(BaseModel):
    mode: Literal["crop", "extend"]
    crop: ArtistHeroCrop
    position_x: float = Field(ge=-1, le=2)
    position_y: float = Field(ge=-1, le=2)
    scale: float = Field(ge=0.25, le=2)
    flip_horizontal: bool = False
    rotation: Literal[0, 90, 180, 270] = 0
    blur: float = Field(ge=0, le=80)
    feather: float = Field(ge=0, le=80)
    gradient: float = Field(ge=0, le=1)
    grayscale: bool = False
    brightness: float = Field(default=1.0, ge=0.5, le=1.5)
    contrast: float = Field(default=1.0, ge=0.5, le=1.5)


class ArtistHeroArtworkResponse(BaseModel):
    artist_id: int
    is_featured: bool = False
    featured_devices: list[Literal["desktop", "mobile"]] = Field(default_factory=list)
    desktop_enabled: bool = True
    mobile_enabled: bool = True
    provenance: Literal["manual", "derived_background"]
    review_status: Literal["approved", "unreviewed", "rejected"]
    source_width: int
    source_height: int
    desktop_source_width: int | None = None
    desktop_source_height: int | None = None
    desktop_source_origin: str | None = None
    mobile_source_width: int | None = None
    mobile_source_height: int | None = None
    mobile_source_origin: str | None = None
    desktop_recipe: ArtistHeroRecipe
    mobile_recipe: ArtistHeroRecipe
    revision: str
    updated_at: datetime
    schema_version: int = 1
    render_version: str = ARTIST_HERO_RENDER_VERSION
    compositions: dict[str, ArtistHeroCompositionView] = Field(default_factory=dict)
    render_manifest: ArtistHeroRenderManifestView | None = None


class ArtistHeroReviewRequest(BaseModel):
    review_status: Literal["approved", "unreviewed", "rejected"]


class ArtistHeroComposeRequest(BaseModel):
    desktop_recipe: ArtistHeroRecipe
    mobile_recipe: ArtistHeroRecipe
    composition: Literal["shared", "desktop", "mobile"] = "shared"


class ArtistHeroCandidateAnalysisRequest(BaseModel):
    candidate: str


ArtistArtworkSlot = Literal["avatar", "background", "hero_desktop", "hero_mobile"]


class ArtistArtworkAssetAssignRequest(BaseModel):
    asset_id: int = Field(gt=0)


class ArtistArtworkCandidateImportRequest(BaseModel):
    candidate: str = Field(min_length=1)
    label: str | None = Field(default=None, max_length=160)
