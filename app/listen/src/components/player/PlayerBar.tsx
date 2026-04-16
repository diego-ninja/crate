import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, Airplay, ListMusic, Mic2, Maximize2, Loader2,
} from "lucide-react";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";
import { useIsDesktop } from "@/hooks/use-breakpoint";
import { useDismissibleLayer } from "@/hooks/use-dismissible-layer";
import { toast } from "sonner";
import { QueuePanel } from "@/components/player/QueuePanel";
import { LyricsPanel } from "@/components/player/LyricsPanel";
import { ExtendedPlayer } from "@/components/player/ExtendedPlayer";
import { FullscreenPlayer } from "@/components/player/FullscreenPlayer";
import { PlayerTrackMenu } from "@/components/player/bar/PlayerTrackMenu";
import { PlayerVolumeControl } from "@/components/player/bar/PlayerVolumeControl";
import { WaveformCanvas } from "@/components/player/bar/WaveformCanvas";
import {
  formatPlayerTime,
  getTrackQualityBadge,
  generateWaveformBars,
} from "@/components/player/bar/player-bar-utils";
import { QualityBadge } from "@/components/player/bar/QualityBadge";

const FS_OPEN_KEY = "listen-fs-player-open";

function getStoredFsOpen(): boolean {
  try { return localStorage.getItem(FS_OPEN_KEY) === "true"; } catch { return false; }
}

export function PlayerBar() {
  const { currentTime, duration, isPlaying, isBuffering, volume, analyserVersion } = usePlayer();
  const {
    currentTrack, shuffle, repeat, playSource, queue, currentIndex,
    pause, resume, next, prev, seek, setVolume,
    toggleShuffle, cycleRepeat,
  } = usePlayerActions();

  const { frequencies } = useAudioVisualizer(isPlaying, `${currentTrack?.id ?? "none"}:${analyserVersion}`);

  const isDesktop = useIsDesktop();
  const [extendedOpen, setExtendedOpen] = useState(false);
  const [fsOpen, setFsOpenRaw] = useState(getStoredFsOpen);
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [hasFloatingOverlayOpen, setHasFloatingOverlayOpen] = useState(false);
  const { isLiked, likeTrack, unlikeTrack } = useLikedTracks();

  const setFsOpen = useCallback((open: boolean) => {
    setFsOpenRaw(open);
    try { localStorage.setItem(FS_OPEN_KEY, String(open)); } catch { /* ignore */ }
  }, []);

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
  // Fetch quality metadata for the current track (format, bitrate, sample_rate, bit_depth).
  // The Track object may not carry these fields depending on the source (playlist, radio, etc.)
  // so we lazily fetch from the API when the track changes.
  const [trackQuality, setTrackQuality] = useState<{
    format?: string; bitrate?: number | null; sampleRate?: number | null; bitDepth?: number | null;
  } | null>(null);

  useEffect(() => {
    setTrackQuality(null);
    if (!currentTrack) return;

    // If the track already has quality data, use it
    if (currentTrack.format || currentTrack.sampleRate) {
      setTrackQuality({
        format: currentTrack.format,
        bitrate: currentTrack.bitrate,
        sampleRate: currentTrack.sampleRate,
        bitDepth: currentTrack.bitDepth,
      });
      return;
    }

    // Otherwise fetch from API
    const trackId = currentTrack.libraryTrackId;
    const storageId = currentTrack.storageId;
    if (!trackId && !storageId) return;

    let cancelled = false;
    const url = trackId
      ? `/api/tracks/${trackId}/info`
      : `/api/tracks/by-storage/${encodeURIComponent(storageId!)}/info`;

    api<Record<string, unknown>>(url)
      .then((info) => {
        if (cancelled) return;
        setTrackQuality({
          format: (info.format as string) || undefined,
          bitrate: (info.bitrate as number) || undefined,
          sampleRate: (info.sample_rate as number) || undefined,
          bitDepth: (info.bit_depth as number) || undefined,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentTrack?.libraryTrackId, currentTrack?.storageId]);

  const qualityTrack = {
    ...currentTrack ?? { id: "", title: "", artist: "" },
    ...trackQuality,
  };
  const qualityBadge = getTrackQualityBadge(qualityTrack);


  if (!currentTrack) return null;

  const liked = isLiked(currentTrack.libraryTrackId ?? null, currentTrack.storageId ?? null, currentTrack.path || currentTrack.id);

  async function toggleLike() {
    if (!currentTrack) return;
    const trackId = currentTrack.libraryTrackId ?? null;
    const trackStorageId = currentTrack.storageId ?? null;
    const trackPath = currentTrack.path || currentTrack.id;
    try {
      if (liked) {
        await unlikeTrack(trackId, trackStorageId, trackPath);
      } else {
        await likeTrack(trackId, trackStorageId, trackPath);
      }
    } catch { /* ignore */ }
  }

  async function handleAddToCollection() {
    if (!currentTrack) return;
    try {
      await likeTrack(currentTrack.libraryTrackId ?? null, currentTrack.storageId ?? null, currentTrack.path || currentTrack.id);
      toast.success("Added to collection");
    } catch { /* ignore */ }
  }

  return (
    <>
      {/* Screen reader announcement for track changes */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {isPlaying ? `Now playing ${currentTrack.title} by ${currentTrack.artist}` : `Paused: ${currentTrack.title} by ${currentTrack.artist}`}
      </div>

      <div
        className={`fixed left-2 right-2 md:left-3 md:right-3 isolate h-[66px] md:h-[82px] overflow-hidden rounded-2xl border border-white/10 bg-black/50 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-all duration-200 ${hasFloatingOverlayOpen ? "z-app-player-overlay" : "z-app-player"}`}
        style={{ bottom: isDesktop ? 12 : "calc(64px + env(safe-area-inset-bottom, 0px) + 8px)", contain: "paint" }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex h-full items-center gap-2 px-3 lg:px-4">

            {/* ── Block 1: Track Info ── */}
            <div
              role={isDesktop ? undefined : "button"}
              tabIndex={isDesktop ? undefined : 0}
              aria-label={isDesktop ? undefined : "Open fullscreen player"}
              className="flex min-w-0 shrink-0 flex-1 cursor-pointer items-center gap-3 md:w-[240px] md:flex-none md:cursor-default xl:w-[280px]"
              onClick={() => { if (!isDesktop) setFsOpen(true); }}
              onKeyDown={(e) => { if (!isDesktop && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setFsOpen(true); } }}
            >
            {/* Album art */}
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-white/5 md:h-12 md:w-12">
              {currentTrack.albumCover ? (
                <img src={currentTrack.albumCover} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-white/10" />
              )}
              </div>

            {/* Text — animate on track change */}
              <div key={currentTrack.id} className="min-w-0 flex-1 animate-track-in">
              <p className="text-[13px] font-semibold text-white truncate leading-tight">
                {currentTrack.title}
              </p>
              <p className="text-[11px] text-white/50 truncate leading-tight mt-0.5">
                {currentTrack.artist}
              </p>
              {playSource && (
                <p className="text-[10px] text-white/30 truncate leading-tight mt-0.5 hidden lg:block">
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
              <button onClick={(e) => { e.stopPropagation(); toggleLike(); }} className="shrink-0 rounded-md p-1.5 transition-colors hover:bg-white/5">
              <Heart size={16} className={liked ? "text-primary fill-primary" : "text-white/30 hover:text-white/60"} />
              </button>

            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <PlayerTrackMenu
                currentTrack={currentTrack}
                duration={duration}
                onOverlayChange={setHasFloatingOverlayOpen}
                onAddToCollection={handleAddToCollection}
              />
            </div>

          {/* ── Block 2: Controls + Progress ── */}
          <div className="mx-auto hidden max-w-[600px] flex-1 flex-col items-center justify-center gap-1 md:flex">
            {/* Controls */}
            <div className="flex items-center gap-3 lg:gap-5">
              <button
                onClick={toggleShuffle}
                aria-label={shuffle ? "Disable shuffle" : "Enable shuffle"}
                className={`transition-colors ${shuffle ? "text-primary" : "text-white/30 hover:text-white/60"}`}
              >
                <Shuffle size={15} />
              </button>
              <button onClick={prev} aria-label="Previous track" className="text-white/50 hover:text-white transition-colors">
                <SkipBack size={18} fill="currentColor" />
              </button>
              <button
                onClick={isPlaying ? pause : resume}
                aria-label={isPlaying ? "Pause" : "Play"}
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
              <button onClick={next} aria-label="Next track" className="text-white/50 hover:text-white transition-colors">
                <SkipForward size={18} fill="currentColor" />
              </button>
              <button
                onClick={cycleRepeat}
                aria-label={`Repeat: ${repeat}`}
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

          {/* ── Mobile/tablet play controls (md only, no progress) ── */}
          <div className="flex items-center gap-1 md:hidden">
            <button onClick={prev} aria-label="Previous track" className="w-10 h-10 flex items-center justify-center text-white/50">
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button
              onClick={isPlaying ? pause : resume}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="w-10 h-10 rounded-full bg-white flex items-center justify-center"
            >
              {isBuffering ? (
                <Loader2 size={15} className="animate-spin text-black" />
              ) : isPlaying ? (
                <Pause size={16} className="text-black" />
              ) : (
                <Play size={16} className="text-black ml-0.5" fill="black" />
              )}
            </button>
            <button onClick={next} aria-label="Next track" className="w-10 h-10 flex items-center justify-center text-white/50">
              <SkipForward size={18} fill="currentColor" />
            </button>
          </div>

          {/* ── Block 3: Action Buttons (lg+) ── */}
          <div className="hidden w-[200px] shrink-0 items-center justify-end gap-1 lg:flex xl:w-[280px]">
            {/* Quality badge */}
            {qualityBadge && (
              <span className="mr-1">
                <QualityBadge badge={qualityBadge} />
              </span>
            )}

            {/* Volume */}
            <PlayerVolumeControl
              volume={volume}
              onVolumeChange={setVolume}
              onOverlayChange={setHasFloatingOverlayOpen}
            />

            {/* Device (placeholder) */}
            <button className="p-1.5 hover:bg-white/5 rounded-md transition-colors text-white/30 hover:text-white/60 hidden xl:block" aria-label="Connect device">
              <Airplay size={16} />
            </button>

            {/* Queue (hidden when extended player is open) */}
            {!extendedOpen && (
              <button
                onClick={() => { setShowQueue(!showQueue); setShowLyrics(false); }}
                className={`p-1.5 hover:bg-white/5 rounded-md transition-colors relative ${showQueue ? "text-primary" : "text-white/30 hover:text-white/60"}`}
                aria-label="Queue"
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
                className={`p-1.5 hover:bg-white/5 rounded-md transition-colors hidden xl:block ${showLyrics ? "text-primary" : "text-white/30 hover:text-white/60"}`}
                aria-label="Lyrics"
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
              aria-label="Expand player"
            >
              <Maximize2 size={16} />
            </button>
          </div>

          {/* ── Compact action buttons (md only, no lg) ── */}
          <div className="hidden items-center gap-1 md:flex lg:hidden">
            {!extendedOpen && (
              <button
                onClick={() => { setShowQueue(!showQueue); setShowLyrics(false); }}
                aria-label="Queue"
                className={`p-1.5 hover:bg-white/5 rounded-md transition-colors relative ${showQueue ? "text-primary" : "text-white/30 hover:text-white/60"}`}
              >
                <ListMusic size={16} />
              </button>
            )}
            <button
              onClick={() => {
                setExtendedOpen(!extendedOpen);
                if (!extendedOpen) { setShowQueue(false); setShowLyrics(false); }
              }}
              aria-label="Expand player"
              className={`p-1.5 hover:bg-white/5 rounded-md transition-colors ${extendedOpen ? "text-primary" : "text-white/30 hover:text-white/60"}`}
            >
              <Maximize2 size={16} />
            </button>
          </div>

        </div>
      </div>
      <QueuePanel open={showQueue} onClose={() => setShowQueue(false)} />
      <LyricsPanel open={showLyrics} onClose={() => setShowLyrics(false)} />
      <ExtendedPlayer open={extendedOpen} onClose={() => setExtendedOpen(false)} />
      {!isDesktop && <FullscreenPlayer open={fsOpen} onClose={() => setFsOpen(false)} />}
    </>
  );
}
