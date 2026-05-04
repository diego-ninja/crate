import { startTransition, useEffect, useMemo, useState } from "react";

import type { Track } from "@/contexts/player-types";
import { api } from "@/lib/api";
import type { PlaybackResolution } from "@/lib/track-playback";
import { resolveTrackPlaybackUrl } from "@/lib/track-playback";
import type { PlaybackDeliveryPolicy } from "@/lib/player-playback-prefs";

interface CacheEntry {
  resolution: PlaybackResolution;
  timestamp: number;
}

export interface UseTrackPlaybackOptions {
  enabled?: boolean;
}

export interface UseTrackPlaybackState {
  resolution: PlaybackResolution | null;
  loading: boolean;
}

const TRACK_PLAYBACK_TTL_MS = 30 * 1000;
const trackPlaybackCache = new Map<string, CacheEntry>();
const inflightTrackPlayback = new Map<string, Promise<PlaybackResolution>>();

function getCachedTrackPlayback(url: string): PlaybackResolution | null {
  const cached = trackPlaybackCache.get(url);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > TRACK_PLAYBACK_TTL_MS) {
    trackPlaybackCache.delete(url);
    return null;
  }
  return cached.resolution;
}

async function loadTrackPlayback(url: string): Promise<PlaybackResolution> {
  const cached = getCachedTrackPlayback(url);
  if (cached) return cached;

  const existing = inflightTrackPlayback.get(url);
  if (existing) return existing;

  const request = api<PlaybackResolution>(url).then((resolution) => {
    trackPlaybackCache.set(url, { resolution, timestamp: Date.now() });
    return resolution;
  }).finally(() => {
    inflightTrackPlayback.delete(url);
  });

  inflightTrackPlayback.set(url, request);
  return request;
}

export function useTrackPlayback(
  track: Pick<Track, "id" | "entityUid" | "libraryTrackId" | "path"> | undefined,
  policy: PlaybackDeliveryPolicy,
  options: UseTrackPlaybackOptions = {},
): UseTrackPlaybackState {
  const { enabled = true } = options;
  const url = useMemo(
    () => (enabled && track ? resolveTrackPlaybackUrl(track, policy) : null),
    [enabled, policy, track?.id, track?.entityUid, track?.libraryTrackId, track?.path],
  );

  const [resolution, setResolution] = useState<PlaybackResolution | null>(() => (url ? getCachedTrackPlayback(url) : null));
  const [loading, setLoading] = useState(() => Boolean(url && !getCachedTrackPlayback(url)));

  useEffect(() => {
    if (!enabled || !url) {
      setResolution(null);
      setLoading(false);
      return;
    }

    const cached = getCachedTrackPlayback(url);
    if (cached) {
      setResolution(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setResolution(null);
    setLoading(true);

    loadTrackPlayback(url)
      .then((nextResolution) => {
        if (cancelled) return;
        startTransition(() => {
          setResolution(nextResolution);
        });
      })
      .catch(() => {
        if (!cancelled) {
          setResolution(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, url]);

  return { resolution, loading };
}

export function __resetTrackPlaybackCacheForTests(): void {
  trackPlaybackCache.clear();
  inflightTrackPlayback.clear();
}
