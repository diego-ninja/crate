import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";

interface LyricLine {
  time: number;
  text: string;
}

interface LyricsData {
  synced: LyricLine[] | null;
  plain: string | null;
}
function parseSyncedLyrics(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const line of lrc.split("\n")) {
    const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/);
    if (match) {
      const min = parseInt(match[1]!);
      const sec = parseInt(match[2]!);
      const ms = parseInt(match[3]!.padEnd(3, "0"));
      const time = min * 60 + sec + ms / 1000;
      const text = match[4]!.trim();
      if (text) lines.push({ time, text });
    }
  }
  return lines;
}

export function LyricsTab({ useAlbumPalette }: { useAlbumPalette: boolean }) {
  void useAlbumPalette;
  const { currentTime } = usePlayer();
  const { currentTrack, seek } = usePlayerActions();
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!currentTrack) return;
    const controller = new AbortController();

    setLyrics(null);
    setLoading(true);

    api<{ syncedLyrics: string | null; plainLyrics: string | null }>(`/api/lyrics?artist=${encodeURIComponent(currentTrack.artist)}&title=${encodeURIComponent(currentTrack.title)}`)
      .then((data) => {
        setLyrics({
          synced: data.syncedLyrics ? parseSyncedLyrics(data.syncedLyrics) : null,
          plain: data.plainLyrics || null,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted || (error as Error).name === "AbortError") return;
        setLyrics({ synced: null, plain: null });
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [currentTrack?.id, currentTrack?.artist, currentTrack?.title]);

  const activeIndex = useMemo(() => {
    if (!lyrics?.synced) return -1;
    for (let i = lyrics.synced.length - 1; i >= 0; i--) {
      if (currentTime >= lyrics.synced[i]!.time) {
        return i;
      }
    }
    return -1;
  }, [currentTime, lyrics?.synced]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!lyrics?.synced && !lyrics?.plain) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-white/20">
        No lyrics found
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="lyrics-mask relative flex-1 overflow-y-auto pr-1"
      style={{
        background: "linear-gradient(180deg, rgba(6,182,212,0.12) 0%, transparent 28%, transparent 72%, rgba(6,182,212,0.06) 100%)",
      }}
    >
      {lyrics?.synced ? (
        <div className="space-y-1 px-1" style={{ paddingTop: "34vh", paddingBottom: "34vh" }}>
          {lyrics.synced.map((line, index) => {
            const isActive = index === activeIndex;
            const isPast = index < activeIndex;
            return (
              <button
                key={`${line.time}-${index}`}
                ref={isActive ? activeRef : null}
                onClick={() => seek(line.time)}
                className={`relative z-20 w-full rounded-md px-2 py-1 text-left transition-all duration-500 ${
                  isActive
                    ? "bg-primary/10 text-[17px] font-semibold text-primary"
                    : isPast
                      ? "text-[14px] text-white/25"
                      : "text-[14px] text-white/50"
                }`}
                style={
                  isActive
                    ? {
                        textShadow: "0 0 20px rgba(6,182,212,0.28)",
                      }
                    : undefined
                }
              >
                {line.text}
              </button>
            );
          })}
        </div>
      ) : null}

      {!lyrics?.synced && lyrics?.plain ? (
        <pre className="whitespace-pre-wrap py-2 font-sans text-[14px] leading-relaxed text-muted-foreground">
          {lyrics.plain}
        </pre>
      ) : null}
    </div>
  );
}
