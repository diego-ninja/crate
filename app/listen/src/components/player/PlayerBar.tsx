import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, Airplay, ListMusic, Mic2, Maximize2, Loader2, SlidersHorizontal,
} from "lucide-react";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import type { PlaySource } from "@/contexts/player-types";
import { artistPagePath, albumPagePath } from "@/lib/library-routes";
import { getTrackQualityFallback, getTrackQualityFromInfo, mergeTrackQualityParts } from "@/lib/track-info";
import { getTrackQualityFromPlaybackQuality } from "@/lib/track-playback";
import { getPlaybackDeliveryPolicyPreference, PLAYER_PLAYBACK_PREFS_EVENT, type PlaybackDeliveryPolicy } from "@/lib/player-playback-prefs";
import { canUseWebAudioEffects } from "@/lib/mobile-audio-mode";
import { triggerHaptic } from "@/lib/haptics";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";
import { useCrossfadeAwareProgress, useCrossfadeProgress } from "@/hooks/use-crossfade-progress";
import { useTrackPlayback } from "@/hooks/use-track-playback";
import { useTrackInfo } from "@/hooks/use-track-info";
import { cn } from "@crate/ui/lib/cn";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { toast } from "sonner";
import { RadioFeedback } from "@/components/player/RadioFeedback";
import {
  LazyEqualizerPopover,
  LazyExtendedPlayer,
  LazyFullscreenPlayer,
  LazyLyricsPanel,
  LazyQueuePanel,
  preloadEqualizerPopover,
  preloadExtendedPlayer,
  preloadFullscreenPlayer,
  preloadLyricsPanel,
  preloadQueuePanel,
} from "@/components/player/lazy-player-surfaces";
import { PlayerTrackMenu } from "@/components/player/bar/PlayerTrackMenu";
import { PlayerVolumeControl } from "@/components/player/bar/PlayerVolumeControl";
import { WaveformCanvas } from "@/components/player/bar/WaveformCanvas";
import { getPlaySourceLabel } from "@/components/player/player-source";
import {
  formatPlayerTime,
  getQualityBadge,
  shouldFetchTrackQualityInfo,
} from "@/components/player/bar/player-bar-utils";
import { QualityBadge } from "@/components/player/bar/QualityBadge";
import { getHorizontalPlayerSwipeAction } from "@/components/player/player-gestures";

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

function PlayerSurfaceFallback({ fullscreen = false }: { fullscreen?: boolean }) {
  if (!fullscreen) {
    return (
      <div
        className="pointer-events-none fixed inset-x-0 z-app-player-overlay flex justify-end px-4"
        style={{ bottom: "calc(var(--listen-mobile-bottom-chrome-height) + 0.75rem)" }}
      >
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/75 px-3 py-2 text-[11px] text-white/70 shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <Loader2 size={14} className="animate-spin text-primary" />
          Loading player…
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-fullscreen-player flex items-center justify-center bg-black/70 backdrop-blur-xl">
      <Loader2 size={24} className="animate-spin text-primary" />
    </div>
  );
}

export function PlayerBar() {
  const navigate = useNavigate();
  const { currentTime, duration, isPlaying, isBuffering, volume, analyserVersion, crossfadeTransition } = usePlayer();
  const {
    currentTrack, shuffle, repeat, playSource, queue, currentIndex,
    pause, resume, next, prev, seek, setVolume,
    toggleShuffle, cycleRepeat,
  } = usePlayerActions();
  const isDesktop = useIsDesktop();
  const allowEqualizer = canUseWebAudioEffects;
  const showPlayerBarAnalyzer = SHOW_PLAYER_BAR_ANALYZER && isDesktop && allowEqualizer;

  const crossfadeProgress = useCrossfadeProgress(crossfadeTransition);
  // Crossfade still animates visual elements like artwork/title, but
  // the seek bar and timestamps should always reflect the active
  // incoming track's live playback state.
  const { displayedTime, displayedDuration } = useCrossfadeAwareProgress(
    crossfadeTransition,
    currentTime,
    duration,
  );

  const { frequenciesDb, sampleRate } = useAudioVisualizer(
    showPlayerBarAnalyzer && isPlaying,
    `${currentTrack?.id ?? "none"}:${analyserVersion}`,
  );

  const [seekHover, setSeekHover] = useState<{ pct: number; time: string } | null>(null);

  const [extendedOpen, setExtendedOpen] = useState(false);
  const [fsOpen, setFsOpenRaw] = useState(getStoredFsOpen);
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showEqualizer, setShowEqualizer] = useState(false);
  const [playbackDeliveryPolicy, setPlaybackDeliveryPolicy] = useState<PlaybackDeliveryPolicy>(getPlaybackDeliveryPolicyPreference);
  const [shouldRenderQueuePanel, setShouldRenderQueuePanel] = useState(false);
  const [shouldRenderLyricsPanel, setShouldRenderLyricsPanel] = useState(false);
  const [shouldRenderEqualizerPopover, setShouldRenderEqualizerPopover] = useState(false);
  const [shouldRenderExtendedPlayer, setShouldRenderExtendedPlayer] = useState(false);
  const [shouldRenderFullscreenPlayer, setShouldRenderFullscreenPlayer] = useState(false);
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
      setShowEqualizer(false);
    },
    closeOnPointerDownOutside: false,
  });

  useEffect(() => {
    const handleNativeBack = (event: Event) => {
      if (fsOpen) return;
      if (
        !hasFloatingOverlayOpen &&
        !showQueue &&
        !showLyrics &&
        !showEqualizer &&
        !extendedOpen
      ) {
        return;
      }
      event.preventDefault();
      setHasFloatingOverlayOpen(false);
      setShowQueue(false);
      setShowLyrics(false);
      setShowEqualizer(false);
      setExtendedOpen(false);
    };
    window.addEventListener("crate:native-back", handleNativeBack);
    return () => window.removeEventListener("crate:native-back", handleNativeBack);
  }, [extendedOpen, fsOpen, hasFloatingOverlayOpen, showEqualizer, showLyrics, showQueue]);

  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);

  useEffect(() => {
    const onPrefsChanged = (event: Event) => {
      const nextPolicy = (event as CustomEvent<{ playbackDeliveryPolicy?: PlaybackDeliveryPolicy }>).detail?.playbackDeliveryPolicy;
      setPlaybackDeliveryPolicy(nextPolicy ?? getPlaybackDeliveryPolicyPreference());
    };
    window.addEventListener(PLAYER_PLAYBACK_PREFS_EVENT, onPrefsChanged as EventListener);
    return () => {
      window.removeEventListener(PLAYER_PLAYBACK_PREFS_EVENT, onPrefsChanged as EventListener);
    };
  }, []);

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
    const action = getHorizontalPlayerSwipeAction({
      deltaX,
      deltaY,
      viewportWidth: window.innerWidth,
    });
    if (action === "next") {
      triggerHaptic("selection");
      next();
    } else if (action === "previous") {
      triggerHaptic("selection");
      prev();
    }
  }

  const shouldResolveTrackInfo = shouldFetchTrackQualityInfo(currentTrack);
  const { info: currentTrackInfo } = useTrackInfo(currentTrack, { enabled: shouldResolveTrackInfo });
  const { resolution: currentTrackPlayback } = useTrackPlayback(currentTrack, playbackDeliveryPolicy, {
    enabled: !!currentTrack,
  });
  const sourceTrackQuality = currentTrack
    ? mergeTrackQualityParts(
        getTrackQualityFallback(currentTrack),
        getTrackQualityFromInfo(currentTrackInfo),
        getTrackQualityFromPlaybackQuality(currentTrackPlayback?.source),
      )
    : null;
  const activeTrackQuality = currentTrackPlayback && currentTrackPlayback.effective_policy !== "original"
    ? mergeTrackQualityParts(
        sourceTrackQuality,
        getTrackQualityFromPlaybackQuality(currentTrackPlayback.delivery, { preferCodec: true }),
      )
    : sourceTrackQuality;
  const qualityBadge = currentTrack
    ? getQualityBadge({
        id: currentTrack.id,
        path: currentTrack.path,
        ...(activeTrackQuality ?? {}),
      })
    : null;
  const progressPct = displayedDuration > 0
    ? Math.max(0, Math.min(100, (displayedTime / displayedDuration) * 100))
    : 0;
  const showsDeliveryQuality = Boolean(currentTrackPlayback && currentTrackPlayback.effective_policy !== "original");
  const transportButtonClass = getTransportButtonToneClass(playSource, isPlaying || isBuffering);
  const shapedRadioSessionId = playSource?.radio?.shapedSessionId;
  const isShapedRadioTrack = !!(shapedRadioSessionId && currentTrack?.libraryTrackId);
  const sourceLabel = getPlaySourceLabel(playSource);
  const hidePlayerBarForMobileFullscreen = !isDesktop && fsOpen;

  useEffect(() => {
    if (!isDesktop && fsOpen) {
      setShouldRenderFullscreenPlayer(true);
      void preloadFullscreenPlayer();
    }
  }, [fsOpen, isDesktop]);

  if (!currentTrack) return null;

  const liked = isLiked(
    currentTrack.libraryTrackId ?? null,
    currentTrack.entityUid ?? null,
    currentTrack.path || currentTrack.id,
  );

  function prepareQueuePanel() {
    setShouldRenderQueuePanel(true);
    void preloadQueuePanel();
  }

  function prepareLyricsPanel() {
    setShouldRenderLyricsPanel(true);
    void preloadLyricsPanel();
  }

  function prepareEqualizerPopover() {
    setShouldRenderEqualizerPopover(true);
    void preloadEqualizerPopover();
  }

  function prepareExtendedPlayer() {
    setShouldRenderExtendedPlayer(true);
    void preloadExtendedPlayer();
  }

  function prepareFullscreenPlayer() {
    setShouldRenderFullscreenPlayer(true);
    void preloadFullscreenPlayer();
  }

  function openFullscreenPlayer() {
    triggerHaptic("medium");
    prepareFullscreenPlayer();
    setFsOpen(true);
  }

  function handlePlayPause() {
    triggerHaptic("light");
    if (isPlaying) pause();
    else resume();
  }

  function handlePreviousTrack() {
    triggerHaptic("selection");
    prev();
  }

  function handleNextTrack() {
    triggerHaptic("selection");
    next();
  }

  function handleToggleShuffle() {
    triggerHaptic("selection");
    toggleShuffle();
  }

  function handleCycleRepeat() {
    triggerHaptic("selection");
    cycleRepeat();
  }

  function handleToggleQueue() {
    triggerHaptic("selection");
    prepareQueuePanel();
    setShowQueue(!showQueue);
    setShowLyrics(false);
  }

  function handleToggleLyrics() {
    triggerHaptic("selection");
    prepareLyricsPanel();
    setShowLyrics(!showLyrics);
    setShowQueue(false);
  }

  function handleToggleExtendedPlayer() {
    triggerHaptic("medium");
    prepareExtendedPlayer();
    setExtendedOpen(!extendedOpen);
    if (!extendedOpen) {
      setShowQueue(false);
      setShowLyrics(false);
    }
  }

  async function toggleLike() {
    if (!currentTrack) return;
    const trackId = currentTrack.libraryTrackId ?? null;
    const trackEntityUid = currentTrack.entityUid ?? null;
    const trackPath = currentTrack.path || currentTrack.id;
    try {
      if (liked) {
        await unlikeTrack(trackId, trackEntityUid, trackPath);
      } else {
        await likeTrack(trackId, trackEntityUid, trackPath);
      }
    } catch { /* ignore */ }
  }

  async function handleAddToCollection() {
    if (!currentTrack) return;
    try {
      await likeTrack(
        currentTrack.libraryTrackId ?? null,
        currentTrack.entityUid ?? null,
        currentTrack.path || currentTrack.id,
      );
      toast.success("Added to collection");
    } catch { /* ignore */ }
  }

  return (
    <>
      {/* Screen reader announcement for track changes */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {isPlaying ? `Now playing ${currentTrack.title} by ${currentTrack.artist}` : `Paused: ${currentTrack.title} by ${currentTrack.artist}`}
      </div>

      {!hidePlayerBarForMobileFullscreen ? (
        <div
          className={`fixed left-2 right-2 md:left-3 md:right-3 isolate h-[var(--listen-mobile-player-height)] overflow-hidden rounded-2xl border border-white/8 bg-app-surface/68 backdrop-blur-xl shadow-[0_24px_56px_rgba(0,0,0,0.34)] transition-all duration-200 md:h-[82px] ${hasFloatingOverlayOpen ? "z-app-player-overlay" : "z-app-player"}`}
          style={{
            bottom: isDesktop ? 12 : "calc(var(--listen-mobile-bottom-nav-height) + var(--listen-mobile-player-gap))",
            left: isDesktop ? undefined : "max(0.5rem, var(--listen-safe-left))",
            right: isDesktop ? undefined : "max(0.5rem, var(--listen-safe-right))",
            contain: "paint",
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
        <div className="flex h-full items-center gap-2 px-3 lg:px-4">

            {/* ── Block 1: Track Info ── */}
            <div
              role={isDesktop ? undefined : "button"}
              tabIndex={isDesktop ? undefined : 0}
              aria-label={isDesktop ? undefined : "Open fullscreen player"}
              className="flex min-w-0 shrink-0 flex-1 touch-manipulation cursor-pointer items-center gap-3 rounded-xl md:w-[260px] md:flex-none md:cursor-default lg:w-[340px] xl:w-[min(34vw,520px)] 2xl:w-[min(38vw,680px)]"
              onTouchStart={() => { if (!isDesktop) prepareFullscreenPlayer(); }}
              onClick={() => { if (!isDesktop) openFullscreenPlayer(); }}
              onKeyDown={(e) => { if (!isDesktop && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openFullscreenPlayer(); } }}
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
              <div className="min-w-0 flex-1 md:flex-none md:max-w-[220px] lg:max-w-[300px] xl:max-w-[min(24vw,420px)] 2xl:max-w-[min(28vw,520px)]">
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
              {sourceLabel && (
                <div className="relative mt-0.5 h-[14px] hidden lg:block">
                  <p
                    key={`src-${sourceLabel}`}
                    className="text-[10px] text-white/40 truncate leading-tight animate-fade-in"
                  >
                    Playing from:{" "}
                    {playSource?.href && sourceLabel !== "Discovery Radio" ? (
                      <span
                        className="hover:text-foreground hover:underline cursor-pointer transition-colors"
                        onClick={(e) => { e.stopPropagation(); navigate(playSource.href!); }}
                      >
                        {sourceLabel}
                      </span>
                    ) : sourceLabel}
                  </p>
                </div>
              )}
              {isBuffering && (
                <p className="text-[10px] text-primary/80 truncate leading-tight mt-0.5">
                  Buffering...
                </p>
              )}
              </div>

            <div className="ml-1 flex shrink-0 items-center gap-0.5">
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

              <div onClick={(e) => e.stopPropagation()}>
                <PlayerTrackMenu
                  currentTrack={currentTrack}
                  duration={duration}
                  onOverlayChange={setHasFloatingOverlayOpen}
                  onAddToCollection={handleAddToCollection}
                />
              </div>
            </div>
            </div>

          {/* ── Block 2: Controls + Progress ── */}
          <div className="mx-auto hidden max-w-[640px] flex-1 md:flex md:items-center md:justify-center">
            <div className="relative w-full overflow-visible px-4 py-2">
              {showPlayerBarAnalyzer ? (
                <div className="pointer-events-none absolute -inset-y-2 -inset-x-10 opacity-26 [mask-image:radial-gradient(ellipse_at_center,rgba(0,0,0,0.96)_18%,rgba(0,0,0,0.9)_44%,rgba(0,0,0,0.34)_74%,transparent_100%)] [mask-repeat:no-repeat]">
                  <WaveformCanvas
                    frequenciesDb={frequenciesDb}
                    sampleRate={sampleRate}
                    isPlaying={isPlaying}
                  />
                </div>
              ) : null}

              <div className="relative flex items-center justify-center gap-3 lg:gap-5">
                <button
                  onClick={handleToggleShuffle}
                  aria-label={shuffle ? "Disable shuffle" : "Enable shuffle"}
                  className={`transition-colors ${shuffle ? "text-primary" : "text-white/30 hover:text-white/60"}`}
                >
                  <Shuffle size={15} />
                </button>
                <button onClick={handlePreviousTrack} aria-label="Previous track" className="text-white/50 hover:text-white transition-colors">
                  <SkipBack size={18} fill="currentColor" />
                </button>
                <button
                  onClick={handlePlayPause}
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
                <button onClick={handleNextTrack} aria-label="Next track" className="text-white/50 hover:text-white transition-colors">
                  <SkipForward size={18} fill="currentColor" />
                </button>
                <button
                  onClick={handleCycleRepeat}
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
                    className="pointer-events-none absolute left-0 top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-full opacity-65 transition-[width] duration-150"
                    style={{ width: `${progressPct}%` }}
                  >
                    <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,182,212,0)_0%,rgba(6,182,212,0.08)_44%,rgba(34,211,238,0.28)_82%,rgba(165,243,252,0.55)_100%)] blur-[3px]" />
                    <div className="absolute inset-y-[5px] inset-x-0 rounded-full bg-[linear-gradient(90deg,rgba(6,182,212,0)_0%,rgba(6,182,212,0.18)_46%,rgba(34,211,238,0.58)_88%,rgba(207,250,254,0.78)_100%)]" />
                  </div>
                  <div
                    className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[linear-gradient(90deg,rgba(6,182,212,0.14),rgba(34,211,238,0.56),rgba(207,250,254,0.78))] transition-[width] duration-150"
                    style={{ width: `${progressPct}%` }}
                  />
                  <div
                    className="pointer-events-none absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-cyan-100 shadow-[0_0_6px_rgba(165,243,252,0.62),0_0_12px_rgba(34,211,238,0.34)] transition-[left,opacity] duration-150"
                    style={{
                      left: `calc(${progressPct}% - 4px)`,
                      opacity: progressPct > 0 ? 0.62 : 0,
                    }}
                  />
                  <div
                    className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-primary/80 bg-cyan-100 opacity-0 shadow-[0_0_0_3px_rgba(34,211,238,0.14)] transition-[left,opacity] duration-150 group-hover:opacity-100"
                    style={{ left: `calc(${progressPct}% - 5px)` }}
                  />
                </div>
                <span className="text-[10px] text-white/40 w-9 tabular-nums font-mono">
                  {formatPlayerTime(displayedDuration)}
                </span>
              </div>
            </div>
          </div>

          {/* ── Mobile/tablet play controls (md only, no progress) ── */}
          <div className="flex items-center gap-0.5 md:hidden">
            {isShapedRadioTrack ? (
              <RadioFeedback
                sessionId={shapedRadioSessionId!}
                trackId={currentTrack.libraryTrackId}
                onDislike={handleNextTrack}
                size="sm"
              />
            ) : (
              <button onClick={handlePreviousTrack} aria-label="Previous track" className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-white/50 transition-colors active:bg-white/5 active:text-white">
                <SkipBack size={18} fill="currentColor" />
              </button>
            )}
            <button
              onClick={handlePlayPause}
              aria-label={isPlaying ? "Pause" : "Play"}
              className={cn(
                "flex h-11 w-11 touch-manipulation items-center justify-center rounded-full border text-black transition-[transform,background-color,box-shadow,border-color] duration-200 active:scale-95",
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
                onTouchStart={prepareFullscreenPlayer}
                onClick={openFullscreenPlayer}
                aria-label="Open fullscreen player"
                className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-white/35 transition-colors active:bg-white/5 active:text-white/60 hover:text-white/60"
              >
                <Maximize2 size={16} />
              </button>
            ) : (
              <button onClick={handleNextTrack} aria-label="Next track" className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-white/50 transition-colors active:bg-white/5 active:text-white">
                <SkipForward size={18} fill="currentColor" />
              </button>
            )}
          </div>

          {/* ── Block 3: Action Buttons ── */}
          <div className="hidden shrink-0 items-center justify-end md:flex md:w-[260px] lg:w-[340px] xl:w-[min(34vw,520px)] 2xl:w-[min(38vw,680px)]">
            <div className="hidden items-center justify-end gap-1 lg:flex">
              {/* Quality badge */}
              {qualityBadge && (
                <span className="mr-1 inline-flex items-center">
                  <QualityBadge
                    badge={qualityBadge}
                    origin={showsDeliveryQuality ? "stream" : "source"}
                  />
                </span>
              )}

              {/* Volume */}
              <PlayerVolumeControl
                volume={volume}
                onVolumeChange={setVolume}
                onOverlayChange={setHasFloatingOverlayOpen}
              />

              {/* Device (placeholder) */}
              <button className="hidden rounded-md p-1.5 text-white/30 transition-colors hover:bg-white/5 hover:text-white/60 xl:block" aria-label="Connect device">
                <Airplay size={16} />
              </button>

              {/* Equalizer (hidden when extended player is open) */}
              {!extendedOpen && allowEqualizer && (
                <button
                  onClick={() => {
                    triggerHaptic("selection");
                    prepareEqualizerPopover();
                    setShowEqualizer((v) => !v);
                    setShowQueue(false);
                    setShowLyrics(false);
                  }}
                  onMouseEnter={prepareEqualizerPopover}
                  onFocus={prepareEqualizerPopover}
                  aria-label="Equalizer"
                  className={`rounded-md p-1.5 transition-colors hover:bg-white/5 ${showEqualizer ? "text-primary" : "text-white/30 hover:text-white/60"}`}
                >
                  <SlidersHorizontal size={16} />
                </button>
              )}

              {/* Queue (hidden when extended player is open) */}
              {!extendedOpen && (
                <button
                  onClick={handleToggleQueue}
                  onMouseEnter={prepareQueuePanel}
                  onFocus={prepareQueuePanel}
                  className={`relative rounded-md p-1.5 transition-colors hover:bg-white/5 ${showQueue ? "text-primary" : "text-white/30 hover:text-white/60"}`}
                  aria-label="Queue"
                >
                  <ListMusic size={16} />
                  {queue.length > 1 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
                      {queue.length - currentIndex - 1}
                    </span>
                  )}
                </button>
              )}

              {/* Lyrics (hidden when extended player is open) */}
              {!extendedOpen && (
                <button
                  onClick={handleToggleLyrics}
                  onMouseEnter={prepareLyricsPanel}
                  onFocus={prepareLyricsPanel}
                  className={`hidden rounded-md p-1.5 transition-colors hover:bg-white/5 xl:block ${showLyrics ? "text-primary" : "text-white/30 hover:text-white/60"}`}
                  aria-label="Lyrics"
                >
                  <Mic2 size={16} />
                </button>
              )}

              {/* Extended / Full player */}
              <button
                onClick={handleToggleExtendedPlayer}
                onMouseEnter={prepareExtendedPlayer}
                onFocus={prepareExtendedPlayer}
                className={`rounded-md p-1.5 transition-colors hover:bg-white/5 ${extendedOpen ? "text-primary" : "text-white/30 hover:text-white/60"}`}
                aria-label="Expand player"
              >
                <Maximize2 size={16} />
              </button>
            </div>
          </div>

          {/* ── Compact action buttons (md only, no lg) ── */}
          <div className="hidden items-center gap-1 md:flex lg:hidden">
            {!extendedOpen && (
              <button
                onClick={handleToggleQueue}
                onMouseEnter={prepareQueuePanel}
                onFocus={prepareQueuePanel}
                aria-label="Queue"
                className={`p-1.5 hover:bg-white/5 rounded-md transition-colors relative ${showQueue ? "text-primary" : "text-white/30 hover:text-white/60"}`}
              >
                <ListMusic size={16} />
              </button>
            )}
            <button
              onClick={handleToggleExtendedPlayer}
              onMouseEnter={prepareExtendedPlayer}
              onFocus={prepareExtendedPlayer}
              aria-label="Expand player"
              className={`p-1.5 hover:bg-white/5 rounded-md transition-colors ${extendedOpen ? "text-primary" : "text-white/30 hover:text-white/60"}`}
            >
              <Maximize2 size={16} />
            </button>
          </div>

        </div>
        </div>
      ) : null}
      {shouldRenderQueuePanel ? (
        <Suspense fallback={<PlayerSurfaceFallback />}>
          <LazyQueuePanel open={showQueue} onClose={() => setShowQueue(false)} />
        </Suspense>
      ) : null}
      {shouldRenderLyricsPanel ? (
        <Suspense fallback={<PlayerSurfaceFallback />}>
          <LazyLyricsPanel open={showLyrics} onClose={() => setShowLyrics(false)} />
        </Suspense>
      ) : null}
      {shouldRenderEqualizerPopover ? (
        <Suspense fallback={<PlayerSurfaceFallback />}>
          <LazyEqualizerPopover open={showEqualizer} onClose={() => setShowEqualizer(false)} />
        </Suspense>
      ) : null}
      {shouldRenderExtendedPlayer ? (
        <Suspense fallback={<PlayerSurfaceFallback />}>
          <LazyExtendedPlayer open={extendedOpen} onClose={() => setExtendedOpen(false)} />
        </Suspense>
      ) : null}
      {!isDesktop && shouldRenderFullscreenPlayer ? (
        <Suspense fallback={<PlayerSurfaceFallback fullscreen />}>
          <LazyFullscreenPlayer open={fsOpen} onClose={() => setFsOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
