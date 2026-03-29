import { useState, useEffect, useRef } from "react";
import { X, Loader2 } from "lucide-react";
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

interface LyricsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function LyricsPanel({ open, onClose }: LyricsPanelProps) {
  const { currentTime } = usePlayer();
  const { currentTrack, seek } = usePlayerActions();
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  // Auto-scroll to active line
  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentTime]);

  if (!open) return null;

  // Find active line index
  let activeIndex = -1;
  if (lyrics?.synced) {
    for (let i = lyrics.synced.length - 1; i >= 0; i--) {
      if (currentTime >= lyrics.synced[i]!.time) {
        activeIndex = i;
        break;
      }
    }
  }

  return (
    <div className="fixed right-0 top-0 bottom-[72px] w-[360px] bg-[#0c0c14] border-l border-white/5 z-50 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h2 className="text-sm font-bold text-white">Lyrics</h2>
        <button onClick={onClose} className="p-1 text-white/40 hover:text-white transition-colors">
          <X size={18} />
        </button>
      </div>

      {/* Track info */}
      {currentTrack && (
        <div className="px-4 py-3 border-b border-white/5">
          <p className="text-[13px] font-medium text-white truncate">{currentTrack.title}</p>
          <p className="text-[11px] text-white/50 truncate">{currentTrack.artist}</p>
        </div>
      )}

      {/* Lyrics content */}
      <div ref={containerRef} className="flex-1 overflow-y-auto lyrics-mask">
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
          <div className="px-4 py-6 space-y-1">
            {lyrics.synced.map((line, i) => {
              const isActive = i === activeIndex;
              const isPast = i < activeIndex;
              return (
                <button
                  key={i}
                  ref={isActive ? activeRef : null}
                  onClick={() => seek(line.time)}
                  className={`block w-full text-left py-1.5 px-2 rounded-md transition-all duration-300 ${
                    isActive
                      ? "text-white text-[15px] font-bold bg-white/5"
                      : isPast
                        ? "text-white/25 text-[14px]"
                        : "text-white/40 text-[14px] hover:text-white/60"
                  }`}
                >
                  {line.text}
                </button>
              );
            })}
          </div>
        )}

        {/* Plain lyrics (no sync) */}
        {!lyrics?.synced && lyrics?.plain && (
          <div className="px-4 py-6">
            <pre className="text-[14px] text-white/50 whitespace-pre-wrap font-sans leading-relaxed">
              {lyrics.plain}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
