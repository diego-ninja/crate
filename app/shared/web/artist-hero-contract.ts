export const ARTIST_HERO_CONTRACT_VERSION = 1 as const;

export type ArtistHeroComposition = "desktop" | "mobile";
export type HomeHeroMode = "canonical" | "legacy";

export interface HomeHeroSurface<TArtist = unknown> {
  mode: HomeHeroMode;
  artists: TArtist[];
}

export interface HomeHeroSurfaces<TArtist = unknown> {
  desktop: HomeHeroSurface<TArtist>;
  mobile: HomeHeroSurface<TArtist>;
}

export interface ArtistHeroCompositionSize {
  width: number;
  height: number;
}

export interface ArtistHeroArtworkBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ArtistHeroCompositionView {
  schema_version: number;
  composition: ArtistHeroComposition;
  render_revision: string;
  recipe_hash: string;
  width: number;
  height: number;
  bounds: ArtistHeroArtworkBounds;
  asset_path: string;
}

export interface ArtistHeroArtifactView {
  renderer_version: string;
  render_revision: string;
  source_fingerprint: string;
  recipe_hash: string;
  asset_path: string;
}

export interface ArtistHeroRenderManifestView {
  manifest_version: 1;
  editorial_revision: string;
  artifacts: Partial<Record<ArtistHeroComposition, ArtistHeroArtifactView>>;
}

export interface ArtistHeroProfileView {
  schema_version: number;
  render_version: string;
  compositions: Partial<
    Record<ArtistHeroComposition, ArtistHeroCompositionView>
  >;
  render_manifest?: ArtistHeroRenderManifestView;
}

export function artistHeroCompositionSize(
  composition: ArtistHeroComposition,
): ArtistHeroCompositionSize {
  return composition === "desktop"
    ? { width: 1480, height: 600 }
    : { width: 1080, height: 1350 };
}

export function artistHeroViewKey(view: ArtistHeroCompositionView): string {
  return `${view.composition}:${view.render_revision}:${view.recipe_hash}`;
}
