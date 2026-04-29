import type { Track } from "@/contexts/player-types";
import { trackInfoApiPath } from "@/lib/library-routes";

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

export function resolveTrackInfoUrl(track: Pick<Track, "id" | "entityUid" | "libraryTrackId" | "path">): string | null {
  const path = trackInfoApiPath(track);
  return path || null;
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
