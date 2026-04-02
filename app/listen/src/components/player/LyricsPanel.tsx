import { useState, useEffect, useRef, useMemo } from "react";
import { X, Loader2 } from "lucide-react";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { extractPalette } from "@/lib/palette";
import {
  getUseAlbumPalettePreference,
  PLAYER_VIZ_PREFS_EVENT,
} from "@/lib/player-visualizer-prefs";

interface LyricLine {
  time: number;
  text: string;
}

interface LyricsData {
  synced: LyricLine[] | null;
  plain: string | null;
}

type PaletteTriplet = [number, number, number];

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

function cssColor(color: PaletteTriplet, alpha = 1): string {
  const [r, g, b] = color.map((value) => Math.round(value * 255));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface LyricsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function LyricsPanel({ open, onClose }: LyricsPanelProps) {
  const { currentTime } = usePlayer();
  const { currentTrack, seek } = usePlayerActions();
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [palette, setPalette] = useState<{
    primary: PaletteTriplet;
    secondary: PaletteTriplet;
    accent: PaletteTriplet;
  } | null>(null);
  const [useAlbumPalette, setUseAlbumPalette] = useState(getUseAlbumPalettePreference);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const syncPreference = () => setUseAlbumPalette(getUseAlbumPalettePreference());
    window.addEventListener("storage", syncPreference);
    window.addEventListener(PLAYER_VIZ_PREFS_EVENT, syncPreference as EventListener);
    return () => {
      window.removeEventListener("storage", syncPreference);
      window.removeEventListener(PLAYER_VIZ_PREFS_EVENT, syncPreference as EventListener);
    };
  }, []);

  // Fetch lyrics when track changes
  useEffect(() => {
    if (!open || !currentTrack) return;
    setLyrics(null);
    setLoading(true);

    const params = new URLSearchParams({
      artist_name: currentTrack.artist,
      track_name: currentTrack.title,
    });

    fetch(`https://lrclib.net/api/get?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) {
          setLyrics({ synced: null, plain: null });
          return;
        }
        const synced = data.syncedLyrics ? parseSyncedLyrics(data.syncedLyrics) : null;
        const plain = data.plainLyrics || null;
        setLyrics({ synced, plain });
      })
      .catch(() => setLyrics({ synced: null, plain: null }))
      .finally(() => setLoading(false));
  }, [open, currentTrack?.id]);

  useEffect(() => {
    if (!open || !useAlbumPalette || !currentTrack?.albumCover) {
      setPalette(null);
      return;
    }
    let cancelled = false;
    extractPalette(currentTrack.albumCover)
      .then(([primary, secondary, accent]) => {
        if (!cancelled) {
          setPalette({ primary, secondary, accent });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPalette(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentTrack?.albumCover, useAlbumPalette]);

  // Find active line index
  const activeIndex = useMemo(() => {
    if (!lyrics?.synced) return -1;
    for (let i = lyrics.synced.length - 1; i >= 0; i--) {
      if (currentTime >= lyrics.synced[i]!.time) return i;
    }
    return -1;
  }, [currentTime, lyrics?.synced]);

  // Auto-scroll only when active line changes (not every currentTime tick)
  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeIndex]);

  if (!open) return null;

  const primary = palette?.primary ?? [0.024, 0.714, 0.831];
  const secondary = palette?.secondary ?? [0.4, 0.9, 1.0];

  return (
    <div
      className="fixed right-0 top-0 bottom-[72px] z-50 flex w-[360px] flex-col overflow-hidden border-l border-white/5 shadow-2xl"
      style={{
        background: `linear-gradient(180deg, ${cssColor(primary, useAlbumPalette ? 0.2 : 0.12)} 0%, rgba(12,12,20,0.96) 22%, rgba(12,12,20,1) 100%)`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-40 blur-3xl"
        style={{ background: `radial-gradient(circle at top, ${cssColor(secondary, useAlbumPalette ? 0.28 : 0.2)} 0%, transparent 72%)` }}
      />
      {/* Header */}
      <div className="relative flex items-center justify-between border-b border-white/5 px-4 py-3">
        <h2 className="text-sm font-bold text-white">Lyrics</h2>
        <button onClick={onClose} className="p-1 text-white/40 hover:text-white transition-colors">
          <X size={18} />
        </button>
      </div>

      {/* Track info */}
      {currentTrack && (
        <div className="relative border-b border-white/5 px-4 py-3">
          <p className="text-[13px] font-medium text-white truncate">{currentTrack.title}</p>
          <p className="text-[11px] text-white/50 truncate">{currentTrack.artist}</p>
        </div>
      )}

      {/* Lyrics content */}
      <div ref={containerRef} className="relative flex-1 overflow-y-auto lyrics-mask">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={20} className="text-primary animate-spin" />
          </div>
        )}

        {!loading && !lyrics?.synced && !lyrics?.plain && (
          <div className="px-4 py-16 text-center text-white/20 text-sm">
            No lyrics found
          </div>
        )}

        {/* Synced lyrics */}
        {lyrics?.synced && (
          <div className="space-y-1 px-4" style={{ paddingTop: "38vh", paddingBottom: "38vh" }}>
            {lyrics.synced.map((line, i) => {
              const isActive = i === activeIndex;
              const isPast = i < activeIndex;
              return (
                <button
                  key={i}
                  ref={isActive ? activeRef : null}
                  onClick={() => seek(line.time)}
                  className={`relative z-20 flex min-h-[72px] w-full items-center rounded-xl px-3 py-1.5 text-left transition-all duration-300 ${
                    isActive
                      ? "text-white text-[18px] font-bold"
                    : isPast
                        ? "text-white/20 text-[14px]"
                        : "text-white/35 text-[14px] hover:text-white/60"
                  }`}
                  style={isActive ? {
                    textShadow: `0 0 24px ${cssColor(primary, 0.3)}`,
                    color: cssColor(secondary, 1),
                  } : undefined}
                >
                  {line.text}
                </button>
              );
            })}
          </div>
        )}

        {/* Plain lyrics (no sync) */}
        {!lyrics?.synced && lyrics?.plain && (
          <div className="px-4 py-8">
            <pre className="whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-white/55">
              {lyrics.plain}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
