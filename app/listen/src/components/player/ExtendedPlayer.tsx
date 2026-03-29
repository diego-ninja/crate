import { useState, useEffect, useRef } from "react";
import { ChevronDown, X, Loader2, Star } from "lucide-react";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { useMusicVisualizer } from "@/components/player/visualizer/useMusicVisualizer";
import { api } from "@/lib/api";
import { formatDuration, formatCompact } from "@/lib/utils";

// ── Types ──

interface LyricLine {
  time: number;
  text: string;
}

interface LyricsData {
  synced: LyricLine[] | null;
  plain: string | null;
}

interface SimilarTrack {
  path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  score: number;
}

interface TrackInfo {
  title: string;
  artist: string;
  album: string;
  bpm: number | null;
  audio_key: string | null;
  audio_scale: string | null;
  energy: number | null;
  danceability: number | null;
  valence: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  loudness: number | null;
  dynamic_range: number | null;
  lastfm_listeners: number | null;
  lastfm_playcount: number | null;
  popularity: number | null;
  rating: number | null;
}

type TabId = "queue" | "suggested" | "lyrics" | "info";

// ── Helpers ──

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

// ── Sub-components ──

function QueueTab() {
  const { isPlaying } = usePlayer();
  const { queue, currentIndex, playSource, currentTrack, jumpTo, removeFromQueue } = usePlayerActions();

  const history = queue.slice(0, currentIndex).reverse();
  const upcoming = queue.slice(currentIndex + 1);
  const sourceName = playSource?.name || "Queue";

  return (
    <div className="flex-1 overflow-y-auto pr-1">
      {/* History */}
      {history.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] font-bold text-white/25 uppercase tracking-wider mb-2 px-1">
            History
          </p>
          {history.map((track, i) => {
            const realIdx = currentIndex - 1 - i;
            return (
              <button
                key={`hist-${track.id}-${realIdx}`}
                onClick={() => jumpTo(realIdx)}
                className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors text-left opacity-50"
              >
                <span className="text-[10px] text-white/15 w-4 text-right tabular-nums shrink-0">{realIdx + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-white/50 truncate">{track.title}</p>
                  <p className="text-[10px] text-white/25 truncate">{track.artist}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Now playing */}
      {currentTrack && (
        <div className="mb-4">
          <p className="text-[10px] font-bold text-white/25 uppercase tracking-wider mb-2 px-1">
            Now playing from: {sourceName}
          </p>
          <div className="flex items-center gap-3 px-2 py-1.5 rounded-lg bg-white/5">
            <span className="text-[10px] text-primary w-4 text-right tabular-nums shrink-0">{currentIndex + 1}</span>
            {currentTrack.albumCover ? (
              <img src={currentTrack.albumCover} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded bg-white/10 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-primary font-medium truncate">{currentTrack.title}</p>
              <p className="text-[10px] text-white/50 truncate">{currentTrack.artist}</p>
            </div>
            {isPlaying && (
              <div className="flex gap-0.5 items-end h-4 shrink-0">
                <div className="w-[3px] bg-primary rounded-sm equalizer-bar" style={{ animationDelay: "0ms" }} />
                <div className="w-[3px] bg-primary rounded-sm equalizer-bar" style={{ animationDelay: "200ms" }} />
                <div className="w-[3px] bg-primary rounded-sm equalizer-bar" style={{ animationDelay: "400ms" }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Next up */}
      {upcoming.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-white/25 uppercase tracking-wider mb-2 px-1">
            Next up from: {sourceName} ({upcoming.length})
          </p>
          {upcoming.map((track, i) => {
            const idx = currentIndex + 1 + i;
            return (
              <button
                key={`next-${track.id}-${idx}`}
                onClick={() => jumpTo(idx)}
                className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors text-left group"
              >
                <span className="text-[10px] text-white/20 w-4 text-right tabular-nums shrink-0">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-white/80 truncate">{track.title}</p>
                  <p className="text-[10px] text-white/40 truncate">{track.artist}</p>
                </div>
                <button
                  className="p-1 text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  onClick={(e) => { e.stopPropagation(); removeFromQueue(idx); }}
                  title="Remove"
                >
                  <X size={12} />
                </button>
              </button>
            );
          })}
        </div>
      )}

      {upcoming.length === 0 && !currentTrack && (
        <div className="py-12 text-center text-white/20 text-sm">Queue is empty</div>
      )}
    </div>
  );
}

function SuggestedTab() {
  const { currentTrack, play } = usePlayerActions();
  const [tracks, setTracks] = useState<SimilarTrack[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentTrack) return;
    setLoading(true);
    setTracks([]);
    api<{ tracks: SimilarTrack[] }>(`/api/similar-tracks?path=${encodeURIComponent(currentTrack.id)}&limit=15`)
      .then((data) => setTracks(data.tracks || []))
      .catch(() => setTracks([]))
      .finally(() => setLoading(false));
  }, [currentTrack?.id]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="text-primary animate-spin" />
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/20 text-sm">
        No similar tracks found
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pr-1">
      {tracks.map((t, i) => (
        <button
          key={`${t.path}-${i}`}
          onClick={() =>
            play(
              { id: t.path, title: t.title, artist: t.artist, album: t.album },
              { type: "radio", name: `Similar to ${currentTrack?.title}` },
            )
          }
          className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors text-left group"
        >
          <span className="text-[10px] text-white/20 w-4 text-right tabular-nums shrink-0">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-white/80 truncate">{t.title}</p>
            <p className="text-[10px] text-white/40 truncate">{t.artist} — {t.album}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-white/25 tabular-nums">{formatDuration(t.duration)}</span>
            <div className="w-12 h-1 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary/60"
                style={{ width: `${Math.min(t.score * 100, 100)}%` }}
              />
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function LyricsTab() {
  const { currentTime } = usePlayer();
  const { currentTrack, seek } = usePlayerActions();
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!currentTrack) return;
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
  }, [currentTrack?.id]);

  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentTime]);

  let activeIndex = -1;
  if (lyrics?.synced) {
    for (let i = lyrics.synced.length - 1; i >= 0; i--) {
      if (currentTime >= lyrics.synced[i]!.time) {
        activeIndex = i;
        break;
      }
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="text-primary animate-spin" />
      </div>
    );
  }

  if (!lyrics?.synced && !lyrics?.plain) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/20 text-sm">
        No lyrics found
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto pr-1 lyrics-mask">
      {lyrics?.synced && (
        <div className="space-y-1 py-2">
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

      {!lyrics?.synced && lyrics?.plain && (
        <pre className="text-[14px] text-white/50 whitespace-pre-wrap font-sans leading-relaxed py-2">
          {lyrics.plain}
        </pre>
      )}
    </div>
  );
}

function MetricBar({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-white/40 w-28 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-full bg-cyan-400/70 transition-all"
          style={{ width: `${Math.min(v * 100, 100)}%` }}
        />
      </div>
      <span className="text-[10px] text-white/30 w-8 text-right tabular-nums">
        {(v * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          size={14}
          className={s <= rating ? "text-amber-400 fill-amber-400" : "text-white/10"}
        />
      ))}
    </div>
  );
}

function InfoTab() {
  const { currentTrack } = usePlayerActions();
  const [info, setInfo] = useState<TrackInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentTrack) return;
    setInfo(null);
    setLoading(true);

    const trackPath = currentTrack.id.startsWith("/music/")
      ? currentTrack.id.slice(7)
      : currentTrack.id;

    api<TrackInfo>(`/api/track-info/${encodeURIComponent(trackPath).replace(/%2F/g, "/")}`)
      .then((data) => setInfo(data))
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, [currentTrack?.id]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="text-primary animate-spin" />
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/20 text-sm">
        No track info available
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pr-1 space-y-5 py-1">
      {/* Track */}
      <div>
        <p className="text-[10px] font-bold text-white/25 uppercase tracking-wider mb-2">Track</p>
        <p className="text-[13px] text-white font-medium">{info.title}</p>
        <p className="text-[11px] text-white/50">{info.artist}</p>
        <p className="text-[11px] text-white/30">{info.album}</p>
      </div>

      {/* Audio Analysis */}
      {(info.bpm || info.audio_key) && (
        <div>
          <p className="text-[10px] font-bold text-white/25 uppercase tracking-wider mb-3">Audio Analysis</p>
          <div className="flex items-baseline gap-4 mb-4">
            {info.bpm && (
              <div>
                <span className="text-2xl font-bold text-white tabular-nums">{Math.round(info.bpm)}</span>
                <span className="text-[10px] text-white/30 ml-1">BPM</span>
              </div>
            )}
            {info.audio_key && (
              <div>
                <span className="text-lg font-semibold text-white">{info.audio_key}</span>
                {info.audio_scale && (
                  <span className="text-[11px] text-white/40 ml-1">{info.audio_scale}</span>
                )}
              </div>
            )}
          </div>
          <div className="space-y-2.5">
            <MetricBar label="Energy" value={info.energy} />
            <MetricBar label="Danceability" value={info.danceability} />
            <MetricBar label="Valence" value={info.valence} />
          </div>
        </div>
      )}

      {/* Mood Profile */}
      {(info.acousticness !== null || info.instrumentalness !== null) && (
        <div>
          <p className="text-[10px] font-bold text-white/25 uppercase tracking-wider mb-3">Mood Profile</p>
          <div className="space-y-2.5">
            <MetricBar label="Acousticness" value={info.acousticness} />
            <MetricBar label="Instrumentalness" value={info.instrumentalness} />
          </div>
        </div>
      )}

      {/* Loudness & Dynamic Range */}
      {(info.loudness !== null || info.dynamic_range !== null) && (
        <div>
          <p className="text-[10px] font-bold text-white/25 uppercase tracking-wider mb-2">Dynamics</p>
          <div className="flex gap-6">
            {info.loudness !== null && (
              <div>
                <span className="text-sm font-semibold text-white tabular-nums">{info.loudness.toFixed(1)}</span>
                <span className="text-[10px] text-white/30 ml-1">dB LUFS</span>
              </div>
            )}
            {info.dynamic_range !== null && (
              <div>
                <span className="text-sm font-semibold text-white tabular-nums">{info.dynamic_range.toFixed(1)}</span>
                <span className="text-[10px] text-white/30 ml-1">dB DR</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Popularity */}
      {(info.lastfm_listeners || info.lastfm_playcount) && (
        <div>
          <p className="text-[10px] font-bold text-white/25 uppercase tracking-wider mb-2">Popularity</p>
          <div className="flex gap-6">
            {info.lastfm_listeners != null && info.lastfm_listeners > 0 && (
              <div>
                <span className="text-sm font-semibold text-white tabular-nums">{formatCompact(info.lastfm_listeners)}</span>
                <span className="text-[10px] text-white/30 ml-1">listeners</span>
              </div>
            )}
            {info.lastfm_playcount != null && info.lastfm_playcount > 0 && (
              <div>
                <span className="text-sm font-semibold text-white tabular-nums">{formatCompact(info.lastfm_playcount)}</span>
                <span className="text-[10px] text-white/30 ml-1">plays</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rating */}
      {info.rating != null && info.rating > 0 && (
        <div>
          <p className="text-[10px] font-bold text-white/25 uppercase tracking-wider mb-2">Rating</p>
          <StarRating rating={Math.round(info.rating)} />
        </div>
      )}
    </div>
  );
}

// ── Main Component ──

interface ExtendedPlayerProps {
  open: boolean;
  onClose: () => void;
}

const TABS: { id: TabId; label: string }[] = [
  { id: "queue", label: "Queue" },
  { id: "suggested", label: "Suggested" },
  { id: "lyrics", label: "Lyrics" },
  { id: "info", label: "Info" },
];

export function ExtendedPlayer({ open, onClose }: ExtendedPlayerProps) {
  usePlayer(); // subscribe to state updates for child components
  const { currentTrack, audioElement } = usePlayerActions();
  const [tab, setTab] = useState<TabId>("queue");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  useMusicVisualizer(canvasRef, audioElement, open);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || !currentTrack) return null;

  return (
    <div className="fixed inset-0 bottom-[72px] z-40 bg-[#0a0a0f] flex animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* ── Left Panel: Visualizer + Track Info ── */}
      <div className="relative w-1/2 overflow-hidden">
        {/* Darkened album cover background */}
        {currentTrack.albumCover && (
          <img
            src={currentTrack.albumCover}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: "brightness(0.2) blur(40px)", transform: "scale(1.1)" }}
          />
        )}

        {/* Dark overlay for extra depth */}
        <div className="absolute inset-0 bg-[#0a0a0f]/40" />

        {/* WebGL Visualizer Canvas */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ background: "transparent" }}
        />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 left-4 z-10 p-2 rounded-full bg-black/30 backdrop-blur-sm text-white/60 hover:text-white hover:bg-black/50 transition-colors"
        >
          <ChevronDown size={20} />
        </button>

        {/* Track info at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-[#0a0a0f]/90 via-[#0a0a0f]/40 to-transparent">
          <h2 className="text-2xl font-bold text-white leading-tight mb-1 drop-shadow-lg">
            {currentTrack.title}
          </h2>
          <p className="text-lg text-white/60 drop-shadow-md">
            {currentTrack.artist}
          </p>
          {currentTrack.album && (
            <p className="text-sm text-white/30 mt-1">
              {currentTrack.album}
            </p>
          )}
        </div>
      </div>

      {/* ── Right Panel: Tabs ── */}
      <div className="w-1/2 flex flex-col border-l border-white/5 bg-[#0a0a0f]">
        {/* Tab bar */}
        <div className="flex items-center gap-1.5 px-5 pt-5 pb-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
                tab === t.id
                  ? "bg-white/10 text-white"
                  : "text-white/40 hover:text-white/60"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden flex flex-col px-5 pb-5">
          {tab === "queue" && <QueueTab />}
          {tab === "suggested" && <SuggestedTab />}
          {tab === "lyrics" && <LyricsTab />}
          {tab === "info" && <InfoTab />}
        </div>
      </div>
    </div>
  );
}
