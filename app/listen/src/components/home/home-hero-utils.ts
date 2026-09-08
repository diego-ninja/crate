import {
  ARTIST_HERO_DESKTOP_SIZE,
  ARTIST_HERO_MOBILE_SIZE,
  type ArtistHeroArtworkBounds,
} from "@crate/ui/domain/ArtistHeroFrame";

import { canonicalArtworkTransportIdentity } from "@/lib/artwork-manager";
import { artistBackgroundApiUrl, artistHeroApiUrl } from "@/lib/library-routes";

import type { HomeHeroArtist } from "./home-model";

export const HERO_BACKGROUND_VERSION = "home-just-landed-v1";

export function dedupeHeroArtists(heroes: HomeHeroArtist[]): HomeHeroArtist[] {
  const seen = new Set<string>();
  return heroes.filter((hero) => {
    const name = hero.name?.trim().replace(/\s+/g, " ").toLowerCase();
    const key = name || hero.entity_uid || String(hero.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function heroSelectionKey(hero: HomeHeroArtist): string {
  return hero.entity_uid || String(hero.id);
}

export function heroBackgroundSrc(
  hero: HomeHeroArtist,
  composition: "desktop" | "mobile",
): string | undefined {
  const canonical = hero.hero_compositions?.[composition];
  const backgroundUrl = artistHeroApiUrl(
    {
      artistId: hero.id,
      artistEntityUid: hero.entity_uid,
      artistSlug: hero.slug,
      artistName: hero.name,
    },
    composition,
    {
      size:
        canonical?.width ??
        (composition === "desktop"
          ? ARTIST_HERO_DESKTOP_SIZE.width
          : ARTIST_HERO_MOBILE_SIZE.width),
      version:
        canonical?.render_revision ||
        hero.artwork_revision ||
        HERO_BACKGROUND_VERSION,
    },
  );
  return backgroundUrl || undefined;
}

export function heroArtworkBounds(
  hero: HomeHeroArtist,
  composition: "desktop" | "mobile",
): ArtistHeroArtworkBounds | undefined {
  return (
    hero.hero_compositions?.[composition]?.bounds ||
    (composition === "desktop"
      ? hero.desktop_artwork_bounds
      : hero.mobile_artwork_bounds)
  );
}

export function legacyHeroBackgroundSrc(
  hero: HomeHeroArtist,
  composition: "desktop" | "mobile",
): string | undefined {
  const backgroundUrl = artistBackgroundApiUrl(
    {
      artistId: hero.id,
      artistEntityUid: hero.entity_uid,
      artistSlug: hero.slug,
      artistName: hero.name,
    },
    {
      size:
        composition === "desktop"
          ? ARTIST_HERO_DESKTOP_SIZE.width
          : ARTIST_HERO_MOBILE_SIZE.width,
      version: HERO_BACKGROUND_VERSION,
    },
  );
  return backgroundUrl || undefined;
}

export function requestBackgroundWork(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const idleWindow = window as Window & {
    requestIdleCallback?: (
      cb: () => void,
      options?: { timeout: number },
    ) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 1500 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(callback, 600);
  return () => window.clearTimeout(handle);
}

export function homeHeroArtworkLogicalKey(src: string): string {
  return `home-hero:${canonicalArtworkTransportIdentity(src)}`;
}
