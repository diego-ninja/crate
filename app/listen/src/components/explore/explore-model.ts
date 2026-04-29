import { api } from "@/lib/api";
import type { Track } from "@/contexts/PlayerContext";
import type { PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";

export interface SearchArtist {
  id?: number;
  entity_uid?: string;
  slug?: string;
  name: string;
  album_count: number;
  has_photo: boolean;
}

export interface SearchAlbum {
  id: number;
  entity_uid?: string;
  slug?: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  name: string;
  year: string;
  has_cover: boolean;
}

export interface SearchTrack {
  id: number;
  entity_uid?: string;
  slug?: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_entity_uid?: string;
  album_slug?: string;
  path: string;
  duration: number;
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
  track_entity_uid?: string;
  track_path: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_entity_uid?: string;
  album_slug?: string;
  duration: number;
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
    artist_id?: number;
    artist_slug?: string;
    album_count: number;
    track_count: number;
    has_photo: boolean;
    listeners: number | null;
  }[];
  albums: {
    album_id: number;
    album_slug?: string;
    artist: string;
    artist_id?: number;
    artist_slug?: string;
    name: string;
    year: string;
    track_count: number;
    has_cover: boolean;
  }[];
}

export interface DecadeArtists {
  items: { id?: number; slug?: string; name: string; albums: number; tracks: number; has_photo: boolean }[];
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
    tracks: (data.tracks || []).map((track) =>
      toPlayableTrack(track, {
        cover:
          track.artist && track.album
            ? albumCoverApiUrl({
                albumId: track.album_id,
                albumEntityUid: track.album_entity_uid,
                artistEntityUid: track.artist_entity_uid,
                albumSlug: track.album_slug,
                artistName: track.artist,
                albumName: track.album,
              })
            : data.cover_data_url || undefined,
      }),
    ),
    source: {
      type: "playlist",
      name: data.name,
      radio: { seedType: "playlist", seedId: playlistId },
    },
  };
}
