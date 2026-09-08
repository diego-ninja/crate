import { useEffect, useState } from "react";

import type { Track } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";

import { parseSyncedLyrics, type LyricsData } from "./lyrics-data";

export function useLyrics(currentTrack: Track | null | undefined) {
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentTrack) {
      setLyrics(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();

    setLyrics(null);
    setLoading(true);

    api<{ syncedLyrics: string | null; plainLyrics: string | null }>(
      `/api/lyrics?artist=${encodeURIComponent(
        currentTrack.artist,
      )}&title=${encodeURIComponent(currentTrack.title)}`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setLyrics({
          synced: data.syncedLyrics
            ? parseSyncedLyrics(data.syncedLyrics)
            : null,
          plain: data.plainLyrics || null,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted || (error as Error).name === "AbortError")
          return;
        setLyrics({ synced: null, plain: null });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [currentTrack?.id, currentTrack?.artist, currentTrack?.title]);

  return { lyrics, loading };
}
