export interface LyricLine {
  time: number;
  text: string;
}

export interface LyricsData {
  synced: LyricLine[] | null;
  plain: string | null;
}

export function parseSyncedLyrics(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const line of lrc.split("\n")) {
    const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/);
    if (match) {
      const min = parseInt(match[1]!);
      const sec = parseInt(match[2]!);
      const ms = parseInt(match[3]!.padEnd(3, "0"));
      const time = min * 60 + sec + ms / 1000;
      const text = match[4]!.trim();
      if (text) lines.push({ time, text });
    }
  }
  return lines;
}
