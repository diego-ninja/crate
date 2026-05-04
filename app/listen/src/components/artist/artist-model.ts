import { type Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";
import type { GenreProfileItem } from "@crate/ui/domain/genres/GenrePill";

import { artistShowToUpcomingItem, type ArtistShowEvent } from "@/components/upcoming/UpcomingRows";

export interface ArtistAlbum {
  id: number;
  slug?: string;
  name: string;
  display_name: string;
  tracks: number;
  formats: string[];
  size_mb: number;
  year: string;
  has_cover: boolean;
}

export interface ArtistData {
  id?: number;
  slug?: string;
  name: string;
  updated_at?: string | null;
  albums: ArtistAlbum[];
  total_tracks: number;
  total_size_mb: number;
  primary_format: string | null;
  genres: string[];
  genre_profile?: GenreProfileItem[];
  issue_count: number;
}

export interface ArtistInfo {
  bio: string;
  tags: string[];
  similar: {
    name: string;
    match: number;
    id?: number;
    slug?: string;
  }[];
  listeners: number;
  playcount: number;
  image_url: string | null;
  url: string;
}

export interface ArtistTopTrack {
  id: string;
  artist_id?: number;
  artist_slug?: string;
  album_id?: number;
  album_slug?: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  track: number;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
}

export interface StatsArtist {
  artist_name: string;
  artist_id?: number | null;
  artist_slug?: string | null;
  play_count: number;
  complete_play_count: number;
  minutes_listened: number;
}

export interface StatsListResponse<T> {
  window: string;
  items: T[];
}

export interface ArtistPageEnrichment {
  setlist?: {
    probable_setlist: { title: string; frequency: number; play_count: number; last_played?: string }[];
    total_shows: number;
  };
}

export interface ArtistPageData {
  artist: ArtistData;
  info: ArtistInfo;
  top_tracks: ArtistTopTrack[];
  shows: {
    events: ArtistShowEvent[];
    configured: boolean;
    source: string;
  };
  enrichment: ArtistPageEnrichment;
  artist_hot_rank?: number | null;
}

export function buildArtistPhotoUrl(artistName: string, artistId?: number, artistSlug?: string, version?: string | null) {
  return artistPhotoApiUrl({ artistId, artistSlug, artistName }, { size: 384, version });
}

export function buildArtistAlbumCover(artistName: string, albumName: string, albumId?: number, albumSlug?: string) {
  return albumCoverApiUrl({ albumId, albumSlug, artistName, albumName }, { size: 512 });
}

export function artistGenreSlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-");
}

export function sortArtistAlbumsByYear(albums: ArtistAlbum[]) {
  return [...albums].sort((a, b) => {
    const yearA = parseInt(a.year) || 0;
    const yearB = parseInt(b.year) || 0;
    return yearB - yearA;
  });
}

export function buildArtistPlayerTrack(
  track: ArtistTopTrack,
  artistName: string,
  coverFallback?: string,
): Track {
  const isPath = track.id.includes("/");
  return {
    id: track.id,
    title: track.title || "Unknown",
    artist: track.artist || artistName,
    artistId: track.artist_id,
    artistSlug: track.artist_slug,
    album: track.album,
    albumId: track.album_id,
    albumSlug: track.album_slug,
    bpm: track.bpm,
    audioKey: track.audio_key,
    audioScale: track.audio_scale,
    energy: track.energy,
    danceability: track.danceability,
    valence: track.valence,
    blissVector: track.bliss_vector,
    albumCover: track.artist && track.album
      ? buildArtistAlbumCover(track.artist, track.album, track.album_id, track.album_slug)
      : coverFallback,
    path: isPath ? track.id : undefined,
  };
}

export function buildArtistShowItems(events: ArtistShowEvent[]) {
  const seenKeys = new Set<string>();
  const deduped: ArtistShowEvent[] = [];

  for (const event of events) {
    const key = event.id || [
      event.artist_name,
      event.date,
      event.venue,
      event.city,
      event.country_code || event.country,
    ].filter(Boolean).join("|").toLowerCase();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(event);
  }

  return deduped.map(artistShowToUpcomingItem);
}
