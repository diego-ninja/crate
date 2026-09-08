import { useEffect, useState } from "react";

import type { Track } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";

export interface SimilarTrack {
  path: string;
  track_entity_uid?: string;
  track_id?: number;
  title: string;
  artist: string;
  album: string;
  duration: number;
  score: number;
}

export function useSuggestedTracks(currentTrack: Track | null | undefined) {
  const [tracks, setTracks] = useState<SimilarTrack[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentTrack) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: "15" });
    setLoading(true);
    setTracks([]);

    if (currentTrack.libraryTrackId != null) {
      params.set("track_id", String(currentTrack.libraryTrackId));
    } else if (currentTrack.path) {
      params.set("path", currentTrack.path);
    } else {
      setTracks([]);
      setLoading(false);
      return;
    }

    api<{ tracks: SimilarTrack[] }>(
      `/api/similar-tracks?${params.toString()}`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) setTracks(data.tracks || []);
      })
      .catch((error) => {
        if (controller.signal.aborted || (error as Error).name === "AbortError")
          return;
        setTracks([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [currentTrack?.id, currentTrack?.libraryTrackId, currentTrack?.path]);

  return { tracks, loading };
}
