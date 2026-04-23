import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, Airplay, ListMusic, Mic2, Maximize2, Loader2, SlidersHorizontal,
} from "lucide-react";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import type { PlaySource } from "@/contexts/player-types";
import { artistPagePath, albumPagePath } from "@/lib/library-routes";
import { api } from "@/lib/api";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";
import { useCrossfadeAwareProgress, useCrossfadeProgress } from "@/hooks/use-crossfade-progress";
import { cn } from "@crate/ui/lib/cn";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { toast } from "sonner";
import { RadioFeedback } from "@/components/player/RadioFeedback";
import { QueuePanel } from "@/components/player/QueuePanel";
import { LyricsPanel } from "@/components/player/LyricsPanel";
import { EqualizerPopover } from "@/components/player/EqualizerPopover";
import { ExtendedPlayer } from "@/components/player/ExtendedPlayer";
import { FullscreenPlayer } from "@/components/player/FullscreenPlayer";
import { PlayerTrackMenu } from "@/components/player/bar/PlayerTrackMenu";
import { PlayerVolumeControl } from "@/components/player/bar/PlayerVolumeControl";
import { WaveformCanvas } from "@/components/player/bar/WaveformCanvas";
import {
  formatPlayerTime,
  getTrackQualityBadge,
} from "@/components/player/bar/player-bar-utils";
import { QualityBadge } from "@/components/player/bar/QualityBadge";

const FS_OPEN_KEY = "listen-fs-player-open";
const SHOW_PLAYER_BAR_ANALYZER = true;

function getStoredFsOpen(): boolean {
  try { return localStorage.getItem(FS_OPEN_KEY) === "true"; } catch { return false; }
}

type TransportTone = "default" | "album" | "playlist" | "radio" | "discovery";

function getTransportTone(playSource: PlaySource | null): TransportTone {
  if (playSource?.radio?.seedType === "discovery") return "discovery";
  if (playSource?.type === "album") return "album";
  if (playSource?.type === "playlist") return "playlist";
  if (playSource?.type === "radio" || playSource?.radio) return "radio";
  return "default";
}

function getTransportButtonToneClass(playSource: PlaySource | null, active: boolean): string {
  const tone = getTransportTone(playSource);

  switch (tone) {
    case "album":
      return cn(
        "border-primary/20 bg-[linear-gradient(180deg,#fbfeff,#dffbff)]",
        "shadow-[0_0_0_1px_rgba(103,232,249,0.12),0_8px_22px_rgba(8,145,178,0.2)]",
        active && "shadow-[0_0_0_1px_rgba(103,232,249,0.16),0_10px_28px_rgba(8,145,178,0.28)]",
      );
    case "playlist":
      return cn(
        "border-primary/16 bg-[linear-gradient(180deg,#ffffff,#ecfbff)]",
        "shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_20px_rgba(14,116,144,0.16)]",
        active && "shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_10px_26px_rgba(14,116,144,0.22)]",
      );
    case "radio":
      return cn(
        "border-primary/24 bg-[linear-gradient(180deg,#f3fdff,#d4f8ff)]",
        "shadow-[0_0_18px_rgba(34,211,238,0.2),0_10px_24px_rgba(8,145,178,0.18)]",
        active && "shadow-[0_0_22px_rgba(34,211,238,0.28),0_12px_28px_rgba(8,145,178,0.24)]",
      );
    case "discovery":
      return cn(
        "border-primary/30 bg-[linear-gradient(180deg,#f8feff,#d6fbff)]",
        "shadow-[0_0_22px_rgba(34,211,238,0.26),0_10px_26px_rgba(8,145,178,0.2)]",
        active && "animate-pulse-subtle shadow-[0_0_28px_rgba(34,211,238,0.34),0_14px_32px_rgba(8,145,178,0.28)]",
      );
    default:
      return cn(
        "border-white/75 bg-white",
        "shadow-[0_8px_20px_rgba(255,255,255,0.1)]",
        active && "shadow-[0_10px_24px_rgba(255,255,255,0.14)]",
      );
  }
}

export function PlayerBar() {
  const navigate = useNavigate();
  const { currentTime, duration, isPlaying, isBuffering, volume, analyserVersion, crossfadeTransition } = usePlayer();
  const {
    currentTrack, shuffle, repeat, playSource, queue, currentIndex,
    pause, resume, next, prev, seek, setVolume,
    toggleShuffle, cycleRepeat,
  } = usePlayerActions();

  const crossfadeProgress = useCrossfadeProgress(crossfadeTransition);
  // Crossfade still animates visual elements like artwork/title, but
  // the seek bar and timestamps should always reflect the active
  // incoming track's live playback state.
  const { displayedTime, displayedDuration } = useCrossfadeAwareProgress(
    crossfadeTransition,
    currentTime,
    duration,
  );

  // Smoothly fade the "Playing from: <source>" line when the source
  // actually changes (album → playlist, etc.). Without this it would
  // pop in/out on user-initiated source changes — a small but visible
  // jitter at the edge of the player bar.
  const [displayedSource, setDisplayedSource] = useState(playSource);
  const [previousSource, setPreviousSource] = useState<typeof playSource>(null);
  useEffect(() => {
    const currentName = displayedSource?.name ?? null;
    const nextName = playSource?.name ?? null;
    if (currentName === nextName) return;
    setPreviousSource(displayedSource);
    setDisplayedSource(playSource);
    const id = window.setTimeout(() => setPreviousSource(null), 320);
    return () => window.clearTimeout(id);
  }, [playSource, displayedSource]);

  const { frequenciesDb, sampleRate } = useAudioVisualizer(
    SHOW_PLAYER_BAR_ANALYZER && isPlaying,
    `${currentTrack?.id ?? "none"}:${analyserVersion}`,
  );

  const [seekHover, setSeekHover] = useState<{ pct: number; time: string } | null>(null);

  const isDesktop = useIsDesktop();
  const [extendedOpen, setExtendedOpen] = useState(false);
  const [fsOpen, setFsOpenRaw] = useState(getStoredFsOpen);
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showEqualizer, setShowEqualizer] = useState(false);
  const [hasFloatingOverlayOpen, setHasFloatingOverlayOpen] = useState(false);
  const { isLiked, likeTrack, unlikeTrack } = useLikedTracks();

  const setFsOpen = useCallback((open: boolean) => {
    setFsOpenRaw(open);
    try { localStorage.setItem(FS_OPEN_KEY, String(open)); } catch { /* ignore */ }
  }, []);

  useDismissibleLayer({
    active: hasFloatingOverlayOpen || showQueue || showLyrics || showEqualizer,
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
  const transportButtonClass = getTransportButtonToneClass(playSource, isPlaying || isBuffering);
  const shapedRadioSessionId = playSource?.radio?.shapedSessionId;
  const isShapedRadioTrack = !!(shapedRadioSessionId && currentTrack?.libraryTrackId);


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
            {/* Album art — crossfades outgoing ↔ incoming during audio crossfade.
                On desktop, clicking navigates to the album page. */}
              <div
                className={`relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-white/5 md:h-12 md:w-12 ${isDesktop && currentTrack.albumId ? "cursor-pointer" : ""}`}
                onClick={(e) => {
                  if (isDesktop && currentTrack.albumId) {
                    e.stopPropagation();
                    navigate(albumPagePath({ albumId: currentTrack.albumId, albumSlug: currentTrack.albumSlug, albumName: currentTrack.album, artistName: currentTrack.artist }));
                  }
                }}
              >
                {crossfadeTransition ? (
                  <>
                    {crossfadeTransition.outgoing.albumCover ? (
                      <img
                        src={crossfadeTransition.outgoing.albumCover}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{ opacity: 1 - crossfadeProgress }}
                      />
                    ) : null}
                    {crossfadeTransition.incoming.albumCover ? (
                      <img
                        src={crossfadeTransition.incoming.albumCover}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{ opacity: crossfadeProgress }}
                      />
                    ) : null}
                  </>
                ) : currentTrack.albumCover ? (
                  <img src={currentTrack.albumCover} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-white/10" />
                )}
              </div>

            {/* Text — crossfades outgoing ↔ incoming. Stacks absolutely to allow
                overlap without layout jump. */}
              <div className="min-w-0 flex-1">
              {/* Title + artist crossfade between outgoing and incoming.
                  Wrapped in its own relative block so the absolute
                  outgoing copy doesn't escape into the persistent rows
                  below ("Playing from", "Buffering"). */}
              <div className="relative">
                {crossfadeTransition ? (
                  <>
                    <div className="absolute inset-0" style={{ opacity: 1 - crossfadeProgress }}>
                      <p className="text-[13px] font-semibold text-white truncate leading-tight">
                        {crossfadeTransition.outgoing.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                        {crossfadeTransition.outgoing.artist}
                      </p>
                    </div>
                    <div style={{ opacity: crossfadeProgress }}>
                      <p className="text-[13px] font-semibold text-white truncate leading-tight">
                        {crossfadeTransition.incoming.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                        {crossfadeTransition.incoming.artist}
                      </p>
                    </div>
                  </>
                ) : (
                  <div key={currentTrack.id} className="animate-track-in">
                    {isDesktop && currentTrack.albumId ? (
                      <p
                        className="text-[13px] font-semibold text-white truncate leading-tight hover:underline cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); navigate(albumPagePath({ albumId: currentTrack.albumId, albumSlug: currentTrack.albumSlug, albumName: currentTrack.album, artistName: currentTrack.artist })); }}
                      >
                        {currentTrack.title}
                      </p>
                    ) : (
                      <p className="text-[13px] font-semibold text-white truncate leading-tight">
                        {currentTrack.title}
                      </p>
                    )}
                    {isDesktop && currentTrack.artistId ? (
                      <p
                        className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5 hover:text-foreground hover:underline cursor-pointer transition-colors"
                        onClick={(e) => { e.stopPropagation(); navigate(artistPagePath({ artistId: currentTrack.artistId, artistSlug: currentTrack.artistSlug, artistName: currentTrack.artist })); }}
                      >
                        {currentTrack.artist}
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                        {currentTrack.artist}
                      </p>
                    )}
                  </div>
                )}
              </div>
              {/* Persistent metadata that shouldn't blink during a
                  track crossfade — kept outside the fading block.
                  When the source itself changes (album → playlist) the
                  outgoing line fades out while the incoming fades in. */}
              {(displayedSource || previousSource) && (
                <div className="relative mt-0.5 h-[14px] hidden lg:block">
                  {previousSource && (
                    <p
                      key={`prev-${previousSource.name}`}
                      className="absolute inset-0 text-[10px] text-white/40 truncate leading-tight"
                      style={{ animation: "fadeOut 320ms ease-out forwards" }}
                    >
                      Playing from: {previousSource.name}
                    </p>
                  )}
                  {displayedSource && (
                    <p
                      key={`cur-${displayedSource.name}`}
                      className="text-[10px] text-white/40 truncate leading-tight animate-fade-in"
                    >
                      Playing from:{" "}
                      {displayedSource.href ? (
                        <span
                          className="hover:text-foreground hover:underline cursor-pointer transition-colors"
                          onClick={(e) => { e.stopPropagation(); navigate(displayedSource.href!); }}
                        >
                          {displayedSource.name}
                        </span>
                      ) : displayedSource.name}
                    </p>
                  )}
                </div>
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

            {/* Radio shaping — thumbs up/down when shaped radio is active */}
            {isDesktop && isShapedRadioTrack && (
              <RadioFeedback
                sessionId={shapedRadioSessionId!}
                trackId={currentTrack.libraryTrackId}
                onDislike={() => next()}
              />
            )}

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
          <div className="mx-auto hidden max-w-[640px] flex-1 md:flex md:items-center md:justify-center">
            <div className="relative w-full overflow-hidden px-4 py-2">
              {SHOW_PLAYER_BAR_ANALYZER ? (
                <div className="pointer-events-none absolute inset-0 opacity-28">
                  <WaveformCanvas
                    frequenciesDb={frequenciesDb}
                    sampleRate={sampleRate}
                    isPlaying={isPlaying}
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,12,0.14),rgba(2,6,12,0.32)_44%,rgba(2,6,12,0.74))]" />
                  <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(2,6,12,0.9),rgba(2,6,12,0.14)_12%,rgba(2,6,12,0.14)_88%,rgba(2,6,12,0.9))]" />
                </div>
              ) : null}

              <div className="relative flex items-center justify-center gap-3 lg:gap-5">
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
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full border text-black transition-[transform,background-color,box-shadow,border-color] duration-200 hover:scale-105",
                    transportButtonClass,
                  )}
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

              <div className="relative mt-2 flex items-center gap-2 w-full">
                <span className="text-[10px] text-white/40 w-9 text-right tabular-nums font-mono">
                  {formatPlayerTime(displayedTime)}
                </span>
                <div
                  className="group relative flex-1 cursor-pointer py-2"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    seek(pct * duration);
                  }}
                  onPointerMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    setSeekHover({ pct, time: formatPlayerTime(pct * displayedDuration) });
                  }}
                  onPointerLeave={() => setSeekHover(null)}
                >
                  {seekHover && displayedDuration > 0 && (
                    <div
                      className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded bg-black/85 px-1.5 py-0.5 text-[10px] tabular-nums text-white/90 border border-white/10"
                      style={{ left: `${seekHover.pct * 100}%` }}
                    >
                      {seekHover.time}
                    </div>
                  )}
                  <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/10" />
                  <div
                    className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-primary/85 transition-[width] duration-150"
                    style={{ width: `${displayedDuration > 0 ? (displayedTime / displayedDuration) * 100 : 0}%` }}
                  />
                  <div
                    className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-primary/80 bg-cyan-100 opacity-0 shadow-[0_0_0_3px_rgba(34,211,238,0.14)] transition-opacity duration-150 group-hover:opacity-100"
                    style={{ left: `calc(${displayedDuration > 0 ? (displayedTime / displayedDuration) * 100 : 0}% - 5px)` }}
                  />
                </div>
                <span className="text-[10px] text-white/40 w-9 tabular-nums font-mono">
                  {formatPlayerTime(displayedDuration)}
                </span>
              </div>
            </div>
          </div>

          {/* ── Mobile/tablet play controls (md only, no progress) ── */}
          <div className="flex items-center gap-1 md:hidden">
            {isShapedRadioTrack ? (
              <RadioFeedback
                sessionId={shapedRadioSessionId!}
                trackId={currentTrack.libraryTrackId}
                onDislike={() => next()}
                size="sm"
              />
            ) : (
              <button onClick={prev} aria-label="Previous track" className="w-10 h-10 flex items-center justify-center text-white/50">
                <SkipBack size={18} fill="currentColor" />
              </button>
            )}
            <button
              onClick={isPlaying ? pause : resume}
              aria-label={isPlaying ? "Pause" : "Play"}
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full border text-black transition-[transform,background-color,box-shadow,border-color] duration-200",
                transportButtonClass,
              )}
            >
              {isBuffering ? (
                <Loader2 size={15} className="animate-spin text-black" />
              ) : isPlaying ? (
                <Pause size={16} className="text-black" />
              ) : (
                <Play size={16} className="text-black ml-0.5" fill="black" />
              )}
            </button>
            {isShapedRadioTrack ? (
              <button
                onClick={() => setFsOpen(true)}
                aria-label="Open fullscreen player"
                className="w-10 h-10 flex items-center justify-center text-white/35 transition-colors hover:text-white/60"
              >
                <Maximize2 size={16} />
              </button>
            ) : (
              <button onClick={next} aria-label="Next track" className="w-10 h-10 flex items-center justify-center text-white/50">
                <SkipForward size={18} fill="currentColor" />
              </button>
            )}
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

            {/* Equalizer (hidden when extended player is open) */}
            {!extendedOpen && (
              <button
                onClick={() => {
                  setShowEqualizer((v) => !v);
                  setShowQueue(false);
                  setShowLyrics(false);
                }}
                aria-label="Equalizer"
                className={`p-1.5 hover:bg-white/5 rounded-md transition-colors ${showEqualizer ? "text-primary" : "text-white/30 hover:text-white/60"}`}
              >
                <SlidersHorizontal size={16} />
              </button>
            )}

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
      <EqualizerPopover open={showEqualizer} onClose={() => setShowEqualizer(false)} />
      <ExtendedPlayer open={extendedOpen} onClose={() => setExtendedOpen(false)} />
      {!isDesktop && <FullscreenPlayer open={fsOpen} onClose={() => setFsOpen(false)} />}
    </>
  );
}
