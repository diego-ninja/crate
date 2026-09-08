import type { GenreProfileItem } from "@crate/ui/domain/genres/GenrePill";

export interface AlbumTrack {
  id: number | string;
  entity_uid?: string;
  globalTrackUid?: string;
  global_track_uid?: string;
  global_uid?: string;
  filename: string;
  format: string;
  size_mb: number;
  bitrate: number | null;
  sample_rate?: number | null;
  bit_depth?: number | null;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
  length_sec: number;
  rating: number;
  tags: {
    title: string;
    artist: string;
    album: string;
    albumartist: string;
    tracknumber: string;
    discnumber: string;
    date: string;
    genre: string;
    musicbrainz_albumid: string;
    musicbrainz_trackid: string;
  };
  path?: string | null;
  is_available?: boolean;
  source?: string | null;
  source_url?: string | null;
}

export interface AlbumContributor {
  user_id: number;
  user_email?: string | null;
  user_username?: string | null;
  user_name?: string | null;
  user_avatar?: string | null;
  source?: string | null;
  imported_at?: string | null;
}

export interface AlbumData {
  id?: number | null;
  entity_uid?: string;
  global_album_uid?: string;
  global_artist_uid?: string;
  global_uid?: string;
  slug?: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  artist: string;
  name: string;
  display_name: string;
  path: string;
  track_count: number;
  total_size_mb: number;
  total_length_sec: number;
  has_cover: boolean;
  cover_file: string | null;
  cover_url?: string | null;
  tracks: AlbumTrack[];
  album_tags: {
    artist: string;
    album: string;
    year: string;
    genre: string;
    musicbrainz_albumid: string | null;
  };
  genres: string[];
  genre_profile?: GenreProfileItem[];
  contributors?: AlbumContributor[];
  playable_track_count?: number | null;
  is_pre_release?: boolean;
  release_date?: string | null;
  release_status?: string | null;
  release_type?: string | null;
  source_name?: string | null;
  source_url?: string | null;
  availability?: {
    local?: boolean;
    remote?: boolean;
    healthy?: boolean;
    source_name?: string | null;
  };
}
