import type { Track } from "@/contexts/PlayerContext";

export function formatPlayerTime(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "0:00";
  const totalMinutes = Math.floor(seconds / 60);
  const totalSeconds = Math.floor(seconds % 60);
  return `${totalMinutes}:${totalSeconds.toString().padStart(2, "0")}`;
}

export function formatPlayerTrackBadge(track: { id: string }): string | null {
  const id = track.id.toLowerCase();
  if (id.endsWith(".flac")) return "FLAC";
  if (id.endsWith(".mp3")) return "MP3";
  if (id.endsWith(".ogg")) return "OGG";
  if (id.endsWith(".opus")) return "OPUS";
  if (id.endsWith(".m4a") || id.endsWith(".aac")) return "AAC";
  if (id.endsWith(".wav")) return "WAV";
  return null;
}

export function generateWaveformBars(seed: string, count: number): number[] {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }

  const bars: number[] = [];
  for (let index = 0; index < count; index += 1) {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    bars.push(0.15 + ((hash % 1000) / 1000) * 0.85);
  }
  return bars;
}

export function currentTrackToPlaylistSeed(track: Track, duration: number) {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: duration || 0,
    path: track.path,
    libraryTrackId: track.libraryTrackId,
  };
}
