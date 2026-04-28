import type { Track } from "@/contexts/player-types";

export interface BlissSignature {
  texture: number | null;
  motion: number | null;
  density: number | null;
}

export interface TrackInfo {
  title: string | null;
  artist: string | null;
  album: string | null;
  format: string | null;
  bitrate: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  bpm: number | null;
  audio_key: string | null;
  audio_scale: string | null;
  energy: number | null;
  danceability: number | null;
  valence: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  loudness: number | null;
  dynamic_range: number | null;
  mood_json: Record<string, unknown> | unknown[] | string | null;
  lastfm_listeners: number | null;
  lastfm_playcount: number | null;
  popularity: number | null;
  rating: number | null;
  bliss_signature: BlissSignature | null;
}

export function resolveTrackInfoUrl(track: Pick<Track, "id" | "libraryTrackId" | "storageId" | "path">): string | null {
  const resolvedId = track.libraryTrackId ?? (
    /^\d+$/.test(track.id) ? Number(track.id) : null
  );

  if (resolvedId != null) {
    return `/api/tracks/${resolvedId}/info`;
  }

  if (track.storageId) {
    return `/api/tracks/by-storage/${encodeURIComponent(track.storageId)}/info`;
  }

  const playbackPath = track.path || track.id;
  if (!playbackPath) return null;

  return `/api/track-info/${encodeURIComponent(
    playbackPath.startsWith("/music/") ? playbackPath.slice(7) : playbackPath,
  ).replace(/%2F/g, "/")}`;
}

export function getTrackQualityFallback(track: Pick<Track, "format" | "bitrate" | "sampleRate" | "bitDepth">) {
  return {
    format: track.format,
    bitrate: track.bitrate,
    sampleRate: track.sampleRate,
    bitDepth: track.bitDepth,
  };
}

export function getTrackQualityFromInfo(info: TrackInfo | null) {
  if (!info) {
    return {
      format: undefined,
      bitrate: undefined,
      sampleRate: undefined,
      bitDepth: undefined,
    };
  }

  return {
    format: info.format || undefined,
    bitrate: info.bitrate ?? undefined,
    sampleRate: info.sample_rate ?? undefined,
    bitDepth: info.bit_depth ?? undefined,
  };
}
