"""Shared response contract for canonical Artist Hero compositions."""

from typing import Literal

from pydantic import BaseModel, Field


ArtistHeroComposition = Literal["desktop", "mobile"]


class ArtistHeroArtworkBounds(BaseModel):
    left: float = Field(ge=-1, le=2)
    top: float = Field(ge=-1, le=2)
    right: float = Field(ge=-1, le=2)
    bottom: float = Field(ge=-1, le=2)


class ArtistHeroCompositionView(BaseModel):
    schema_version: int = Field(ge=1)
    composition: ArtistHeroComposition
    render_revision: str = Field(min_length=1)
    recipe_hash: str = Field(min_length=1)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    bounds: ArtistHeroArtworkBounds
    asset_path: str = Field(min_length=1)


class ArtistHeroArtifactView(BaseModel):
    renderer_version: str = Field(min_length=1)
    render_revision: str = Field(min_length=1)
    source_fingerprint: str = Field(min_length=1)
    recipe_hash: str = Field(min_length=1)
    asset_path: str = Field(min_length=1)


class ArtistHeroRenderManifestView(BaseModel):
    manifest_version: Literal[1]
    editorial_revision: str = Field(min_length=1)
    artifacts: dict[ArtistHeroComposition, ArtistHeroArtifactView] = Field(
        default_factory=dict
    )
