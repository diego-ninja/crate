import type { Track } from "@/contexts/PlayerContext";

export function formatPlayerTime(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "0:00";
  const totalMinutes = Math.floor(seconds / 60);
  const totalSeconds = Math.floor(seconds % 60);
  return `${totalMinutes}:${totalSeconds.toString().padStart(2, "0")}`;
}

function formatSampleRate(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}`;
  return String(hz);
}

function formatBitrateKbps(kbps: number): string {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)}M`;
  return String(kbps);
}

export type QualityTier = "hi-res" | "lossless" | "high" | "standard" | "low";

export interface QualityBadge {
  label: string;
  detail: string;
  tier: QualityTier;
}

function inferFormatFromId(id: string): string {
  const lower = id.toLowerCase();
  if (lower.endsWith(".flac")) return "flac";
  if (lower.endsWith(".mp3")) return "mp3";
  if (lower.endsWith(".ogg")) return "ogg";
  if (lower.endsWith(".opus")) return "opus";
  if (lower.endsWith(".m4a") || lower.endsWith(".aac")) return "aac";
  if (lower.endsWith(".wav")) return "wav";
  return "";
}

function classifyTier(fmt: string, bitDepth?: number | null, sampleRate?: number | null, bitrate?: number | null): QualityTier {
  const lossless = fmt === "flac" || fmt === "wav" || fmt === "alac";
  if (lossless) {
    if ((bitDepth && bitDepth > 16) || (sampleRate && sampleRate > 48000)) return "hi-res";
    return "lossless";
  }
  if (bitrate) {
    if (bitrate >= 256) return "high";
    if (bitrate >= 128) return "standard";
    return "low";
  }
  return "standard";
}

export function getTrackQualityBadge(track: Track): QualityBadge | null {
  const fmt = (track.format || "").toLowerCase()
    || inferFormatFromId(track.path || "")
    || inferFormatFromId(track.id);
  if (!fmt) return null;

  const sr = track.sampleRate;
  const bd = track.bitDepth;
  const br = track.bitrate;
  const tier = classifyTier(fmt, bd, sr, br);

  const lossless = fmt === "flac" || fmt === "wav" || fmt === "alac";
  const fmtLabel = fmt === "m4a" || fmt === "aac" ? "AAC" : fmt.toUpperCase();

  if (lossless) {
    const detail = bd && sr ? `${bd}-bit / ${formatSampleRate(sr)} kHz` : sr ? `${formatSampleRate(sr)} kHz` : "";
    if (tier === "hi-res" && bd && sr) {
      return { label: `Hi-Res ${bd}/${formatSampleRate(sr)}`, detail, tier };
    }
    const label = bd && sr ? `${fmtLabel} ${bd}/${formatSampleRate(sr)}` : fmtLabel;
    return { label, detail, tier };
  }

  const detail = br ? `${formatBitrateKbps(br)} kbps` : "";
  const label = br ? `${fmtLabel} ${formatBitrateKbps(br)}` : fmtLabel;
  return { label, detail, tier };
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
