import { startTransition, useEffect, useMemo, useState } from "react";

import type { Track } from "@/contexts/player-types";
import { api } from "@/lib/api";
import type { TrackInfo } from "@/lib/track-info";
import { resolveTrackInfoUrl } from "@/lib/track-info";

interface CacheEntry {
  info: TrackInfo;
  timestamp: number;
}

export interface UseTrackInfoOptions {
  enabled?: boolean;
}

export interface UseTrackInfoState {
  info: TrackInfo | null;
  loading: boolean;
}

const TRACK_INFO_TTL_MS = 15 * 60 * 1000;
const trackInfoCache = new Map<string, CacheEntry>();
const inflightTrackInfo = new Map<string, Promise<TrackInfo>>();

function getCachedTrackInfo(url: string): TrackInfo | null {
  const cached = trackInfoCache.get(url);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > TRACK_INFO_TTL_MS) {
    trackInfoCache.delete(url);
    return null;
  }
  return cached.info;
}

async function loadTrackInfo(url: string): Promise<TrackInfo> {
  const cached = getCachedTrackInfo(url);
  if (cached) return cached;

  const existing = inflightTrackInfo.get(url);
  if (existing) return existing;

  const request = api<TrackInfo>(url).then((info) => {
    trackInfoCache.set(url, { info, timestamp: Date.now() });
    return info;
  }).finally(() => {
    inflightTrackInfo.delete(url);
  });

  inflightTrackInfo.set(url, request);
  return request;
}

export function useTrackInfo(
  track: Pick<Track, "id" | "libraryTrackId" | "storageId" | "path"> | undefined,
  options: UseTrackInfoOptions = {},
): UseTrackInfoState {
  const { enabled = true } = options;
  const url = useMemo(
    () => (enabled && track ? resolveTrackInfoUrl(track) : null),
    [enabled, track?.id, track?.libraryTrackId, track?.path, track?.storageId],
  );

  const [info, setInfo] = useState<TrackInfo | null>(() => (url ? getCachedTrackInfo(url) : null));
  const [loading, setLoading] = useState(() => Boolean(url && !getCachedTrackInfo(url)));

  useEffect(() => {
    if (!enabled || !url) {
      setInfo(null);
      setLoading(false);
      return;
    }

    const cached = getCachedTrackInfo(url);
    if (cached) {
      setInfo(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setInfo(null);
    setLoading(true);

    loadTrackInfo(url)
      .then((nextInfo) => {
        if (cancelled) return;
        startTransition(() => {
          setInfo(nextInfo);
        });
      })
      .catch(() => {
        if (!cancelled) {
          setInfo(null);
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

  return { info, loading };
}

export function __resetTrackInfoCacheForTests(): void {
  trackInfoCache.clear();
  inflightTrackInfo.clear();
}
