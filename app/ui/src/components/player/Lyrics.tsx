import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { X, Loader2 } from "lucide-react";

interface LyricsPanelProps {
  artist: string;
  title: string;
  currentTime: number;
  onClose: () => void;
}

interface SyncedLine {
  time: number; // seconds
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

export function LyricsPanel({ artist, title, currentTime, onClose }: LyricsPanelProps) {
  const [plain, setPlain] = useState<string | null>(null);
  const [synced, setSynced] = useState<SyncedLine[] | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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

    const params = new URLSearchParams({
      artist_name: artist,
      track_name: title,
    });

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

  // Find current synced line
  const activeIndex = useMemo(() => {
    if (!synced) return -1;
    let idx = -1;
    for (let i = 0; i < synced.length; i++) {
      if (synced[i]!.time <= currentTime) idx = i;
      else break;
    }
    return idx;
  }, [synced, currentTime]);

  // Auto-scroll to active line
  useEffect(() => {
    if (activeRef.current && scrollRef.current) {
      activeRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [activeIndex]);

  const hasSynced = synced && synced.length > 0;

  return (
    <div className="fixed bottom-20 md:bottom-24 right-0 md:right-4 w-full md:w-96 max-h-[50vh] z-50 bg-card/95 backdrop-blur-md border md:border border-border md:rounded-xl shadow-2xl animate-in slide-in-from-bottom-4 duration-200 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Lyrics</span>
          {hasSynced && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary">synced</span>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={18} className="animate-spin text-muted-foreground" />
          </div>
        ) : hasSynced ? (
          <div className="space-y-1 py-4">
            {synced.map((line, i) => (
              <div
                key={i}
                ref={i === activeIndex ? activeRef : undefined}
                className={`px-2 py-1.5 rounded-md transition-all duration-300 ${
                  i === activeIndex
                    ? "text-foreground text-base font-semibold bg-primary/10 scale-[1.02]"
                    : i < activeIndex
                      ? "text-muted-foreground/40 text-sm"
                      : "text-muted-foreground/70 text-sm"
                }`}
              >
                {line.text}
              </div>
            ))}
          </div>
        ) : plain ? (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {plain}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-12">
            No lyrics available
          </p>
        )}
      </div>
    </div>
  );
}
