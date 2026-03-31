import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, X, Loader2, Star, Settings } from "lucide-react";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { useMusicVisualizer } from "@/components/player/visualizer/useMusicVisualizer";
import { api } from "@/lib/api";
import { extractPalette } from "@/lib/palette";
import {
  getUseAlbumPalettePreference,
  getVisualizerEnabledPreference,
  getVisualizerSettingsPreference,
  DEFAULT_VISUALIZER_SETTINGS,
  PLAYER_VIZ_PREFS_EVENT,
  setUseAlbumPalettePreference,
  setVisualizerEnabledPreference,
  setVisualizerSettingsPreference,
} from "@/lib/player-visualizer-prefs";
import { formatDuration, formatCompact } from "@/lib/utils";
import { useEscapeKey } from "@/hooks/use-escape-key";

// ── Types ──

interface LyricLine {
  time: number;
  text: string;
}

interface LyricsData {
  synced: LyricLine[] | null;
  plain: string | null;
}

type PaletteTriplet = [number, number, number];

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

function cssColor(color: PaletteTriplet, alpha = 1): string {
  const [r, g, b] = color.map((value) => Math.round(value * 255));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
              <div
                key={`next-${track.id}-${idx}`}
                onClick={() => jumpTo(idx)}
                className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors text-left group cursor-pointer"
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
              </div>
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

function LyricsTab({ useAlbumPalette }: { useAlbumPalette: boolean }) {
  const { currentTime } = usePlayer();
  const { currentTrack, seek } = usePlayerActions();
  const [lyrics, setLyrics] = useState<LyricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [palette, setPalette] = useState<{
    primary: PaletteTriplet;
    secondary: PaletteTriplet;
    accent: PaletteTriplet;
  } | null>(null);
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
    if (!useAlbumPalette || !currentTrack?.albumCover) {
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
  }, [currentTrack?.albumCover, useAlbumPalette]);

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

  const primary = palette?.primary ?? [0.024, 0.714, 0.831];
  const secondary = palette?.secondary ?? [0.4, 0.9, 1.0];

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-y-auto pr-1 lyrics-mask"
      style={{
        background: `linear-gradient(180deg, ${cssColor(primary, 0.12)} 0%, transparent 28%, transparent 72%, ${cssColor(secondary, 0.06)} 100%)`,
      }}
    >
      {lyrics?.synced && (
        <div className="space-y-1" style={{ paddingTop: "34vh", paddingBottom: "34vh" }}>
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
                    ? "text-[18px] font-bold"
                    : isPast
                      ? "text-white/18 text-[14px]"
                      : "text-white/35 text-[14px] hover:text-white/60"
                }`}
                style={isActive ? {
                  color: cssColor(secondary, 1),
                  textShadow: `0 0 24px ${cssColor(primary, 0.35)}`,
                } : undefined}
              >
                {line.text}
              </button>
            );
          })}
        </div>
      )}

      {!lyrics?.synced && lyrics?.plain && (
        <pre className="whitespace-pre-wrap py-2 font-sans text-[14px] leading-relaxed text-white/55">
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

const VIZ_DEFAULTS = DEFAULT_VISUALIZER_SETTINGS;

export function ExtendedPlayer({ open, onClose }: ExtendedPlayerProps) {
  usePlayer(); // subscribe to state updates for child components
  const { currentTrack, audioElement } = usePlayerActions();
  const [tab, setTab] = useState<TabId>("queue");
  const [showVizSettings, setShowVizSettings] = useState(false);
  const [vizConfig, setVizConfig] = useState(getVisualizerSettingsPreference);
  const [useAlbumPalette, setUseAlbumPalette] = useState(getUseAlbumPalettePreference);
  const [vizEnabled, setVizEnabled] = useState(getVisualizerEnabledPreference);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vizRef = useMusicVisualizer(canvasRef, audioElement, open && vizEnabled);

  useEffect(() => {
    const syncPreference = () => {
      setUseAlbumPalette(getUseAlbumPalettePreference());
      setVizConfig(getVisualizerSettingsPreference());
      setVizEnabled(getVisualizerEnabledPreference());
    };
    window.addEventListener("storage", syncPreference);
    window.addEventListener(PLAYER_VIZ_PREFS_EVENT, syncPreference as EventListener);
    return () => {
      window.removeEventListener("storage", syncPreference);
      window.removeEventListener(PLAYER_VIZ_PREFS_EVENT, syncPreference as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!showVizSettings) return;
    setUseAlbumPalette(getUseAlbumPalettePreference());
    setVizConfig(getVisualizerSettingsPreference());
    setVizEnabled(getVisualizerEnabledPreference());
  }, [showVizSettings]);

  // Extract palette from album cover and apply to visualizer
  useEffect(() => {
    const defaultC1: [number, number, number] = [0.024, 0.714, 0.831];
    const defaultC2: [number, number, number] = [0.4, 0.9, 1.0];
    const defaultC3: [number, number, number] = [0.1, 0.3, 0.8];

    if (!useAlbumPalette) {
      const apply = () => {
        if (vizRef.current) {
          vizRef.current.color1 = defaultC1;
          vizRef.current.color2 = defaultC2;
          vizRef.current.color3 = defaultC3;
        }
      };
      apply();
      const t1 = setTimeout(apply, 500);
      return () => clearTimeout(t1);
    }

    if (!currentTrack?.albumCover) return;
    let cancelled = false;
    extractPalette(currentTrack.albumCover!).then(([c1, c2, c3]) => {
      if (cancelled) return;
      const apply = () => {
        if (vizRef.current) {
          vizRef.current.color1 = c1;
          vizRef.current.color2 = c2;
          vizRef.current.color3 = c3;
        }
      };
      apply();
      // Keep retrying — viz may not exist yet
      const t1 = setTimeout(apply, 500);
      const t2 = setTimeout(apply, 1500);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentTrack?.albumCover, vizRef, useAlbumPalette]);

  // Apply viz config whenever it changes
  useEffect(() => {
    const apply = () => {
      if (vizRef.current) {
        vizRef.current.separation = vizConfig.separation;
        vizRef.current.glow = vizConfig.glow;
        vizRef.current.scale = vizConfig.scale;
        vizRef.current.persistence = vizConfig.persistence;
        vizRef.current.octaves = vizConfig.octaves;
      }
    };
    apply();
    const t = setTimeout(apply, 300);
    return () => clearTimeout(t);
  }, [vizConfig, vizRef, open]);

  const handleEscape = useCallback((event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (showVizSettings) {
      setShowVizSettings(false);
      return;
    }
    onClose();
  }, [onClose, showVizSettings]);

  useEscapeKey(open, handleEscape);

  if (!currentTrack) return null;

  const updateVizConfig = (next: typeof vizConfig) => {
    setVizConfig(next);
    setVisualizerSettingsPreference(next);
  };

  return (
    <div
      className={`fixed inset-0 bottom-[72px] z-[60] bg-[#0a0a0f] flex transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
        open
          ? "top-0 opacity-100"
          : "top-[100vh] opacity-0 pointer-events-none"
      }`}
    >
      {/* ── Left Panel: Cover + Visualizer + Track Info ── */}
      <div className="relative w-1/2 flex flex-col items-center justify-center overflow-hidden bg-[#0a0a0f]">
        {/* Top buttons */}
        <div className="absolute top-4 left-4 right-4 z-30 flex justify-between">
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-black/30 backdrop-blur-sm text-white/60 hover:text-white hover:bg-black/50 transition-colors"
          >
            <ChevronDown size={20} />
          </button>
          <button
            onClick={() => setShowVizSettings(!showVizSettings)}
            className={`p-2 rounded-full backdrop-blur-sm transition-colors ${showVizSettings ? "bg-primary/20 text-primary" : "bg-black/30 text-white/40 hover:text-white/70"}`}
          >
            <Settings size={18} />
          </button>
        </div>

        {/* Visualizer settings popup */}
        {showVizSettings && (
          <div className="absolute top-14 right-4 z-40 w-56 bg-[#12121a]/95 backdrop-blur-xl border border-white/10 rounded-xl p-4 shadow-2xl space-y-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Visualizer</span>
              <button
                onClick={() => updateVizConfig(VIZ_DEFAULTS)}
                className="text-[10px] text-primary hover:underline"
              >
                Reset
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-white/50">Enabled</span>
              <button
                onClick={() => {
                  const next = !vizEnabled;
                  setVizEnabled(next);
                  setVisualizerEnabledPreference(next);
                }}
                className={`w-9 h-5 rounded-full transition-colors ${vizEnabled ? "bg-primary" : "bg-white/20"}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${vizEnabled ? "translate-x-4.5" : "translate-x-0.5"}`} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-white/50">Album palette</span>
              <button
                onClick={() => {
                  const next = !useAlbumPalette;
                  setUseAlbumPalette(next);
                  setUseAlbumPalettePreference(next);
                }}
                className={`w-9 h-5 rounded-full transition-colors ${useAlbumPalette ? "bg-primary" : "bg-white/20"}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${useAlbumPalette ? "translate-x-4.5" : "translate-x-0.5"}`} />
              </button>
            </div>
            {([
              { key: "separation" as const, label: "Separation", min: 0, max: 0.5, step: 0.01 },
              { key: "glow" as const, label: "Glow", min: 0, max: 15, step: 0.5 },
              { key: "scale" as const, label: "Scale", min: 0.2, max: 3, step: 0.1 },
              { key: "persistence" as const, label: "Persistence", min: 0, max: 2, step: 0.1 },
              { key: "octaves" as const, label: "Octaves", min: 1, max: 5, step: 1 },
            ]).map(({ key, label, min, max, step }) => (
              <div key={key}>
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-white/40">{label}</span>
                  <span className="text-white/60 font-mono">{vizConfig[key].toFixed(key === "octaves" ? 0 : 1)}</span>
                </div>
                <input
                  type="range"
                  min={min} max={max} step={step}
                  value={vizConfig[key]}
                  onChange={(e) => updateVizConfig({ ...vizConfig, [key]: parseFloat(e.target.value) })}
                  className="w-full h-1 accent-cyan-400"
                />
              </div>
            ))}
          </div>
        )}

        {/* Cover art — centered, B/W + darkened */}
        <div className="relative z-0 w-[70%] max-w-[480px] aspect-square shrink-0">
          <div className="absolute inset-6 rounded-[28px] bg-primary/10 blur-3xl opacity-70" />
          <div className="absolute inset-2 rounded-[26px] border border-white/10 bg-white/[0.02]" />
          {currentTrack.albumCover ? (
            <img
              src={currentTrack.albumCover}
              alt=""
              className="absolute inset-0 w-full h-full rounded-xl object-cover shadow-[0_28px_100px_rgba(0,0,0,0.75),0_10px_28px_rgba(0,0,0,0.45)]"
              style={{ filter: vizEnabled ? "grayscale(100%) brightness(0.35)" : "none" }}
            />
          ) : (
            <div className="absolute inset-0 rounded-xl bg-white/5 shadow-[0_28px_100px_rgba(0,0,0,0.75)]" />
          )}
        </div>

        {/* WebGL Visualizer Canvas — overlays the ENTIRE left panel */}
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 z-10 h-full w-full pointer-events-none ${vizEnabled ? "" : "hidden"}`}
          style={{ background: "transparent" }}
        />

        {/* Track info below the cover */}
        <div className="relative z-20 mt-6 max-w-full px-8 text-center">
          <h2 className="text-xl font-bold text-white leading-tight truncate">
            {currentTrack.title}
          </h2>
          <p className="text-base text-white/50 mt-1 truncate">
            {currentTrack.artist}
          </p>
          {currentTrack.album && (
            <p className="text-sm text-white/25 mt-0.5 truncate">
              {currentTrack.album}
            </p>
          )}
        </div>
      </div>

      {/* ── Right Panel: Tabs ── */}
      <div className="w-1/2 flex flex-col bg-[#0a0a0f]">
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
          {tab === "lyrics" && <LyricsTab useAlbumPalette={useAlbumPalette} />}
          {tab === "info" && <InfoTab />}
        </div>
      </div>
    </div>
  );
}
