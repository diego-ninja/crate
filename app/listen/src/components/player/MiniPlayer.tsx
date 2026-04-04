import { useState } from "react";
import { Play, Pause, SkipForward, Loader2 } from "lucide-react";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { FullscreenPlayer } from "@/components/player/FullscreenPlayer";

export function MiniPlayer() {
  const { currentTrack, isPlaying, isBuffering, currentTime, duration } = usePlayer();
  const { pause, resume, next } = usePlayerActions();
  const [fsOpen, setFsOpen] = useState(false);

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <>
      <div
        className="relative h-[52px] cursor-pointer border-t border-white/5 bg-panel-surface"
        onClick={() => setFsOpen(true)}
      >
        {/* Progress bar at top edge */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-white/10">
          <div
            className="h-full bg-cyan-400 transition-[width] duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex items-center h-full px-3 gap-3">
          {/* Album art */}
          {currentTrack.albumCover ? (
            <img
              src={currentTrack.albumCover}
              alt=""
              className="w-9 h-9 rounded object-cover shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded bg-white/10 shrink-0" />
          )}

          {/* Track info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{currentTrack.title}</p>
            <p className="text-xs text-white/50 truncate">{currentTrack.artist}</p>
          </div>

          {/* Play/pause + skip */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              isPlaying ? pause() : resume();
            }}
            className="w-11 h-11 flex items-center justify-center text-white"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isBuffering ? (
              <Loader2 size={20} className="animate-spin" />
            ) : isPlaying ? (
              <Pause size={22} />
            ) : (
              <Play size={22} className="ml-0.5" />
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            className="w-11 h-11 flex items-center justify-center text-white/60"
            aria-label="Next track"
          >
            <SkipForward size={20} />
          </button>
        </div>
      </div>

      <FullscreenPlayer open={fsOpen} onClose={() => setFsOpen(false)} />
    </>
  );
}
