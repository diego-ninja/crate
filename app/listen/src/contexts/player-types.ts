export interface Track {
  id: string;
  storageId?: string;
  title: string;
  artist: string;
  artistId?: number;
  artistSlug?: string;
  album?: string;
  albumId?: number;
  albumSlug?: string;
  albumCover?: string;
  path?: string;
  libraryTrackId?: number;
  format?: string;
  bitrate?: number | null;
  sampleRate?: number | null;
  bitDepth?: number | null;
  isSuggested?: boolean;
  suggestionSource?: "playlist";
}

export type RepeatMode = "off" | "one" | "all";

type RadioSeedType = "track" | "album" | "artist" | "playlist" | "home-playlist" | "genre" | "discovery";

interface RadioSession {
  seedType: RadioSeedType;
  seedId?: string | number | null;
  seedStorageId?: string | null;
  seedPath?: string | null;
  shapedSessionId?: string | null;
}

export interface PlaySource {
  type: "album" | "playlist" | "radio" | "track" | "queue";
  name: string;
  id?: string | number | null;
  href?: string | null;
  radio?: RadioSession;
}
