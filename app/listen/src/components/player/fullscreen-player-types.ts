export type FSPanel = "queue" | "lyrics" | "info";

export interface LyricLine {
  time: number;
  text: string;
}

export type FullscreenLyrics = {
  synced: LyricLine[] | null;
  plain: string | null;
};
