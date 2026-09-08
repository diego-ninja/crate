export interface PathEndpoint {
  type: string;
  value: string;
  label: string;
}

export interface PathSummary {
  id: number;
  name: string;
  origin: PathEndpoint;
  destination: PathEndpoint;
  waypoints: PathEndpoint[];
  step_count: number;
  track_count: number;
  created_at: string;
}

export interface PathTrack {
  step: number;
  progress: number;
  track_id: number;
  entity_uid?: string;
  title: string;
  artist: string;
  artist_entity_uid?: string;
  album?: string;
  album_id?: number;
  album_entity_uid?: string;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
  distance: number;
}

export interface PathDetail extends Omit<PathSummary, "track_count"> {
  tracks: PathTrack[];
}

export type EndpointType = "artist" | "genre" | "album" | "track";

export interface SearchResult {
  type: EndpointType;
  value: string;
  label: string;
  imageUrl?: string;
  artistId?: number;
  artistEntityUid?: string;
  artistSlug?: string;
  albumId?: number;
  albumEntityUid?: string;
}
