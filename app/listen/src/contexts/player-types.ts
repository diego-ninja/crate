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
  isSuggested?: boolean;
  suggestionSource?: "playlist";
}

export type RepeatMode = "off" | "one" | "all";

type RadioSeedType = "track" | "album" | "artist" | "playlist";

interface RadioSession {
  seedType: RadioSeedType;
  seedId?: string | number | null;
  seedStorageId?: string | null;
  seedPath?: string | null;
}

export interface PlaySource {
  type: "album" | "playlist" | "radio" | "track" | "queue";
  name: string;
  id?: string | number | null;
  radio?: RadioSession;
}
