import { useEffect, useMemo, useState, type RefObject } from "react";

import type { Track } from "@/contexts/player-types";
import { api } from "@/lib/api";

export interface LyricLine {
  time: number;
  text: string;
}

export function parseSyncedLyrics(raw: string): LyricLine[] {
  return raw.split("\n").reduce<LyricLine[]>((acc, line) => {
    const match = line.match(/^\[(\d+):(\d+)\.(\d+)\](.*)/);
    if (match) {
      acc.push({
        time: +match[1]! * 60 + +match[2]! + +match[3]! / 100,
        text: match[4]!.trim(),
      });
    }
    return acc;
  }, []);
}

type FullscreenPlayerLyricsProps = {
  activeLyricRef: RefObject<HTMLButtonElement | null>;
  activePanel: string | null;
  currentTime: number;
  currentTrack: Track | null;
  visible: boolean;
};

export function useFullscreenPlayerLyrics({
  activeLyricRef,
  activePanel,
  currentTime,
  currentTrack,
  visible,
}: FullscreenPlayerLyricsProps) {
  const [lyrics, setLyrics] = useState<{
    synced: LyricLine[] | null;
    plain: string | null;
  } | null>(null);

  useEffect(() => {
    if (!visible || activePanel !== "lyrics" || !currentTrack) {
      if (!visible || !currentTrack) setLyrics(null);
      return;
    }
    const controller = new AbortController();
    setLyrics(null);
    api<{ syncedLyrics: string | null; plainLyrics: string | null }>(
      `/api/lyrics?artist=${encodeURIComponent(
        currentTrack.artist || "",
      )}&title=${encodeURIComponent(currentTrack.title || "")}`,
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
      .catch(() => {
        if (!controller.signal.aborted) {
          setLyrics({ synced: null, plain: null });
        }
      });
    return () => controller.abort();
  }, [
    activePanel,
    currentTrack?.artist,
    currentTrack?.id,
    currentTrack?.title,
    visible,
  ]);

  const activeLyricIndex = useMemo(() => {
    if (!lyrics?.synced) return -1;
    for (let index = lyrics.synced.length - 1; index >= 0; index -= 1) {
      if (currentTime >= lyrics.synced[index]!.time) return index;
    }
    return -1;
  }, [currentTime, lyrics]);

  useEffect(() => {
    if (activePanel !== "lyrics" || !activeLyricRef.current) return;
    activeLyricRef.current.scrollIntoView?.({
      behavior: "smooth",
      block: "center",
    });
  }, [activeLyricIndex, activeLyricRef, activePanel]);

  return { activeLyricIndex, lyrics };
}
