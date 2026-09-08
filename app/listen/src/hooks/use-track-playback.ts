import { startTransition, useEffect, useMemo, useState } from "react";

import type { Track } from "@/contexts/player-types";
import {
  __resetTrackPlaybackCacheForTests as resetTrackPlaybackCache,
  fetchTrackPlayback,
  getCachedTrackPlayback,
  type PlaybackResolution,
  resolveTrackPlaybackUrl,
} from "@/lib/track-playback";
import type { PlaybackDeliveryPolicy } from "@/lib/player-playback-prefs";

export interface UseTrackPlaybackOptions {
  enabled?: boolean;
}

export interface UseTrackPlaybackState {
  resolution: PlaybackResolution | null;
  loading: boolean;
}

export function useTrackPlayback(
  track:
    | Pick<
        Track,
        "id" | "globalTrackUid" | "entityUid" | "libraryTrackId" | "path"
      >
    | undefined,
  policy: PlaybackDeliveryPolicy,
  options: UseTrackPlaybackOptions = {},
): UseTrackPlaybackState {
  const { enabled = true } = options;
  const url = useMemo(
    () => (enabled && track ? resolveTrackPlaybackUrl(track, policy) : null),
    [enabled, policy, track],
  );

  const [resolution, setResolution] = useState<PlaybackResolution | null>(() =>
    url ? getCachedTrackPlayback(url) : null,
  );
  const [loading, setLoading] = useState(() =>
    Boolean(url && !getCachedTrackPlayback(url)),
  );

  useEffect(() => {
    if (!enabled || !url || !track) {
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

    fetchTrackPlayback(track, policy)
      .then((nextResolution) => {
        if (cancelled) return;
        if (!nextResolution) return;
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
  }, [enabled, policy, track, url]);

  return { resolution, loading };
}

export function __resetTrackPlaybackCacheForTests(): void {
  resetTrackPlaybackCache();
}
