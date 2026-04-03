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
  AlignLeft,
  Disc3,
} from "lucide-react";
import { usePlayer } from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { formatDuration } from "@/lib/utils";

type FSTab = "player" | "queue" | "lyrics";

interface LyricLine { time: number; text: string; }

function parseSyncedLyrics(raw: string): LyricLine[] {
  return raw.split("\n").reduce<LyricLine[]>((acc, line) => {
    const m = line.match(/^\[(\d+):(\d+)\.(\d+)\](.*)/);
    if (m) acc.push({ time: +m[1]! * 60 + +m[2]! + +m[3]! / 100, text: m[4]!.trim() });
    return acc;
  }, []);
}

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

  const [activeTab, setActiveTab] = useState<FSTab>("player");
  const [lyrics, setLyrics] = useState<{ synced: LyricLine[] | null; plain: string | null } | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [swipeY, setSwipeY] = useState(0);
  const swipeStartRef = useRef<number | null>(null);
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

  useEscapeKey(visible, (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (activeTab !== "player") {
      setActiveTab("player");
      return;
    }
    onClose();
  });

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

  // Lyrics fetch
  useEffect(() => {
    if (!visible || !currentTrack) { setLyrics(null); return; }
    let cancelled = false;
    setLyrics(null);
    fetch(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(currentTrack.artist || "")}&track_name=${encodeURIComponent(currentTrack.title || "")}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (cancelled || !d) return;
        setLyrics({
          synced: d.syncedLyrics ? parseSyncedLyrics(d.syncedLyrics) : null,
          plain: d.plainLyrics || null,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [visible, currentTrack?.id]);

  // Active lyric index
  const activeLyricIndex = lyrics?.synced
    ? (() => { for (let i = (lyrics.synced?.length ?? 0) - 1; i >= 0; i--) { if (currentTime >= lyrics.synced![i]!.time) return i; } return -1; })()
    : -1;

  // Auto-scroll lyrics
  useEffect(() => {
    if (activeTab !== "lyrics" || !activeLyricRef.current) return;
    activeLyricRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeLyricIndex, activeTab]);

  // Reset tab when player closes
  useEffect(() => { if (!visible) { setActiveTab("player"); setSwipeY(0); } }, [visible]);

  // Swipe-down to dismiss
  const onSwipeStart = useCallback((e: React.TouchEvent) => {
    if (draggingRef.current) return;
    swipeStartRef.current = e.touches[0]!.clientY;
  }, []);
  const onSwipeMove = useCallback((e: React.TouchEvent) => {
    if (swipeStartRef.current === null || draggingRef.current) return;
    const dy = e.touches[0]!.clientY - swipeStartRef.current;
    setSwipeY(Math.max(0, dy));
  }, []);
  const onSwipeEnd = useCallback(() => {
    if (swipeY > 120) {
      onClose();
    }
    setSwipeY(0);
    swipeStartRef.current = null;
  }, [swipeY, onClose]);

  if (!visible || !currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const upcomingTracks = queue.slice(currentIndex + 1, currentIndex + 20);
  const liked = isLiked(currentTrack.libraryTrackId ?? null, currentTrack.path || currentTrack.id);

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col ease-out ${
        animating
          ? "opacity-100"
          : "opacity-0 translate-y-full"
      }`}
      style={{
        background: "linear-gradient(180deg, #1a2030 0%, #0a0a0f 100%)",
        transform: swipeY > 0 ? `translateY(${swipeY}px)` : undefined,
        transition: swipeY > 0 ? "none" : "all 300ms ease-out",
        opacity: swipeY > 0 ? Math.max(0.3, 1 - swipeY / 400) : undefined,
      }}
      onTouchStart={onSwipeStart}
      onTouchMove={onSwipeMove}
      onTouchEnd={onSwipeEnd}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-[env(safe-area-inset-top,12px)] pb-2">
        <button
          onClick={onClose}
          className="w-11 h-11 flex items-center justify-center -ml-2 text-white/60 active:text-white"
        >
          <ChevronDown size={28} />
        </button>
        <div className="flex gap-4">
          {(["player", "queue", "lyrics"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`text-xs uppercase tracking-widest font-medium transition-colors ${activeTab === t ? "text-white" : "text-white/30 active:text-white/60"}`}
            >
              {t === "player" ? <Disc3 size={14} /> : t === "queue" ? <ListMusic size={14} /> : <AlignLeft size={14} />}
            </button>
          ))}
        </div>
        <div className="w-11" />
      </div>

      {/* Tab content */}
      {activeTab === "player" && (
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
            className="w-full h-3 bg-white/10 rounded-full cursor-pointer relative group"
            onClick={onProgressClick}
            onTouchStart={onProgressTouchStart}
            onTouchMove={onProgressTouchMove}
            onTouchEnd={onProgressTouchEnd}
          >
            <div
              className="h-full bg-cyan-400 rounded-full relative"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-5 h-5 bg-white rounded-full shadow-md" />
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
            onClick={() => setActiveTab("queue")}
            className="w-11 h-11 flex items-center justify-center transition-colors text-white/40 active:text-white/70"
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
      )}

      {/* Queue tab */}
      {activeTab === "queue" && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-3">
            <p className="text-xs text-white/40 uppercase tracking-wider font-medium mb-2">
              Up Next · {upcomingTracks.length} tracks
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
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm text-white">{track.title}</p>
                      {track.isSuggested ? (
                        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-cyan-300">
                          Suggested
                        </span>
                      ) : null}
                    </div>
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

      {/* Lyrics tab */}
      {activeTab === "lyrics" && (
        <div ref={lyricsContainerRef} className="flex-1 overflow-y-auto px-6 py-4">
          {!lyrics ? (
            <p className="text-center text-white/30 text-sm mt-20">Loading lyrics...</p>
          ) : lyrics.synced ? (
            <div className="flex flex-col items-center gap-2 py-8">
              {lyrics.synced.map((line, i) => (
                <button
                  key={i}
                  ref={i === activeLyricIndex ? activeLyricRef : null}
                  onClick={() => seek(line.time)}
                  className={`text-center text-lg font-medium transition-all duration-300 ${
                    i === activeLyricIndex
                      ? "text-white scale-105"
                      : i < activeLyricIndex
                        ? "text-white/25"
                        : "text-white/40"
                  }`}
                >
                  {line.text || "♪"}
                </button>
              ))}
            </div>
          ) : lyrics.plain ? (
            <pre className="text-sm text-white/50 whitespace-pre-wrap text-center leading-relaxed py-8">{lyrics.plain}</pre>
          ) : (
            <p className="text-center text-white/30 text-sm mt-20">No lyrics available</p>
          )}
        </div>
      )}
    </div>
  );
}
