import { type Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";

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
  albums: ArtistAlbum[];
  total_tracks: number;
  total_size_mb: number;
  primary_format: string | null;
  genres: string[];
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

export function buildArtistPhotoUrl(artistName: string, artistId?: number, artistSlug?: string) {
  return artistPhotoApiUrl({ artistId, artistSlug, artistName });
}

export function buildArtistAlbumCover(artistName: string, albumName: string, albumId?: number, albumSlug?: string) {
  return albumCoverApiUrl({ albumId, albumSlug, artistName, albumName });
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
    albumCover: track.artist && track.album
      ? buildArtistAlbumCover(track.artist, track.album, track.album_id, track.album_slug)
      : coverFallback,
    path: isPath ? track.id : undefined,
    navidromeId: isPath ? undefined : track.id,
  };
}

export function buildArtistShowItems(events: ArtistShowEvent[]) {
  return events.map(artistShowToUpcomingItem);
}
