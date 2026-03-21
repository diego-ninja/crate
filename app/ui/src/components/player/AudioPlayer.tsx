import { useState } from "react";
import { usePlayer } from "@/contexts/PlayerContext";
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
import { useRef, useCallback } from "react";
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
  } = usePlayer();

  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [mini, setMini] = useState(getStoredMini);
  const progressRef = useRef<HTMLDivElement>(null);

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  function toggleMini() {
    const next = !mini;
    setMini(next);
    try { localStorage.setItem(MINI_KEY, next ? "1" : "0"); } catch { /* ignore */ }
    if (next) { setQueueOpen(false); setLyricsOpen(false); }
  }

  // Force mini on mobile (check window width)
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  if (mini || isMobile) {
    return (
      <MiniPlayer
        track={currentTrack}
        isPlaying={isPlaying}
        progress={progress}
        onPlayPause={isPlaying ? pause : resume}
        onNext={next}
        onExpand={toggleMini}
        onClose={clearQueue}
      />
    );
  }

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border h-16 flex items-center px-4 gap-4 animate-in slide-in-from-bottom duration-300">
        {/* Left: cover + track info + equalizer */}
        <div className="flex items-center gap-3 min-w-0 w-[220px] flex-shrink-0">
          {currentTrack.albumCover && (
            <img
              src={currentTrack.albumCover}
              alt=""
              className="w-10 h-10 rounded object-cover flex-shrink-0 bg-secondary"
            />
          )}
          <div className="min-w-0 flex items-center gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{currentTrack.title}</div>
              <div className="text-xs text-muted-foreground truncate">{currentTrack.artist}</div>
            </div>
            {isPlaying && <Equalizer />}
          </div>
        </div>

        {/* Center: controls + progress */}
        <div className="flex-1 flex flex-col items-center gap-1 max-w-[600px] mx-auto">
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
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={isPlaying ? pause : resume}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
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
        <div className="flex items-center gap-1 w-[220px] flex-shrink-0 justify-end">
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
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={clearQueue}>
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
          onClose={() => setLyricsOpen(false)}
        />
      )}
    </>
  );
}

function MiniPlayer({
  track,
  isPlaying,
  progress,
  onPlayPause,
  onNext,
  onExpand,
  onClose,
}: {
  track: { title: string; artist: string; albumCover?: string };
  isPlaying: boolean;
  progress: number;
  onPlayPause: () => void;
  onNext: () => void;
  onExpand: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 md:bottom-4 md:left-auto md:right-4 z-50 md:w-[320px] bg-card border-t md:border border-border md:rounded-xl shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
      {/* Progress bar on top */}
      <div className="h-0.5 bg-secondary rounded-t-xl overflow-hidden">
        <div
          className="h-full bg-primary transition-[width] duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex items-center gap-3 p-3">
        {track.albumCover ? (
          <img
            src={track.albumCover}
            alt=""
            className="w-11 h-11 rounded-lg object-cover flex-shrink-0 bg-secondary"
          />
        ) : (
          <div className="w-11 h-11 rounded-lg bg-secondary flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{track.title}</div>
          <div className="text-[11px] text-muted-foreground truncate">{track.artist}</div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onPlayPause}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onNext}>
            <SkipForward size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={onExpand}
            title="Full player"
          >
            <Maximize2 size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={onClose}
          >
            <X size={12} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Equalizer() {
  return (
    <div className="flex items-end gap-[2px] h-3 flex-shrink-0">
      <span className="equalizer-bar w-[3px] bg-primary rounded-sm" style={{ animationDelay: "0ms" }} />
      <span className="equalizer-bar w-[3px] bg-primary rounded-sm" style={{ animationDelay: "150ms" }} />
      <span className="equalizer-bar w-[3px] bg-primary rounded-sm" style={{ animationDelay: "300ms" }} />
    </div>
  );
}

import { forwardRef } from "react";

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
      className="flex-1 h-1 bg-secondary rounded-full cursor-pointer group"
      onClick={handleClick}
    >
      <div
        className="h-full bg-primary rounded-full transition-[width] duration-100 group-hover:bg-primary/80"
        style={{ width: `${progress}%` }}
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
      className="w-20 h-1 bg-secondary rounded-full cursor-pointer"
      onClick={handleClick}
    >
      <div
        className="h-full bg-muted-foreground rounded-full"
        style={{ width: `${volume * 100}%` }}
      />
    </div>
  );
}
