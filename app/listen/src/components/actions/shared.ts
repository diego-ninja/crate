import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";

import { buildArtistPlayerTrack, type ArtistTopTrack } from "@/components/artist/artist-model";
import type { ItemActionMenuEntry } from "@/components/actions/ItemActionMenu";
import type { Track } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import {
  albumApiPath,
  albumCoverApiUrl,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

export interface MenuActionConfig {
  key: string;
  label: string;
  icon?: LucideIcon;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
}

export interface TrackMenuData {
  id?: string | number;
  storage_id?: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  album?: string;
  album_id?: number;
  album_slug?: string;
  duration?: number;
  path?: string;
  library_track_id?: number;
  is_suggested?: boolean;
  suggestion_source?: "playlist";
}

export interface AlbumMenuData {
  artist: string;
  album: string;
  albumId?: number;
  albumSlug?: string;
  cover?: string;
}

export interface ArtistMenuData {
  artistId?: number;
  artistSlug?: string;
  name: string;
}

export interface PlaylistMenuData {
  playlistId?: number;
  name: string;
  href?: string;
  canFollow?: boolean;
  isFollowed?: boolean;
  onToggleFollow?: () => Promise<void> | void;
  onPlay?: () => Promise<void> | void;
  onShuffle?: () => Promise<void> | void;
  onStartRadio?: () => Promise<void> | void;
}

/** Normalize any full `Track` (camelCase) into the menu-friendly shape preserving suggestion metadata. */
export function trackToMenuData(track: Track): TrackMenuData {
  return {
    id: track.id,
    storage_id: track.storageId,
    title: track.title,
    artist: track.artist,
    artist_id: track.artistId,
    artist_slug: track.artistSlug,
    album: track.album,
    album_id: track.albumId,
    album_slug: track.albumSlug,
    path: track.path,
    library_track_id: track.libraryTrackId,
    is_suggested: track.isSuggested,
    suggestion_source: track.suggestionSource,
  };
}

/** Rebuild a player-ready Track from menu data, honoring optional cover override and carrying metadata. */
export function buildTrackMenuPlayerTrack(track: TrackMenuData, cover?: string): Track {
  const playbackId = track.storage_id || track.path || String(track.id || "");
  const resolvedCover = cover || (track.album_id != null
    ? albumCoverApiUrl({
        albumId: track.album_id,
        albumSlug: track.album_slug,
        artistName: track.artist,
        albumName: track.album,
      })
    : undefined);

  return {
    id: playbackId,
    storageId: track.storage_id,
    title: track.title || "Unknown",
    artist: track.artist,
    artistId: track.artist_id,
    artistSlug: track.artist_slug,
    album: track.album,
    albumId: track.album_id,
    albumSlug: track.album_slug,
    albumCover: resolvedCover,
    path: track.path,
    libraryTrackId: track.library_track_id ?? (typeof track.id === "number" ? track.id : undefined),
    isSuggested: track.is_suggested,
    suggestionSource: track.suggestion_source,
  };
}

export function action(config: MenuActionConfig): ItemActionMenuEntry {
  return {
    key: config.key,
    label: config.label,
    icon: config.icon,
    active: config.active,
    danger: config.danger,
    disabled: config.disabled,
    onSelect: config.onSelect,
  };
}

export function sharePath(path: string, label: string) {
  return async () => {
    const url = `${window.location.origin}${path}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: label, text: label, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
      }
    } catch {
      toast.error("Failed to share");
    }
  };
}

export async function fetchAlbumTracks(data: AlbumMenuData): Promise<Track[]> {
  const response = await api<{
    artist: string;
    name: string;
    display_name: string;
    tracks: Array<{
      id: number;
      storage_id?: string;
      filename: string;
      path: string;
      length_sec: number;
      tags: { title: string };
    }>;
  }>(albumApiPath({
    albumId: data.albumId,
    albumSlug: data.albumSlug,
    artistName: data.artist,
    albumName: data.album,
  }));

  const coverUrl = data.cover || albumCoverApiUrl({
    albumId: data.albumId,
    albumSlug: data.albumSlug,
    artistName: data.artist,
    albumName: data.album,
  });

  return (response.tracks || []).map((track) => ({
    id: track.storage_id || track.path || String(track.id),
    storageId: track.storage_id,
    title: track.tags?.title || track.filename || "Unknown",
    artist: response.artist,
    album: response.display_name || response.name,
    albumId: data.albumId,
    albumSlug: data.albumSlug,
    albumCover: coverUrl || undefined,
    path: track.path,
    libraryTrackId: track.id,
  }));
}

export async function fetchArtistTopTracks(artist: ArtistMenuData): Promise<Track[]> {
  if (artist.artistId == null) return [];
  const topTracks = await api<ArtistTopTrack[]>(`/api/artists/${artist.artistId}/top-tracks?count=12`);
  const coverFallback = artistPhotoApiUrl({
    artistId: artist.artistId,
    artistSlug: artist.artistSlug,
    artistName: artist.name,
  }) || undefined;
  return (topTracks || []).map((track) => buildArtistPlayerTrack(track, artist.name, coverFallback));
}
