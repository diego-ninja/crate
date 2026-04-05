import { type Track } from "@/contexts/PlayerContext";
import { encPath } from "@/lib/utils";

import { artistShowToUpcomingItem, type ArtistShowEvent } from "@/components/upcoming/UpcomingRows";

export interface ArtistAlbum {
  id: number;
  name: string;
  display_name: string;
  tracks: number;
  formats: string[];
  size_mb: number;
  year: string;
  has_cover: boolean;
}

export interface ArtistData {
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
  similar: { name: string; match: number }[];
  listeners: number;
  playcount: number;
  image_url: string | null;
  url: string;
}

export interface ArtistTopTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  track: number;
}

export interface StatsArtist {
  artist_name: string;
  play_count: number;
  complete_play_count: number;
  minutes_listened: number;
}

export interface StatsListResponse<T> {
  window: string;
  items: T[];
}

export function buildArtistPhotoUrl(artistName: string) {
  return `/api/artist/${encPath(artistName)}/photo`;
}

export function buildArtistAlbumCover(artistName: string, albumName: string) {
  return `/api/cover/${encPath(artistName)}/${encPath(albumName)}`;
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
    album: track.album,
    albumCover: track.artist && track.album
      ? buildArtistAlbumCover(track.artist, track.album)
      : coverFallback,
    path: isPath ? track.id : undefined,
    navidromeId: isPath ? undefined : track.id,
  };
}

export function buildArtistShowItems(events: ArtistShowEvent[]) {
  return events.map(artistShowToUpcomingItem);
}
