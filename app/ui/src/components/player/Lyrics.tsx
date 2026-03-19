import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Loader2 } from "lucide-react";

interface LyricsPanelProps {
  artist: string;
  title: string;
  onClose: () => void;
}

const lyricsCache = new Map<string, string | null>();

export function LyricsPanel({ artist, title, onClose }: LyricsPanelProps) {
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const key = `${artist}::${title}`;
    if (lyricsCache.has(key)) {
      setLyrics(lyricsCache.get(key) ?? null);
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

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
        const text = data.plainLyrics || null;
        lyricsCache.set(key, text);
        setLyrics(text);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          lyricsCache.set(key, null);
          setLyrics(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [artist, title]);

  return (
    <div className="fixed bottom-16 right-0 w-80 max-h-[60vh] z-50 bg-card border border-border rounded-tl-lg shadow-xl animate-in slide-in-from-bottom-4 duration-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold">Lyrics</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>
      <ScrollArea className="max-h-[calc(60vh-48px)]">
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={18} className="animate-spin text-muted-foreground" />
            </div>
          ) : lyrics ? (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {lyrics}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              No lyrics available
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
