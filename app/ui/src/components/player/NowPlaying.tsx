import { useState, useEffect, useRef, useCallback, forwardRef } from "react";
import { useNavigate } from "react-router";
import { usePlayer } from "@/contexts/PlayerContext";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";
import { api } from "@/lib/api";
import { encPath, formatDuration } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Shuffle,
  Repeat,
  Repeat1,
  ListMusic,
  Mic2,
  Music,
} from "lucide-react";
import { QueuePanel } from "./QueuePanel";
import { LyricsPanel } from "./Lyrics";
import {
  BarVisualizer,
  WaveVisualizer,
  RadialVisualizer,
  GlowVisualizer,
  VIZ_MODES,
  type VizMode,
} from "./AudioPlayer";

const VIZ_KEY = "player-viz";

function getStoredViz(): VizMode {
  try {
    const v = localStorage.getItem(VIZ_KEY) as VizMode;
    if (VIZ_MODES.includes(v)) return v;
  } catch { /* ignore */ }
  return "bars";
}

interface TrackInfo {
  album?: string;
  bpm?: number;
  audio_key?: string;
  audio_scale?: string;
  energy?: number;
}

function CoverArt({ src, size, className }: { src?: string; size: number; className?: string }) {
  const [error, setError] = useState(false);
  const hasSrc = src && src.length > 0;

  if (!hasSrc || error) {
    return (
      <div
        className={`bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <Music size={size * 0.35} className="text-primary/50" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={`object-cover bg-secondary ${className}`}
      style={{ width: size, height: size }}
      onError={() => setError(true)}
    />
  );
}

const ProgressBar = forwardRef<
  HTMLDivElement,
  { progress: number; onSeek: (pct: number) => void }
>(function ProgressBar({ progress, onSeek }, ref) {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(pct);
    },
    [onSeek],
  );

  return (
    <div
      ref={ref}
      className="flex-1 h-2 bg-white/10 rounded-full cursor-pointer group relative"
      onClick={handleClick}
    >
      <div
        className="h-full bg-primary rounded-full transition-[width] duration-100"
        style={{ width: `${progress}%` }}
      />
      <div
        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
        style={{ left: `${progress}%`, marginLeft: "-8px" }}
      />
    </div>
  );
});

function VolumeSlider({ volume, onChange }: { volume: number; onChange: (v: number) => void }) {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onChange(pct);
    },
    [onChange],
  );

  return (
    <div className="w-28 h-1.5 bg-white/10 rounded-full cursor-pointer group" onClick={handleClick}>
      <div
        className="h-full bg-white/60 group-hover:bg-primary rounded-full transition-colors"
        style={{ width: `${volume * 100}%` }}
      />
    </div>
  );
}

type BottomTab = "queue" | "lyrics" | null;

export function NowPlaying({ onCollapse }: { onCollapse: () => void }) {
  const navigate = useNavigate();
  const {
    queue,
    currentIndex,
    isPlaying,
    currentTime,
    duration,
    volume,
    shuffle,
    repeat,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
    toggleShuffle,
    cycleRepeat,
    currentTrack,
    audioElement,
  } = usePlayer();

  const { frequencies } = useAudioVisualizer(audioElement, isPlaying);
  const [vizMode, setVizMode] = useState<VizMode>(getStoredViz);
  const [bottomTab, setBottomTab] = useState<BottomTab>(null);
  const [trackInfo, setTrackInfo] = useState<TrackInfo | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTrackInfo(null);
    if (!currentTrack?.id.includes("/")) return;
    api<TrackInfo>(`/api/track-info/${currentTrack.id}`).then(setTrackInfo).catch(() => {});
  }, [currentTrack?.id]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCollapse();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCollapse]);

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  function cycleViz() {
    const idx = VIZ_MODES.indexOf(vizMode);
    const nextMode = VIZ_MODES[(idx + 1) % VIZ_MODES.length]!;
    setVizMode(nextMode);
    try { localStorage.setItem(VIZ_KEY, nextMode); } catch { /* ignore */ }
  }

  const VIZ_MAP: Record<VizMode, typeof BarVisualizer> = {
    bars: BarVisualizer,
    wave: WaveVisualizer,
    radial: RadialVisualizer,
    glow: GlowVisualizer,
  };
  const Viz = VIZ_MAP[vizMode];

  const badges: { label: string; value: string }[] = [];
  if (trackInfo?.bpm) badges.push({ label: "BPM", value: String(Math.round(trackInfo.bpm)) });
  if (trackInfo?.audio_key) {
    const keyLabel = trackInfo.audio_scale ? `${trackInfo.audio_key} ${trackInfo.audio_scale}` : trackInfo.audio_key;
    badges.push({ label: "Key", value: keyLabel });
  }
  if (trackInfo?.energy != null) badges.push({ label: "Energy", value: `${Math.round(trackInfo.energy * 100)}%` });

  function goToArtist() {
    if (!currentTrack) return;
    onCollapse();
    navigate(`/artist/${encPath(currentTrack.artist)}`);
  }

  return (
    <div className="fixed inset-0 z-[60] bg-[#1a1a2e] text-white animate-in fade-in duration-300 flex flex-col overflow-hidden">
      {/* Blurred album art background */}
      {currentTrack.albumCover && (
        <img
          src={currentTrack.albumCover}
          alt=""
          className="absolute inset-0 w-full h-full object-cover blur-3xl opacity-30 scale-110 pointer-events-none"
        />
      )}
      <div className="absolute inset-0 bg-black/40 pointer-events-none" />

      {/* Content layer */}
      <div className="relative z-10 flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center px-4 py-3 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white hover:bg-white/10"
            onClick={onCollapse}
          >
            <ChevronDown size={22} />
          </Button>
          <span className="flex-1 text-center text-sm font-medium text-white/70 uppercase tracking-wider">
            Now Playing
          </span>
          <div className="w-9" />
        </div>

        {/* Scrollable main area */}
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 min-h-0 overflow-y-auto">
          {/* Album cover */}
          <CoverArt
            src={currentTrack.albumCover}
            size={typeof window !== "undefined" && window.innerWidth < 768 ? 240 : 300}
            className="rounded-xl ring-1 ring-white/10 shadow-2xl flex-shrink-0"
          />

          {/* Track info */}
          <div className="text-center space-y-1 max-w-md">
            <div className="text-2xl font-bold truncate">{currentTrack.title}</div>
            <button
              className="text-lg text-white/60 hover:text-white hover:underline transition-colors cursor-pointer truncate block mx-auto"
              onClick={goToArtist}
            >
              {currentTrack.artist}
            </button>
            {trackInfo?.album && (
              <div className="text-sm text-white/40 truncate">{trackInfo.album}</div>
            )}
          </div>

          {/* Audio metadata badges */}
          {badges.length > 0 && (
            <div className="flex gap-2">
              {badges.map((b) => (
                <span
                  key={b.label}
                  className="text-xs bg-white/10 text-white/70 rounded-full px-3 py-1"
                >
                  {b.label} {b.value}
                </span>
              ))}
            </div>
          )}

          {/* Progress bar */}
          <div className="w-full max-w-lg flex items-center gap-3">
            <span className="text-xs text-white/50 font-mono w-10 text-right">
              {formatDuration(Math.floor(currentTime))}
            </span>
            <ProgressBar
              ref={progressRef}
              progress={progress}
              onSeek={(pct) => seek(pct * duration)}
            />
            <span className="text-xs text-white/50 font-mono w-10">
              {formatDuration(Math.floor(duration))}
            </span>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className={`h-10 w-10 ${shuffle ? "text-primary" : "text-white/60"} hover:bg-white/10`}
              onClick={toggleShuffle}
            >
              <Shuffle size={18} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-12 w-12 text-white hover:bg-white/10"
              onClick={prev}
            >
              <SkipBack size={22} />
            </Button>
            <Button
              size="icon"
              className="h-14 w-14 rounded-full bg-white text-black hover:bg-white/90"
              onClick={isPlaying ? pause : resume}
            >
              {isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-12 w-12 text-white hover:bg-white/10"
              onClick={next}
            >
              <SkipForward size={22} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-10 w-10 ${repeat !== "off" ? "text-primary" : "text-white/60"} hover:bg-white/10`}
              onClick={cycleRepeat}
            >
              {repeat === "one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
            </Button>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-white/60 hover:bg-white/10"
              onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
            >
              {volume > 0 ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </Button>
            <VolumeSlider volume={volume} onChange={setVolume} />
          </div>

          {/* Visualizer */}
          <div className="w-full max-w-lg">
            <div className="flex items-center justify-between mb-1">
              <button
                className="text-[10px] text-white/30 hover:text-white/60 uppercase tracking-wider transition-colors cursor-pointer"
                onClick={cycleViz}
              >
                {vizMode}
              </button>
            </div>
            <Viz frequencies={frequencies} className="h-32 w-full" />
          </div>
        </div>

        {/* Bottom tabs */}
        <div className="flex-shrink-0">
          <div className="flex border-t border-white/10">
            <button
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm transition-colors cursor-pointer ${
                bottomTab === "queue" ? "text-primary" : "text-white/50 hover:text-white/70"
              }`}
              onClick={() => setBottomTab(bottomTab === "queue" ? null : "queue")}
            >
              <ListMusic size={16} /> Queue
            </button>
            <button
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm transition-colors cursor-pointer ${
                bottomTab === "lyrics" ? "text-primary" : "text-white/50 hover:text-white/70"
              }`}
              onClick={() => setBottomTab(bottomTab === "lyrics" ? null : "lyrics")}
            >
              <Mic2 size={16} /> Lyrics
            </button>
          </div>

          {bottomTab === "queue" && (
            <QueuePanel
              queue={queue}
              currentIndex={currentIndex}
              onClose={() => setBottomTab(null)}
            />
          )}

          {bottomTab === "lyrics" && currentTrack && (
            <LyricsPanel
              artist={currentTrack.artist}
              title={currentTrack.title}
              currentTime={currentTime}
              onClose={() => setBottomTab(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
