import type { TrackRowData } from "@/components/cards/TrackRow";
import type { PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import type { Track } from "@/contexts/PlayerContext";

export interface CuratedPlaylistTrack {
  id: number;
  playlist_id: number;
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
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
  position: number;
  added_at: string;
}

export interface CuratedPlaylistData {
  id: number;
  name: string;
  description?: string;
  cover_data_url?: string | null;
  is_smart: boolean;
  is_curated: boolean;
  category?: string | null;
  track_count: number;
  total_duration: number;
  artwork_tracks?: PlaylistArtworkTrack[];
  follower_count: number;
  is_followed: boolean;
  tracks: CuratedPlaylistTrack[];
}

export interface CuratedTrackListProps {
  tracks: CuratedPlaylistTrack[];
  playlistOptions?: { id: number; name: string }[];
  onAddToPlaylist: (
    playlistId: number,
    track: TrackRowData,
  ) => void | Promise<void>;
  onCreatePlaylist: (track: TrackRowData) => void | Promise<void>;
  onActionMenuOpen: () => void;
  onPlayTrack: (trackEntryId: number) => void;
}

export type CuratedPlayerTracks = Track[];
