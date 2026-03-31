import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import {
  ChevronDown,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  ListMusic,
} from "lucide-react";
import { usePlayer } from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { formatDuration } from "@/lib/utils";

interface FullscreenPlayerProps {
  open: boolean;
  onClose: () => void;
}

export function FullscreenPlayer({ open, onClose }: FullscreenPlayerProps) {
  const {
    currentTrack,
    queue,
    currentIndex,
    isPlaying,
    currentTime,
    duration,
    shuffle,
    repeat,
    pause,
    resume,
    next,
    prev,
    seek,
    toggleShuffle,
    cycleRepeat,
    jumpTo,
  } = usePlayer();
  const navigate = useNavigate();

  const [showQueue, setShowQueue] = useState(false);
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const { isLiked, likeTrack, unlikeTrack } = useLikedTracks();

  // Animate in/out
  useEffect(() => {
    if (open) {
      setVisible(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimating(true));
      });
    } else {
      setAnimating(false);
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const handleSeek = useCallback(
    (clientX: number) => {
      if (!progressRef.current) return;
      const rect = progressRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      seek(pct * duration);
    },
    [duration, seek],
  );

  const onProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      handleSeek(e.clientX);
    },
    [handleSeek],
  );

  const onProgressTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      handleSeek(e.touches[0]!.clientX);
    },
    [handleSeek],
  );

  const onProgressTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (draggingRef.current) {
        handleSeek(e.touches[0]!.clientX);
      }
    },
    [handleSeek],
  );

  const onProgressTouchEnd = useCallback(() => {
    draggingRef.current = false;
  }, []);

  async function toggleLike() {
    if (!currentTrack) return;
    const trackId = currentTrack.libraryTrackId ?? null;
    const trackPath = currentTrack.path || currentTrack.id;
    if (liked) {
      await unlikeTrack(trackId, trackPath).catch(
        () => {},
      );
    } else {
      await likeTrack(trackId, trackPath).catch(
        () => {},
      );
    }
  }

  function goToArtist() {
    if (!currentTrack?.artist) return;
    onClose();
    navigate(`/artist/${encodeURIComponent(currentTrack.artist)}`);
  }

  if (!visible || !currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const upcomingTracks = queue.slice(currentIndex + 1, currentIndex + 6);
  const liked = isLiked(currentTrack.libraryTrackId ?? null, currentTrack.path || currentTrack.id);

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col transition-all duration-300 ease-out ${
        animating
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-full"
      }`}
      style={{
        background: "linear-gradient(180deg, #1a2030 0%, #0a0a0f 100%)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-[env(safe-area-inset-top,12px)] pb-2">
        <button
          onClick={onClose}
          className="w-11 h-11 flex items-center justify-center -ml-2 text-white/60 active:text-white"
        >
          <ChevronDown size={28} />
        </button>
        <p className="text-xs text-white/40 uppercase tracking-widest font-medium">
          Now Playing
        </p>
        <div className="w-11" />
      </div>

      {/* Scrollable body */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 overflow-y-auto">
        {/* Album Cover */}
        <div className="w-[280px] h-[280px] rounded-xl overflow-hidden shadow-2xl shadow-black/60 shrink-0">
          {currentTrack.albumCover ? (
            <img
              src={currentTrack.albumCover}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-white/5 flex items-center justify-center">
              <ListMusic size={64} className="text-white/10" />
            </div>
          )}
        </div>

        {/* Track info */}
        <div className="w-full mt-8 text-center">
          <h2 className="text-xl font-bold text-white truncate">
            {currentTrack.title}
          </h2>
          <button
            onClick={goToArtist}
            className="text-sm text-white/50 hover:text-cyan-400 active:text-cyan-400 transition-colors mt-1"
          >
            {currentTrack.artist}
          </button>
        </div>

        {/* Progress bar */}
        <div className="w-full mt-8">
          <div
            ref={progressRef}
            className="w-full h-2 bg-white/10 rounded-full cursor-pointer relative group"
            onClick={onProgressClick}
            onTouchStart={onProgressTouchStart}
            onTouchMove={onProgressTouchMove}
            onTouchEnd={onProgressTouchEnd}
          >
            <div
              className="h-full bg-cyan-400 rounded-full relative"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
          <div className="flex justify-between mt-2">
            <span className="text-xs text-white/40 tabular-nums">
              {formatDuration(currentTime)}
            </span>
            <span className="text-xs text-white/40 tabular-nums">
              {formatDuration(duration)}
            </span>
          </div>
        </div>

        {/* Main controls */}
        <div className="flex items-center justify-center gap-8 mt-6">
          <button
            onClick={prev}
            className="w-12 h-12 flex items-center justify-center text-white/70 active:text-white transition-colors"
          >
            <SkipBack size={28} fill="currentColor" />
          </button>
          <button
            onClick={isPlaying ? pause : resume}
            className="w-14 h-14 rounded-full bg-cyan-500 flex items-center justify-center active:bg-cyan-600 transition-colors shadow-lg shadow-cyan-500/25"
          >
            {isPlaying ? (
              <Pause size={28} className="text-white" fill="white" />
            ) : (
              <Play size={28} className="text-white ml-1" fill="white" />
            )}
          </button>
          <button
            onClick={next}
            className="w-12 h-12 flex items-center justify-center text-white/70 active:text-white transition-colors"
          >
            <SkipForward size={28} fill="currentColor" />
          </button>
        </div>

        {/* Secondary controls */}
        <div className="flex items-center justify-center gap-10 mt-6">
          <button
            onClick={toggleShuffle}
            className={`w-11 h-11 flex items-center justify-center transition-colors ${
              shuffle ? "text-cyan-400" : "text-white/40 active:text-white/70"
            }`}
          >
            <Shuffle size={20} />
          </button>
          <button
            onClick={toggleLike}
            className={`w-11 h-11 flex items-center justify-center transition-colors ${
              liked ? "text-red-400" : "text-white/40 active:text-white/70"
            }`}
          >
            <Heart size={20} fill={liked ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => setShowQueue((q) => !q)}
            className={`w-11 h-11 flex items-center justify-center transition-colors ${
              showQueue
                ? "text-cyan-400"
                : "text-white/40 active:text-white/70"
            }`}
          >
            <ListMusic size={20} />
          </button>
          <button
            onClick={cycleRepeat}
            className={`w-11 h-11 flex items-center justify-center transition-colors ${
              repeat !== "off"
                ? "text-cyan-400"
                : "text-white/40 active:text-white/70"
            }`}
          >
            {repeat === "one" ? <Repeat1 size={20} /> : <Repeat size={20} />}
          </button>
        </div>
      </div>

      {/* Queue section */}
      {showQueue && (
        <div className="border-t border-white/10 bg-black/30 max-h-52 overflow-y-auto">
          <div className="px-4 py-3">
            <p className="text-xs text-white/40 uppercase tracking-wider font-medium mb-2">
              Up Next
            </p>
            {upcomingTracks.length === 0 && (
              <p className="text-sm text-white/20 py-2">Nothing queued</p>
            )}
            {upcomingTracks.map((track, i) => {
              const queueIndex = currentIndex + 1 + i;
              return (
                <button
                  key={`${track.id}-${queueIndex}`}
                  onClick={() => jumpTo(queueIndex)}
                  className="flex items-center gap-3 w-full py-2 text-left active:bg-white/5 rounded-lg transition-colors"
                >
                  {track.albumCover ? (
                    <img
                      src={track.albumCover}
                      alt=""
                      className="w-8 h-8 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded bg-white/10 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{track.title}</p>
                    <p className="text-xs text-white/40 truncate">
                      {track.artist}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
