import { useRef, useCallback } from "react";
import { usePlayer } from "@/contexts/PlayerContext";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";
import { cn, formatDuration } from "@/lib/utils";
import {
  Play, Pause, SkipBack, SkipForward, ChevronUp, Volume2, VolumeX,
  Music, X,
} from "lucide-react";

interface BottomBarProps {
  onTogglePlayer: () => void;
  playerOpen: boolean;
}

export function BottomBar({ onTogglePlayer, playerOpen }: BottomBarProps) {
  const {
    currentTrack, isPlaying, currentTime, duration, volume, queue, currentIndex,
    pause, resume, next, prev, seek, setVolume, clearQueue, audioElement,
  } = usePlayer();
  const { frequencies } = useAudioVisualizer(audioElement, isPlaying);

  const volumeRef = useRef<HTMLDivElement>(null);
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setVolume(Math.max(0, Math.min(1, volume + delta)));
  }, [volume, setVolume]);

  if (!currentTrack) return null;

  const nextTracks = queue.slice(currentIndex + 1, currentIndex + 4);
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 h-24 bg-card/95 backdrop-blur-md border-t border-border">
      {/* Background visualizer bars */}
      <div className="absolute inset-0 opacity-[0.06] overflow-hidden">
        <div className="flex items-end h-full gap-[2px] px-4">
          {frequencies.slice(0, 64).map((f, i) => (
            <div key={i} className="flex-1 bg-primary transition-all duration-75"
              style={{ height: `${f * 100}%` }} />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="relative h-full flex items-center gap-4 px-4">
        {/* Cover + Info */}
        <button onClick={onTogglePlayer} className="flex items-center gap-3 min-w-0 flex-shrink-0">
          <div className="w-14 h-14 rounded-lg overflow-hidden bg-secondary flex-shrink-0 ring-1 ring-primary/20">
            {currentTrack.albumCover ? (
              <img src={currentTrack.albumCover} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Music size={20} className="text-muted-foreground/30" />
              </div>
            )}
          </div>
          <div className="min-w-0 text-left">
            <div className="text-sm font-semibold truncate max-w-[200px]">{currentTrack.title}</div>
            <div className="text-xs text-muted-foreground truncate max-w-[200px]">
              {currentTrack.artist}
            </div>
          </div>
        </button>

        {/* Center: Controls + Progress */}
        <div className="flex-1 flex flex-col items-center justify-center gap-1 max-w-[500px] mx-auto">
          <div className="flex items-center gap-3">
            <button onClick={prev} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
              <SkipBack size={18} />
            </button>
            <button onClick={isPlaying ? pause : resume}
              className="w-9 h-9 rounded-full bg-primary flex items-center justify-center hover:bg-primary/90 transition-colors">
              {isPlaying ? <Pause size={16} className="text-primary-foreground" /> : <Play size={16} className="text-primary-foreground ml-0.5" />}
            </button>
            <button onClick={next} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
              <SkipForward size={18} />
            </button>
          </div>
          {/* Progress bar */}
          <div className="w-full flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="w-8 text-right font-mono">{formatDuration(Math.floor(currentTime))}</span>
            <div className="flex-1 h-1.5 bg-border rounded-full cursor-pointer group relative"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                seek(Math.max(0, Math.min(1, pct)) * duration);
              }}>
              <div className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${progress}%` }} />
              <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                style={{ left: `calc(${progress}% - 6px)` }} />
            </div>
            <span className="w-8 font-mono">{formatDuration(Math.floor(duration))}</span>
          </div>
        </div>

        {/* Right: Mini queue + Volume + Toggle */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Mini queue pills */}
          <div className="hidden lg:flex items-center gap-1.5">
            {nextTracks.map((t, i) => (
              <div key={i} className="flex items-center gap-1.5 bg-muted/30 rounded-full px-2 py-1 max-w-[120px]">
                <div className="w-5 h-5 rounded-full overflow-hidden bg-secondary flex-shrink-0">
                  {t.albumCover && <img src={t.albumCover} alt="" className="w-full h-full object-cover" />}
                </div>
                <span className="text-[10px] text-muted-foreground truncate">{t.title}</span>
              </div>
            ))}
          </div>

          {/* Volume with wheel support */}
          <div ref={volumeRef} className="hidden md:flex items-center gap-1.5" onWheel={handleWheel}>
            <button onClick={() => setVolume(volume > 0 ? 0 : 0.8)} className="text-muted-foreground hover:text-foreground">
              {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input type="range" min={0} max={1} step={0.01} value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-20 h-1 accent-primary" />
          </div>

          {/* Open floating player */}
          <button onClick={onTogglePlayer}
            className={cn("p-2 rounded-lg transition-colors",
              playerOpen ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>
            <ChevronUp size={18} />
          </button>

          {/* Clear queue */}
          <button onClick={clearQueue} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors">
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
