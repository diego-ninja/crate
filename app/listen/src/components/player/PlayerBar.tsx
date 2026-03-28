import { useNavigate } from "react-router";
import { Play, Pause, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { usePlayer } from "@/contexts/PlayerContext";

function formatTime(s: number): string {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function PlayerBar() {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
  } = usePlayer();
  const navigate = useNavigate();

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 h-16 bg-[#0f0f17] border-t border-white/5 flex items-center px-4 gap-4">
      {/* Left: track info */}
      <button
        className="flex items-center gap-3 min-w-0 w-56 shrink-0 text-left"
        onClick={() => {
          if (currentTrack.artist && currentTrack.album) {
            navigate(`/album/${encodeURIComponent(currentTrack.artist)}/${encodeURIComponent(currentTrack.album)}`);
          }
        }}
      >
        {currentTrack.albumCover ? (
          <img
            src={currentTrack.albumCover}
            alt=""
            className="w-10 h-10 rounded object-cover shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded bg-white/10 shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{currentTrack.title}</p>
          <p className="text-xs text-white/50 truncate">{currentTrack.artist}</p>
        </div>
      </button>

      {/* Center: controls + progress */}
      <div className="flex-1 flex flex-col items-center gap-1 max-w-xl mx-auto">
        <div className="flex items-center gap-4">
          <button onClick={prev} className="text-white/60 hover:text-white transition-colors">
            <SkipBack size={18} />
          </button>
          <button
            onClick={isPlaying ? pause : resume}
            className="w-8 h-8 rounded-full bg-white flex items-center justify-center hover:scale-105 transition-transform"
          >
            {isPlaying ? (
              <Pause size={16} className="text-black" />
            ) : (
              <Play size={16} className="text-black ml-0.5" />
            )}
          </button>
          <button onClick={next} className="text-white/60 hover:text-white transition-colors">
            <SkipForward size={18} />
          </button>
        </div>
        <div className="flex items-center gap-2 w-full">
          <span className="text-[10px] text-white/40 w-8 text-right tabular-nums">
            {formatTime(currentTime)}
          </span>
          <div
            className="flex-1 h-1 bg-white/10 rounded-full cursor-pointer group relative"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              seek(pct * duration);
            }}
          >
            <div
              className="h-full bg-cyan-400 rounded-full transition-[width] duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] text-white/40 w-8 tabular-nums">
            {formatTime(duration)}
          </span>
        </div>
      </div>

      {/* Right: volume */}
      <div className="flex items-center gap-2 w-36 shrink-0 justify-end">
        <Volume2 size={16} className="text-white/50" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="w-20 accent-cyan-400"
        />
      </div>
    </div>
  );
}
