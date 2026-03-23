import { useState, useRef, useCallback, forwardRef } from "react";
import { usePlayer } from "@/contexts/PlayerContext";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";
import { Button } from "@/components/ui/button";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
  ListMusic,
  Shuffle,
  Repeat,
  Repeat1,
  Mic2,
  Minimize2,
  Maximize2,
  Music,
} from "lucide-react";
import { formatDuration } from "@/lib/utils";
import { QueuePanel } from "./QueuePanel";
import { LyricsPanel } from "./Lyrics";

const MINI_KEY = "player-mini";
const VIZ_KEY = "player-viz";

function getStoredMini(): boolean {
  try { return localStorage.getItem(MINI_KEY) === "1"; } catch { return false; }
}

function getStoredViz(): "bars" | "wave" {
  try {
    const v = localStorage.getItem(VIZ_KEY);
    if (v === "wave") return "wave";
  } catch { /* ignore */ }
  return "bars";
}

// ── Cover fallback ──────────────────────────────────────────────

function CoverArt({ src, size, className }: { src?: string; size: number; className?: string }) {
  const [error, setError] = useState(false);
  const hasSrc = src && src.length > 0;

  if (!hasSrc || error) {
    return (
      <div className={`bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}>
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

// ── Visualizer renderers ────────────────────────────────────────

function BarVisualizer({ frequencies, className }: { frequencies: number[]; className?: string }) {
  if (frequencies.length === 0) return null;
  return (
    <div role="img" aria-label="Audio frequency visualization" className={`flex items-end overflow-hidden pointer-events-none ${className}`}>
      {frequencies.map((f, i) => (
        <div
          key={i}
          className="flex-1 bg-primary mx-px rounded-t-sm transition-[height] duration-75"
          style={{ height: `${f * 100}%` }}
        />
      ))}
    </div>
  );
}

function WaveVisualizer({ frequencies, className }: { frequencies: number[]; className?: string }) {
  if (frequencies.length === 0) return null;
  const len = frequencies.length;
  // aria handled by parent container
  // Mirror the frequencies for a symmetric wave
  const points: string[] = [];
  const h = 100;
  const w = 100;
  for (let i = 0; i < len; i++) {
    const x = (i / (len - 1)) * w;
    const amp = frequencies[i]! * 40;
    points.push(`${x},${h / 2 - amp}`);
  }
  const topLine = points.join(" ");
  // Mirror bottom
  const bottomPoints: string[] = [];
  for (let i = 0; i < len; i++) {
    const x = (i / (len - 1)) * w;
    const amp = frequencies[i]! * 25;
    bottomPoints.push(`${x},${h / 2 + amp}`);
  }
  const bottomLine = bottomPoints.join(" ");

  return (
    <div role="img" aria-label="Audio waveform visualization" className={`overflow-hidden pointer-events-none ${className}`}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full" aria-hidden="true">
        <polyline
          points={topLine}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.8"
          className="text-primary"
        />
        <polyline
          points={bottomLine}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.5"
          className="text-primary/50"
        />
      </svg>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────

export function AudioPlayer() {
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
    clearQueue,
    toggleShuffle,
    cycleRepeat,
    currentTrack,
    audioElement,
  } = usePlayer();

  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [mini, setMini] = useState(getStoredMini);
  const [vizMode, setVizMode] = useState<"bars" | "wave">(getStoredViz);
  const progressRef = useRef<HTMLDivElement>(null);

  const { frequencies } = useAudioVisualizer(audioElement, isPlaying);

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  function toggleMini() {
    const next = !mini;
    setMini(next);
    try { localStorage.setItem(MINI_KEY, next ? "1" : "0"); } catch { /* ignore */ }
    if (next) { setQueueOpen(false); setLyricsOpen(false); }
  }

  function cycleViz() {
    const next = vizMode === "bars" ? "wave" : "bars";
    setVizMode(next);
    try { localStorage.setItem(VIZ_KEY, next); } catch { /* ignore */ }
  }

  const Viz = vizMode === "wave" ? WaveVisualizer : BarVisualizer;

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  if (mini || isMobile) {
    return (
      <MiniPlayer
        track={currentTrack}
        isPlaying={isPlaying}
        progress={progress}
        currentTime={currentTime}
        duration={duration}
        frequencies={frequencies}
        vizMode={vizMode}
        onPlayPause={isPlaying ? pause : resume}
        onNext={next}
        onPrev={prev}
        onExpand={toggleMini}
        onClose={clearQueue}
      />
    );
  }

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-md border-t border-border h-20 flex items-center px-4 gap-4 animate-in slide-in-from-bottom duration-300">
        {/* Visualizer background */}
        <Viz frequencies={frequencies} className="absolute inset-0 opacity-[0.07]" />

        {/* Left: cover + track info */}
        <div className="flex items-center gap-3 min-w-0 w-[260px] flex-shrink-0 relative z-10">
          <div className="relative flex-shrink-0">
            <CoverArt src={currentTrack.albumCover} size={56} className="rounded-lg shadow-lg" />
            {isPlaying && (
              <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                <Equalizer />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{currentTrack.title}</div>
            <div className="text-xs text-muted-foreground truncate">{currentTrack.artist}</div>
          </div>
        </div>

        {/* Center: controls + progress */}
        <div className="flex-1 flex flex-col items-center gap-1.5 max-w-[600px] mx-auto relative z-10">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${shuffle ? "text-primary" : "text-muted-foreground"}`}
              onClick={toggleShuffle}
            >
              <Shuffle size={14} />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prev}>
              <SkipBack size={16} />
            </Button>
            <Button
              size="icon"
              className="h-9 w-9 rounded-full bg-foreground text-background hover:bg-foreground/90"
              onClick={isPlaying ? pause : resume}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={next}>
              <SkipForward size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-7 w-7 ${repeat !== "off" ? "text-primary" : "text-muted-foreground"}`}
              onClick={cycleRepeat}
            >
              {repeat === "one" ? <Repeat1 size={14} /> : <Repeat size={14} />}
            </Button>
          </div>
          <div className="flex items-center gap-2 w-full">
            <span className="text-[10px] text-muted-foreground font-mono w-10 text-right">
              {formatDuration(Math.floor(currentTime))}
            </span>
            <ProgressBar
              ref={progressRef}
              progress={progress}
              onSeek={(pct) => seek(pct * duration)}
            />
            <span className="text-[10px] text-muted-foreground font-mono w-10">
              {formatDuration(Math.floor(duration))}
            </span>
          </div>
        </div>

        {/* Right: viz toggle + lyrics + queue + volume + mini + close */}
        <div className="flex items-center gap-1 w-[240px] flex-shrink-0 justify-end relative z-10">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={cycleViz}
            title={`Visualizer: ${vizMode}`}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              {vizMode === "bars" ? (
                // Bars icon
                <>
                  <rect x="1" y="8" width="2" height="6" rx="0.5" />
                  <rect x="5" y="4" width="2" height="10" rx="0.5" />
                  <rect x="9" y="6" width="2" height="8" rx="0.5" />
                  <rect x="13" y="2" width="2" height="12" rx="0.5" />
                </>
              ) : (
                // Wave icon
                <path d="M0 8 Q4 2, 8 8 Q12 14, 16 8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              )}
            </svg>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${lyricsOpen ? "text-primary" : "text-muted-foreground"}`}
            onClick={() => { setLyricsOpen(!lyricsOpen); setQueueOpen(false); }}
          >
            <Mic2 size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${queueOpen ? "text-primary" : "text-muted-foreground"}`}
            onClick={() => { setQueueOpen(!queueOpen); setLyricsOpen(false); }}
          >
            <ListMusic size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
          >
            {volume > 0 ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </Button>
          <VolumeSlider volume={volume} onChange={setVolume} />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={toggleMini}
            title="Mini player"
          >
            <Minimize2 size={14} />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={clearQueue}>
            <X size={14} />
          </Button>
        </div>
      </div>

      {queueOpen && (
        <QueuePanel
          queue={queue}
          currentIndex={currentIndex}
          onClose={() => setQueueOpen(false)}
        />
      )}

      {lyricsOpen && currentTrack && (
        <LyricsPanel
          artist={currentTrack.artist}
          title={currentTrack.title}
          currentTime={currentTime}
          onClose={() => setLyricsOpen(false)}
        />
      )}
    </>
  );
}

// ── Mini Player ─────────────────────────────────────────────────

function MiniPlayer({
  track,
  isPlaying,
  progress,
  currentTime,
  duration,
  frequencies,
  vizMode,
  onPlayPause,
  onNext,
  onPrev,
  onExpand,
  onClose,
}: {
  track: { title: string; artist: string; albumCover?: string };
  isPlaying: boolean;
  progress: number;
  currentTime: number;
  duration: number;
  frequencies: number[];
  vizMode: "bars" | "wave";
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onExpand: () => void;
  onClose: () => void;
}) {
  const Viz = vizMode === "wave" ? WaveVisualizer : BarVisualizer;

  return (
    <div className="fixed bottom-0 left-0 right-0 md:bottom-4 md:left-auto md:right-4 z-50 md:w-[360px] bg-card/95 backdrop-blur-md border-t md:border border-border md:rounded-2xl shadow-2xl animate-in slide-in-from-bottom-4 duration-300 overflow-hidden">
      {/* Background album art — blurred */}
      {track.albumCover && (
        <img
          src={track.albumCover}
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-10 blur-2xl scale-110 pointer-events-none"
        />
      )}

      {/* Visualizer background */}
      <Viz frequencies={frequencies} className="absolute bottom-0 left-0 right-0 h-full opacity-[0.08]" />

      {/* Progress bar */}
      <div className="h-1 bg-white/5 overflow-hidden relative z-10">
        <div
          className="h-full bg-primary transition-[width] duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center gap-3 p-3 relative z-10">
        {/* Cover art */}
        <div className="relative flex-shrink-0">
          <CoverArt src={track.albumCover} size={48} className="rounded-lg shadow-lg" />
          {isPlaying && (
            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary flex items-center justify-center">
              <Equalizer small />
            </div>
          )}
        </div>

        {/* Track info */}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{track.title}</div>
          <div className="text-[11px] text-muted-foreground truncate">{track.artist}</div>
          <div className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">
            {formatDuration(Math.floor(currentTime))} / {formatDuration(Math.floor(duration))}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-0 flex-shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPrev}>
            <SkipBack size={13} />
          </Button>
          <Button
            size="icon"
            className="h-9 w-9 rounded-full bg-foreground text-background hover:bg-foreground/90"
            onClick={onPlayPause}
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onNext}>
            <SkipForward size={13} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground ml-1"
            onClick={onExpand}
          >
            <Maximize2 size={11} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={onClose}
          >
            <X size={11} />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function Equalizer({ small }: { small?: boolean }) {
  const h = small ? "h-2" : "h-2.5";
  const w = small ? "w-[2px]" : "w-[2.5px]";
  return (
    <div className={`flex items-end gap-[1.5px] ${h} flex-shrink-0`}>
      <span className={`equalizer-bar ${w} bg-primary-foreground rounded-sm`} style={{ animationDelay: "0ms" }} />
      <span className={`equalizer-bar ${w} bg-primary-foreground rounded-sm`} style={{ animationDelay: "150ms" }} />
      <span className={`equalizer-bar ${w} bg-primary-foreground rounded-sm`} style={{ animationDelay: "300ms" }} />
    </div>
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
      className="flex-1 h-1.5 bg-secondary rounded-full cursor-pointer group relative"
      onClick={handleClick}
    >
      <div
        className="h-full bg-primary rounded-full transition-[width] duration-100"
        style={{ width: `${progress}%` }}
      />
      <div
        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
        style={{ left: `${progress}%`, marginLeft: "-6px" }}
      />
    </div>
  );
});

function VolumeSlider({
  volume,
  onChange,
}: {
  volume: number;
  onChange: (v: number) => void;
}) {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onChange(pct);
    },
    [onChange],
  );

  return (
    <div
      className="w-20 h-1 bg-secondary rounded-full cursor-pointer group"
      onClick={handleClick}
    >
      <div
        className="h-full bg-muted-foreground group-hover:bg-primary rounded-full transition-colors"
        style={{ width: `${volume * 100}%` }}
      />
    </div>
  );
}
