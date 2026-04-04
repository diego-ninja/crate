import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
import type { Track } from "@/contexts/PlayerContext";
import type { PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";

export interface SearchArtist {
  name: string;
  album_count: number;
  has_photo: boolean;
}

export interface SearchAlbum {
  id: number;
  artist: string;
  name: string;
  year: string;
  has_cover: boolean;
}

export interface SearchTrack {
  id: number;
  title: string;
  artist: string;
  album: string;
  path: string;
  duration: number;
  navidrome_id: string;
}

export interface SearchResults {
  artists: SearchArtist[];
  albums: SearchAlbum[];
  tracks: SearchTrack[];
}

export interface BrowseFilters {
  genres: { name: string; count: number }[];
  decades: string[];
}

export interface SystemPlaylist {
  id: number;
  name: string;
  description?: string;
  category?: string | null;
  cover_data_url?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  track_count: number;
  follower_count: number;
  is_followed: boolean;
  is_smart: boolean;
}

interface PlaylistDetailTrack {
  id?: number;
  track_id?: number;
  track_path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  navidrome_id?: string;
}

interface PlaylistDetailData {
  id: number;
  name: string;
  cover_data_url?: string | null;
  tracks: PlaylistDetailTrack[];
}

export interface GenreDetail {
  id: number;
  name: string;
  slug: string;
  artists: {
    artist_name: string;
    album_count: number;
    track_count: number;
    has_photo: boolean;
    listeners: number | null;
  }[];
  albums: {
    album_id: number;
    artist: string;
    name: string;
    year: string;
    track_count: number;
    has_cover: boolean;
  }[];
}

export interface DecadeArtists {
  items: { name: string; albums: number; tracks: number; has_photo: boolean }[];
  total: number;
}

export async function loadSystemPlaylistTracks(playlistId: number): Promise<{
  tracks: Track[];
  source: {
    type: "playlist";
    name: string;
    radio: { seedType: "playlist"; seedId: number };
  };
}> {
  const data = await api<PlaylistDetailData>(`/api/curation/playlists/${playlistId}`);
  return {
    tracks: (data.tracks || []).map((track) => ({
      id: track.track_path || String(track.id || track.track_id || Math.random()),
      title: track.title || "Unknown",
      artist: track.artist || "",
      album: track.album || "",
      albumCover:
        track.artist && track.album
          ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}`
          : data.cover_data_url || undefined,
      path: track.track_path,
      libraryTrackId: track.track_id,
      navidromeId: track.navidrome_id,
    })),
    source: {
      type: "playlist",
      name: data.name,
      radio: { seedType: "playlist", seedId: playlistId },
    },
  };
}
