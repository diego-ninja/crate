import { Play, Pause } from "lucide-react";
import { usePlayer } from "@/contexts/PlayerContext";

export function MiniPlayer() {
  const { currentTrack, isPlaying, currentTime, duration, pause, resume } = usePlayer();

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="relative h-[52px] bg-[#0f0f17] border-t border-white/5">
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

        {/* Play/pause */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            isPlaying ? pause() : resume();
          }}
          className="w-8 h-8 flex items-center justify-center text-white"
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
        </button>
      </div>
    </div>
  );
}
