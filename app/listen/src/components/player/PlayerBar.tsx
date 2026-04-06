import { useMemo, useRef, useState } from "react";
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, Airplay, ListMusic, Mic2, Maximize2, Loader2,
} from "lucide-react";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";
import { useDismissibleLayer } from "@/hooks/use-dismissible-layer";
import { toast } from "sonner";
import { QueuePanel } from "@/components/player/QueuePanel";
import { LyricsPanel } from "@/components/player/LyricsPanel";
import { ExtendedPlayer } from "@/components/player/ExtendedPlayer";
import { PlayerTrackMenu } from "@/components/player/bar/PlayerTrackMenu";
import { PlayerVolumeControl } from "@/components/player/bar/PlayerVolumeControl";
import { WaveformCanvas } from "@/components/player/bar/WaveformCanvas";
import {
  formatPlayerTime,
  formatPlayerTrackBadge,
  generateWaveformBars,
} from "@/components/player/bar/player-bar-utils";

export function PlayerBar() {
  const { currentTime, duration, isPlaying, isBuffering, volume } = usePlayer();
  const {
    currentTrack, shuffle, repeat, playSource, queue, currentIndex,
    pause, resume, next, prev, seek, setVolume,
    toggleShuffle, cycleRepeat, audioElement,
  } = usePlayerActions();

  // Connect audio to Web Audio API — this creates the AudioContext + source node
  // on first play, enabling the WebGL visualizer in ExtendedPlayer to work.
  const { frequencies } = useAudioVisualizer(audioElement, isPlaying);

  const [extendedOpen, setExtendedOpen] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [hasFloatingOverlayOpen, setHasFloatingOverlayOpen] = useState(false);
  const { isLiked, likeTrack, unlikeTrack } = useLikedTracks();

  useDismissibleLayer({
    active: hasFloatingOverlayOpen || showQueue || showLyrics,
    refs: [],
    onDismiss: () => {
      setHasFloatingOverlayOpen(false);
      setShowQueue(false);
      setShowLyrics(false);
    },
    closeOnPointerDownOutside: false,
  });

  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);

  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const t = e.changedTouches[0];
    if (!t) return;
    const deltaX = t.clientX - touchStartX.current;
    const deltaY = t.clientY - touchStartY.current;
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 2) {
      if (deltaX < 0) {
        next();
      } else {
        prev();
      }
    }
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const pseudoBars = useMemo(
    () => currentTrack ? generateWaveformBars(currentTrack.id, 80) : [],
    [currentTrack],
  );
  const fmt = currentTrack ? formatPlayerTrackBadge(currentTrack) : null;

  if (!currentTrack) return null;

  const liked = isLiked(currentTrack.libraryTrackId ?? null, currentTrack.path || currentTrack.id);

  async function toggleLike() {
    if (!currentTrack) return;
    const trackId = currentTrack.libraryTrackId ?? null;
    const trackPath = currentTrack.path || currentTrack.id;
    try {
      if (liked) {
        await unlikeTrack(trackId, trackPath);
      } else {
        await likeTrack(trackId, trackPath);
      }
    } catch { /* ignore */ }
  }

  async function handleAddToCollection() {
    if (!currentTrack) return;
    try {
      await likeTrack(currentTrack.libraryTrackId ?? null, currentTrack.path || currentTrack.id);
      toast.success("Added to collection");
    } catch { /* ignore */ }
  }

  return (
    <>
      <div
        className={`fixed bottom-0 left-0 right-0 h-[72px] border-t border-white/5 bg-panel-surface ${hasFloatingOverlayOpen ? "z-app-player-overlay" : "z-app-player"}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="h-full flex items-center px-4 gap-2">

          {/* ── Block 1: Track Info ── */}
          <div className="flex items-center gap-3 w-[280px] shrink-0">
            {/* Album art */}
            <div className="relative w-12 h-12 rounded-md overflow-hidden shrink-0 bg-white/5">
              {currentTrack.albumCover ? (
                <img src={currentTrack.albumCover} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-white/10" />
              )}
            </div>

            {/* Text */}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-white truncate leading-tight">
                {currentTrack.title}
              </p>
              <p className="text-[11px] text-white/50 truncate leading-tight mt-0.5">
                {currentTrack.artist}
              </p>
              {playSource && (
                <p className="text-[10px] text-white/30 truncate leading-tight mt-0.5">
                  Playing from: {playSource.name}
                </p>
              )}
              {isBuffering && (
                <p className="text-[10px] text-primary/80 truncate leading-tight mt-0.5">
                  Buffering...
                </p>
              )}
            </div>

            {/* Heart */}
            <button onClick={toggleLike} className="shrink-0 p-1.5 hover:bg-white/5 rounded-md transition-colors">
              <Heart size={16} className={liked ? "text-primary fill-primary" : "text-white/30 hover:text-white/60"} />
            </button>

            <PlayerTrackMenu
              currentTrack={currentTrack}
              duration={duration}
              onOverlayChange={setHasFloatingOverlayOpen}
              onAddToCollection={handleAddToCollection}
            />
          </div>

          {/* ── Block 2: Controls + Progress ── */}
          <div className="flex-1 flex flex-col items-center justify-center max-w-[600px] mx-auto gap-1">
            {/* Controls */}
            <div className="flex items-center gap-5">
              <button
                onClick={toggleShuffle}
                className={`transition-colors ${shuffle ? "text-primary" : "text-white/30 hover:text-white/60"}`}
              >
                <Shuffle size={15} />
              </button>
              <button onClick={prev} className="text-white/50 hover:text-white transition-colors">
                <SkipBack size={18} fill="currentColor" />
              </button>
              <button
                onClick={isPlaying ? pause : resume}
                className="w-9 h-9 rounded-full bg-white flex items-center justify-center hover:scale-105 transition-transform"
              >
                {isBuffering ? (
                  <Loader2 size={15} className="animate-spin text-black" />
                ) : isPlaying ? (
                  <Pause size={16} className="text-black" />
                ) : (
                  <Play size={16} className="text-black ml-0.5" fill="black" />
                )}
              </button>
              <button onClick={next} className="text-white/50 hover:text-white transition-colors">
                <SkipForward size={18} fill="currentColor" />
              </button>
              <button
                onClick={cycleRepeat}
                className={`transition-colors ${repeat !== "off" ? "text-primary" : "text-white/30 hover:text-white/60"}`}
              >
                {repeat === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />}
              </button>
            </div>

            {/* Progress with waveform bars */}
            <div className="flex items-center gap-2 w-full">
              <span className="text-[10px] text-white/40 w-9 text-right tabular-nums font-mono">
                {formatPlayerTime(currentTime)}
              </span>
              <div
                className="flex-1 h-5 relative cursor-pointer group flex items-end"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  seek(pct * duration);
                }}
              >
                <WaveformCanvas bars={pseudoBars} progress={progress} frequencies={frequencies} isPlaying={isPlaying} />
              </div>
              <span className="text-[10px] text-white/40 w-9 tabular-nums font-mono">
                {formatPlayerTime(duration)}
              </span>
            </div>
          </div>

          {/* ── Block 3: Action Buttons ── */}
          <div className="flex items-center gap-1 w-[280px] shrink-0 justify-end">
            {/* Format badge */}
            {fmt && (
              <span className="text-[9px] font-bold tracking-wider text-primary/70 border border-primary/30 rounded px-1.5 py-0.5 mr-1">
                {fmt}
              </span>
            )}

            {/* Volume */}
            <PlayerVolumeControl
              volume={volume}
              onVolumeChange={setVolume}
              onOverlayChange={setHasFloatingOverlayOpen}
            />

            {/* Device (placeholder) */}
            <button className="p-1.5 hover:bg-white/5 rounded-md transition-colors text-white/30 hover:text-white/60" title="Connect device">
              <Airplay size={16} />
            </button>

            {/* Queue (hidden when extended player is open) */}
            {!extendedOpen && (
              <button
                onClick={() => { setShowQueue(!showQueue); setShowLyrics(false); }}
                className={`p-1.5 hover:bg-white/5 rounded-md transition-colors relative ${showQueue ? "text-primary" : "text-white/30 hover:text-white/60"}`}
                title="Queue"
              >
                <ListMusic size={16} />
                {queue.length > 1 && (
                  <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-primary text-[8px] font-bold text-primary-foreground rounded-full flex items-center justify-center">
                    {queue.length - currentIndex - 1}
                  </span>
                )}
              </button>
            )}

            {/* Lyrics (hidden when extended player is open) */}
            {!extendedOpen && (
              <button
                onClick={() => { setShowLyrics(!showLyrics); setShowQueue(false); }}
                className={`p-1.5 hover:bg-white/5 rounded-md transition-colors ${showLyrics ? "text-primary" : "text-white/30 hover:text-white/60"}`}
                title="Lyrics"
              >
                <Mic2 size={16} />
              </button>
            )}

            {/* Extended / Full player */}
            <button
              onClick={() => {
                setExtendedOpen(!extendedOpen);
                if (!extendedOpen) { setShowQueue(false); setShowLyrics(false); }
              }}
              className={`p-1.5 hover:bg-white/5 rounded-md transition-colors ${extendedOpen ? "text-primary" : "text-white/30 hover:text-white/60"}`}
              title="Extended player"
            >
              <Maximize2 size={16} />
            </button>
          </div>

        </div>
      </div>
      <QueuePanel open={showQueue} onClose={() => setShowQueue(false)} />
      <LyricsPanel open={showLyrics} onClose={() => setShowLyrics(false)} />
      <ExtendedPlayer open={extendedOpen} onClose={() => setExtendedOpen(false)} />
    </>
  );
}
