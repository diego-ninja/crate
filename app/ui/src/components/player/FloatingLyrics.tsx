import { useState, useEffect, useRef, useMemo } from "react";
import { usePlayer } from "@/contexts/PlayerContext";
import { useDraggable } from "./useDraggable";
import { cn } from "@/lib/utils";
import { X, Loader2 } from "lucide-react";

interface SyncedLine {
  time: number;
  text: string;
}

const lyricsCache = new Map<string, { plain: string | null; synced: SyncedLine[] | null }>();

function parseLRC(lrc: string): SyncedLine[] {
  const lines: SyncedLine[] = [];
  for (const line of lrc.split("\n")) {
    const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/);
    if (match) {
      const min = parseInt(match[1]!, 10);
      const sec = parseInt(match[2]!, 10);
      const ms = parseInt(match[3]!.padEnd(3, "0"), 10);
      const time = min * 60 + sec + ms / 1000;
      const text = match[4]!.trim();
      if (text) lines.push({ time, text });
    }
  }
  return lines;
}

interface FloatingLyricsProps {
  open: boolean;
  onClose: () => void;
}

export function FloatingLyrics({ open, onClose }: FloatingLyricsProps) {
  const { currentTrack, currentTime, seek } = usePlayer();
  const { pos, onDragStart } = useDraggable("floating-lyrics", {
    x: Math.max(0, window.innerWidth / 2 + 230),
    y: 80,
  });

  const [plain, setPlain] = useState<string | null>(null);
  const [synced, setSynced] = useState<SyncedLine[] | null>(null);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const artist = currentTrack?.artist ?? "";
  const title = currentTrack?.title ?? "";

  // Fetch lyrics
  useEffect(() => {
    if (!artist || !title) {
      setPlain(null);
      setSynced(null);
      setLoading(false);
      return;
    }

    const key = `${artist}::${title}`;
    if (lyricsCache.has(key)) {
      const cached = lyricsCache.get(key)!;
      setPlain(cached.plain);
      setSynced(cached.synced);
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setPlain(null);
    setSynced(null);

    const params = new URLSearchParams({ artist_name: artist, track_name: title });

    fetch(`https://lrclib.net/api/get?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data) => {
        const plainText = data.plainLyrics || null;
        const syncedLines = data.syncedLyrics ? parseLRC(data.syncedLyrics) : null;
        lyricsCache.set(key, { plain: plainText, synced: syncedLines });
        setPlain(plainText);
        setSynced(syncedLines);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          lyricsCache.set(key, { plain: null, synced: null });
          setPlain(null);
          setSynced(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [artist, title]);

  // Active line index
  const activeIndex = useMemo(() => {
    if (!synced) return -1;
    let idx = -1;
    for (let i = 0; i < synced.length; i++) {
      if (synced[i]!.time <= currentTime) idx = i;
      else break;
    }
    return idx;
  }, [synced, currentTime]);

  // Auto-scroll
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeIndex]);

  if (!open || !currentTrack) return null;

  const hasSynced = synced && synced.length > 0;

  return (
    <div
      className="fixed z-[100] w-[340px] max-h-[70vh] rounded-2xl overflow-hidden shadow-2xl shadow-black/60 border border-white/10 bg-card/95 backdrop-blur-xl flex flex-col"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Header — drag handle */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-border cursor-grab active:cursor-grabbing select-none flex-shrink-0"
        onMouseDown={onDragStart}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Lyrics</span>
          {hasSynced && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary">synced</span>
          )}
        </div>
        <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Track info */}
      <div className="px-4 py-2 border-b border-border/50">
        <div className="text-xs font-medium truncate">{currentTrack.title}</div>
        <div className="text-[10px] text-muted-foreground truncate">{currentTrack.artist}</div>
      </div>

      {/* Lyrics content with gradient mask */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain lyrics-mask">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={18} className="animate-spin text-muted-foreground" />
          </div>
        ) : hasSynced ? (
          <div className="space-y-1 px-4 py-8">
            {synced.map((line, i) => (
              <div
                key={i}
                ref={i === activeIndex ? activeRef : undefined}
                className={cn(
                  "px-2 py-1.5 rounded-md transition-all duration-300 cursor-pointer hover:bg-white/5",
                  i === activeIndex
                    ? "text-foreground text-base font-semibold bg-primary/10 scale-[1.02]"
                    : i < activeIndex
                      ? "text-muted-foreground/40 text-sm"
                      : "text-muted-foreground/70 text-sm",
                )}
                onClick={() => seek(line.time)}
              >
                {line.text}
              </div>
            ))}
          </div>
        ) : plain ? (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed px-4 py-8">
            {plain}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-16">
            No lyrics available
          </p>
        )}
      </div>
    </div>
  );
}
