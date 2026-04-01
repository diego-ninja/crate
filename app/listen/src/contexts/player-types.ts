export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumCover?: string;
  path?: string;
  navidromeId?: string;
  libraryTrackId?: number;
  isSuggested?: boolean;
  suggestionSource?: "playlist";
}

export type RepeatMode = "off" | "one" | "all";

type RadioSeedType = "track" | "album" | "artist" | "playlist";

interface RadioSession {
  seedType: RadioSeedType;
  seedId?: string | number | null;
  seedPath?: string | null;
}

export interface PlaySource {
  type: "album" | "playlist" | "radio" | "track" | "queue";
  name: string;
  id?: string | number | null;
  radio?: RadioSession;
}
