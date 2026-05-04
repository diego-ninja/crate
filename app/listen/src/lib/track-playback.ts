import type { Track } from "@/contexts/player-types";
import { trackPlaybackApiPath } from "@/lib/library-routes";
import type { PlaybackDeliveryPolicy } from "@/lib/player-playback-prefs";

export interface PlaybackQuality {
  format: string | null;
  codec: string | null;
  bitrate: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  bytes: number | null;
  lossless: boolean | null;
  fallback?: boolean | null;
  reason?: string | null;
}

export interface PlaybackResolution {
  stream_url: string;
  requested_policy: string;
  effective_policy: string;
  source: PlaybackQuality;
  delivery: PlaybackQuality;
  transcoded: boolean;
  cache_hit: boolean;
  preparing: boolean;
  task_id: string | null;
  variant_id: string | null;
  variant_status: string | null;
}

export function resolveTrackPlaybackUrl(
  track: Pick<Track, "id" | "entityUid" | "libraryTrackId" | "path">,
  policy: PlaybackDeliveryPolicy,
): string | null {
  const path = trackPlaybackApiPath(track);
  if (!path) return null;
  return policy === "original" ? path : `${path}?delivery=${encodeURIComponent(policy)}`;
}

export function getTrackQualityFromPlaybackQuality(
  quality: PlaybackQuality | null | undefined,
  options: { preferCodec?: boolean } = {},
) {
  if (!quality) {
    return {
      format: undefined,
      bitrate: undefined,
      sampleRate: undefined,
      bitDepth: undefined,
    };
  }

  const format = options.preferCodec ? quality.codec || quality.format : quality.format || quality.codec;
  return {
    format: format || undefined,
    bitrate: quality.bitrate ?? undefined,
    sampleRate: quality.sample_rate ?? undefined,
    bitDepth: quality.bit_depth ?? undefined,
  };
}
