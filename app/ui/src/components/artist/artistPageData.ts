import type { EnrichmentData } from "@/hooks/use-artist-data";

import type { ArtistExternalLink, ArtistSimilarArtist, TabKey } from "./artistPageTypes";

export function buildArtistTags(genres: string[] | undefined, enrichment: EnrichmentData | null): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const raw = [
    ...(genres ?? []),
    ...(enrichment?.lastfm?.tags ?? []),
    ...(enrichment?.spotify?.genres ?? []),
  ];

  for (const tag of raw) {
    for (const part of tag.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        result.push(trimmed);
      }
    }
  }

  return result;
}

export function buildMergedSimilarArtists(enrichment: EnrichmentData | null): ArtistSimilarArtist[] {
  const seen = new Set<string>();
  const result: ArtistSimilarArtist[] = [];

  for (const artist of enrichment?.spotify?.related_artists ?? []) {
    const lower = artist.name.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push({
        id: artist.id,
        slug: artist.slug,
        name: artist.name,
        image: artist.images?.[0]?.url,
        genres: artist.genres,
        popularity: artist.popularity,
      });
    }
  }

  for (const artist of enrichment?.lastfm?.similar ?? []) {
    const lower = artist.name.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push({ id: artist.id, slug: artist.slug, name: artist.name });
    }
  }

  return result;
}

export function buildExternalLinks(enrichment: EnrichmentData | null, navidromeUrl?: string): ArtistExternalLink[] {
  const links: ArtistExternalLink[] = [];
  const spotify = enrichment?.spotify;
  const lastfm = enrichment?.lastfm;
  const musicbrainz = enrichment?.musicbrainz;

  if (spotify?.url) links.push({ label: "Spotify", url: spotify.url, color: "text-green-400" });
  if (lastfm?.url) links.push({ label: "Last.fm", url: lastfm.url, color: "text-red-400" });
  if (musicbrainz?.urls?.wikipedia) links.push({ label: "Wikipedia", url: musicbrainz.urls.wikipedia, color: "text-white/60" });
  if (musicbrainz?.urls?.official) links.push({ label: "Official", url: musicbrainz.urls.official, color: "text-blue-400" });
  if (musicbrainz?.urls?.instagram) links.push({ label: "Instagram", url: musicbrainz.urls.instagram, color: "text-pink-400" });
  if (musicbrainz?.urls?.spotify && !spotify?.url) {
    links.push({ label: "Spotify", url: musicbrainz.urls.spotify, color: "text-green-400" });
  }
  if (navidromeUrl) links.push({ label: "Navidrome", url: navidromeUrl, color: "text-primary" });

  return links;
}

export function buildArtistTabs(showCount: number): { key: TabKey; label: string }[] {
  return [
    { key: "overview", label: "Overview" },
    { key: "top-tracks", label: "Top Tracks" },
    { key: "discography", label: "Discography" },
    { key: "setlist", label: "Probable Setlist" },
    ...(showCount > 0 ? [{ key: "shows" as TabKey, label: `Shows (${showCount})` }] : []),
    { key: "similar", label: "Similar Artists" },
    { key: "stats", label: "Stats" },
    { key: "about", label: "About" },
  ];
}

export function computePopularityScore(spotifyPopularity?: number, lastfmListeners?: number): number {
  if (spotifyPopularity && spotifyPopularity > 0) return spotifyPopularity;
  if (!lastfmListeners || lastfmListeners <= 5000) return 0;

  const minListeners = Math.log(5000);
  const maxListeners = Math.log(50000000);
  return Math.min(
    100,
    Math.max(1, Math.round(((Math.log(lastfmListeners) - minListeners) / (maxListeners - minListeners)) * 100)),
  );
}
