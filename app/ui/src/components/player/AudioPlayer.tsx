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
} from "lucide-react";
import { formatDuration } from "@/lib/utils";
import { QueuePanel } from "./QueuePanel";
import { LyricsPanel } from "./Lyrics";

const MINI_KEY = "player-mini";

function getStoredMini(): boolean {
  try { return localStorage.getItem(MINI_KEY) === "1"; } catch { return false; }
}

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
        {/* Frequency visualizer background */}
        {frequencies.length > 0 && (
          <div className="absolute inset-0 flex items-end justify-center overflow-hidden opacity-[0.07] pointer-events-none">
            {frequencies.map((f, i) => (
              <div
                key={i}
                className="flex-1 bg-primary mx-px rounded-t-sm transition-[height] duration-75"
                style={{ height: `${f * 100}%` }}
              />
            ))}
          </div>
        )}

        {/* Left: cover + track info */}
        <div className="flex items-center gap-3 min-w-0 w-[260px] flex-shrink-0 relative z-10">
          <div className="relative flex-shrink-0">
            <img
              src={currentTrack.albumCover || ""}
              alt=""
              className="w-14 h-14 rounded-lg object-cover bg-secondary shadow-lg"
              onError={(e) => { (e.target as HTMLImageElement).src = ""; }}
            />
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

        {/* Right: lyrics + queue + volume + mini + close */}
        <div className="flex items-center gap-1 w-[220px] flex-shrink-0 justify-end relative z-10">
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
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onExpand: () => void;
  onClose: () => void;
}) {
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

      {/* Frequency visualizer as subtle background */}
      {frequencies.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-full flex items-end overflow-hidden opacity-[0.08] pointer-events-none">
          {frequencies.slice(0, 32).map((f, i) => (
            <div
              key={i}
              className="flex-1 bg-primary mx-px rounded-t-sm transition-[height] duration-75"
              style={{ height: `${f * 100}%` }}
            />
          ))}
        </div>
      )}

      {/* Progress bar on top */}
      <div className="h-1 bg-white/5 overflow-hidden relative z-10">
        <div
          className="h-full bg-primary transition-[width] duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center gap-3 p-3 relative z-10">
        {/* Cover art */}
        <div className="relative flex-shrink-0">
          <img
            src={track.albumCover || ""}
            alt=""
            className="w-12 h-12 rounded-lg object-cover bg-secondary shadow-lg"
            onError={(e) => { (e.target as HTMLImageElement).src = ""; }}
          />
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
      {/* Scrubber dot */}
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
