import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { ItemActionMenu, ItemActionMenuButton, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { trackToMenuData } from "@/components/actions/shared";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { PlayerTrackIdentity } from "@/components/player/PlayerTrackIdentity";
import { PlayerSurfaceModeSwitch } from "@/components/player/PlayerSurfaceModeSwitch";
import { SpinningDisc } from "@/components/player/SpinningDisc";
import { getPlaySourceLabel } from "@/components/player/player-source";
import { useResolvedPlayerArtist } from "@/components/player/useResolvedPlayerArtist";
import { EqualizerPanel } from "@/components/player/EqualizerPanel";
import { InfoTab } from "@/components/player/extended/InfoTab";
import { PlayerTrackMenu } from "@/components/player/bar/PlayerTrackMenu";
import { api } from "@/lib/api";
import {
  canUseWebAudioEffects,
  isMobileAudioRuntime,
  stableMobileAudioPipeline,
} from "@/lib/mobile-audio-mode";
import {
  getPlayerSurfaceModePreference,
  PLAYER_VIZ_PREFS_EVENT,
  setPlayerSurfaceModePreference,
  type PlayerSurfaceMode,
} from "@/lib/player-visualizer-prefs";
import {
  ChevronDown,
  ListMusic,
  AlignLeft,
  Disc3,
  Heart,
  Info,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { artistPagePath } from "@/lib/library-routes";
import { usePlayer, usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { useCrossfadeAwareProgress, useCrossfadeProgress } from "@/hooks/use-crossfade-progress";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { useEscapeKey } from "@crate/ui/lib/use-escape-key";
import { PlayerSeekBar } from "@/components/player/bar/PlayerSeekBar";
import { formatPlayerTime } from "@/components/player/bar/player-bar-utils";
import { getHorizontalPlayerSwipeAction } from "@/components/player/player-gestures";
import { toast } from "sonner";
import { triggerHaptic } from "@/lib/haptics";

type FSTab = "player" | "queue" | "lyrics" | "info";

interface LyricLine { time: number; text: string; }

function parseSyncedLyrics(raw: string): LyricLine[] {
  return raw.split("\n").reduce<LyricLine[]>((acc, line) => {
    const m = line.match(/^\[(\d+):(\d+)\.(\d+)\](.*)/);
    if (m) acc.push({ time: +m[1]! * 60 + +m[2]! + +m[3]! / 100, text: m[4]!.trim() });
    return acc;
  }, []);
}

function getMobileSurfaceModePreference(): PlayerSurfaceMode {
  const mode = getPlayerSurfaceModePreference();
  return mode === "visualizer" ? "cd" : mode;
}

interface FullscreenPlayerProps {
  open: boolean;
  onClose: () => void;
}

function FullscreenQueueRow({
  track,
  onJump,
}: {
  track: Track;
  onJump: () => void;
}) {
  const menuTrack = useMemo(() => trackToMenuData(track), [track]);
  const actions = useTrackActionEntries({
    track: menuTrack,
    albumCover: track.albumCover,
    onPlayNowOverride: onJump,
  });
  const actionMenu = useItemActionMenu(actions);

  function jumpWithFeedback() {
    triggerHaptic("selection");
    onJump();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={jumpWithFeedback}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          jumpWithFeedback();
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      className="flex items-center gap-3 w-full py-2 text-left active:bg-white/5 rounded-lg transition-colors focus-visible:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {track.albumCover ? (
        <img
          src={track.albumCover}
          alt=""
          loading="lazy"
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
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        className="h-9 w-9 shrink-0 opacity-85 transition-opacity hover:opacity-100"
      />
      <ItemActionMenu
        actions={actions}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}

export function FullscreenPlayer({ open, onClose }: FullscreenPlayerProps) {
  const {
    currentTrack,
    queue,
    currentIndex,
    currentTime,
    duration,
    isBuffering,
    seek,
    jumpTo,
    isPlaying,
    crossfadeTransition,
    playSource,
    shuffle,
    repeat,
  } = usePlayer();
  const { pause, resume, next, prev, toggleShuffle, cycleRepeat } = usePlayerActions();
  const { isLiked, toggleTrackLike } = useLikedTracks();
  const crossfadeProgress = useCrossfadeProgress(crossfadeTransition);
  // Keep the crossfade visuals, but let time/progress track the live
  // incoming song so the UI does not jump backwards after the fade.
  const { displayedTime, displayedDuration } = useCrossfadeAwareProgress(
    crossfadeTransition,
    currentTime,
    duration,
  );
  const navigate = useNavigate();
  const allowMobileEqualizer = canUseWebAudioEffects;

  const [activeTab, setActiveTab] = useState<FSTab>("player");
  const [surfaceMode, setSurfaceMode] = useState<PlayerSurfaceMode>(getMobileSurfaceModePreference);
  const [lyrics, setLyrics] = useState<{ synced: LyricLine[] | null; plain: string | null } | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [swipeY, setSwipeY] = useState(0);
  const [showEqualizer, setShowEqualizer] = useState(false);
  const { resolvedArtist, artistAvatarUrl, markArtistPhotoFailed } = useResolvedPlayerArtist(currentTrack, queue);
  const sourceLabel = getPlaySourceLabel(playSource);
  const liked = currentTrack
    ? isLiked(
        currentTrack.libraryTrackId ?? null,
        currentTrack.entityUid ?? null,
        currentTrack.path || currentTrack.id,
      )
    : false;

  const swipeStartRef = useRef<number | null>(null);
  const horizontalSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeYRef = useRef(0);
  const swipeFrameRef = useRef<number | null>(null);
  const draggingRef = useRef(false);

  const coverRef = useRef<HTMLDivElement>(null);
  const fsRootRef = useRef<HTMLDivElement>(null);
  const equalizerRef = useRef<HTMLDivElement>(null);
  const equalizerButtonRef = useRef<HTMLButtonElement>(null);
  const isCdMode = surfaceMode === "cd";

  function closeWithFeedback() {
    triggerHaptic("selection");
    onClose();
  }

  function togglePlaybackWithFeedback() {
    triggerHaptic("light");
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  }

  async function toggleLikeWithFeedback() {
    if (!currentTrack) return;
    triggerHaptic("selection");
    try {
      const nextLiked = await toggleTrackLike(
        currentTrack.libraryTrackId ?? null,
        currentTrack.entityUid ?? null,
        currentTrack.path || currentTrack.id,
      );
      toast.success(nextLiked ? "Added to liked tracks" : "Removed from liked tracks");
    } catch {
      toast.error("Failed to update liked tracks");
    }
  }

  function goNextWithFeedback() {
    triggerHaptic("selection");
    next();
  }

  function goPrevWithFeedback() {
    triggerHaptic("selection");
    prev();
  }

  function toggleShuffleWithFeedback() {
    triggerHaptic("selection");
    toggleShuffle();
  }

  function cycleRepeatWithFeedback() {
    triggerHaptic("selection");
    cycleRepeat();
  }

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
    if (showEqualizer) { setShowEqualizer(false); return; }
    if (activeTab !== "player") {
      setActiveTab("player");
      return;
    }
    onClose();
  });

  function goToArtist() {
    const targetArtist = resolvedArtist;
    if (!targetArtist?.id) return;
    onClose();
    navigate(artistPagePath({
      artistId: targetArtist.id,
      artistSlug: targetArtist.slug,
      artistName: targetArtist.name,
    }));
  }

  useEffect(() => {
    const syncSurfaceMode = () => setSurfaceMode(getMobileSurfaceModePreference());
    window.addEventListener("storage", syncSurfaceMode);
    window.addEventListener(PLAYER_VIZ_PREFS_EVENT, syncSurfaceMode as EventListener);
    return () => {
      window.removeEventListener("storage", syncSurfaceMode);
      window.removeEventListener(PLAYER_VIZ_PREFS_EVENT, syncSurfaceMode as EventListener);
    };
  }, []);

  // Lyrics fetch
  useEffect(() => {
    if (!visible || activeTab !== "lyrics" || !currentTrack) {
      if (!visible || !currentTrack) setLyrics(null);
      return;
    }
    const controller = new AbortController();
    setLyrics(null);
    api<{ syncedLyrics: string | null; plainLyrics: string | null }>(
      `/api/lyrics?artist=${encodeURIComponent(currentTrack.artist || "")}&title=${encodeURIComponent(currentTrack.title || "")}`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((d) => {
        if (controller.signal.aborted) return;
        setLyrics({
          synced: d.syncedLyrics ? parseSyncedLyrics(d.syncedLyrics) : null,
          plain: d.plainLyrics || null,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLyrics({ synced: null, plain: null });
      });
    return () => controller.abort();
  }, [activeTab, visible, currentTrack?.id, currentTrack?.artist, currentTrack?.title]);

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
  useEffect(() => {
    if (visible) return;
    setActiveTab("player");
    swipeYRef.current = 0;
    setSwipeY(0);
    setShowEqualizer(false);
  }, [visible]);

  useDismissibleLayer({
    active: visible && showEqualizer,
    refs: [equalizerRef, equalizerButtonRef],
    onDismiss: () => {
      setShowEqualizer(false);
    },
    closeOnEscape: false,
  });

  useEffect(() => {
    if (!visible) return;
    const handleNativeBack = (event: Event) => {
      event.preventDefault();
      if (showEqualizer) {
        setShowEqualizer(false);
        return;
      }
      if (activeTab !== "player") {
        setActiveTab("player");
        return;
      }
      onClose();
    };
    window.addEventListener("crate:native-back", handleNativeBack);
    return () => window.removeEventListener("crate:native-back", handleNativeBack);
  }, [activeTab, onClose, showEqualizer, visible]);

  useEffect(() => () => {
    if (swipeFrameRef.current != null) {
      window.cancelAnimationFrame(swipeFrameRef.current);
    }
  }, []);

  const scheduleSwipeY = useCallback((nextY: number) => {
    swipeYRef.current = nextY;
    if (swipeFrameRef.current != null) return;
    swipeFrameRef.current = window.requestAnimationFrame(() => {
      swipeFrameRef.current = null;
      setSwipeY(swipeYRef.current);
    });
  }, []);

  // Swipe-down to dismiss from the upper part of the sheet.
  const onSwipeStart = useCallback((e: React.TouchEvent) => {
    if (draggingRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    const startX = touch.clientX;
    const startY = touch.clientY;
    const el = (e.currentTarget as HTMLElement).getBoundingClientRect();
    horizontalSwipeStartRef.current = activeTab === "player" ? { x: startX, y: startY } : null;
    if (startY - el.top > Math.min(260, el.height * 0.35)) return;
    swipeStartRef.current = startY;
  }, [activeTab]);
  const onSwipeMove = useCallback((e: React.TouchEvent) => {
    if (swipeStartRef.current === null || draggingRef.current) return;
    const dy = e.touches[0]!.clientY - swipeStartRef.current;
    scheduleSwipeY(dy > 0 ? Math.min(dy * 0.6, 300) : 0);
  }, [scheduleSwipeY]);
  const onSwipeEnd = useCallback((e: React.TouchEvent) => {
    const horizontalStart = horizontalSwipeStartRef.current;
    horizontalSwipeStartRef.current = null;

    if (horizontalStart && activeTab === "player" && !draggingRef.current) {
      const touch = e.changedTouches[0];
      if (touch) {
        const action = getHorizontalPlayerSwipeAction({
          deltaX: touch.clientX - horizontalStart.x,
          deltaY: touch.clientY - horizontalStart.y,
          viewportWidth: window.innerWidth,
        });
        if (action) {
          if (action === "next") {
            goNextWithFeedback();
          } else {
            goPrevWithFeedback();
          }
          scheduleSwipeY(0);
          swipeStartRef.current = null;
          return;
        }
      }
    }

    if (swipeYRef.current > 100) {
      triggerHaptic("selection");
      onClose();
    }
    scheduleSwipeY(0);
    swipeStartRef.current = null;
  }, [activeTab, goNextWithFeedback, goPrevWithFeedback, onClose, scheduleSwipeY]);

  if (!visible || !currentTrack) return null;

  const upcomingTracks = queue.slice(currentIndex + 1, currentIndex + 20);
  const remainingTime = Math.max(0, displayedDuration - displayedTime);
  const playerTabBottomClearance = "var(--listen-mobile-fullscreen-player-clearance)";
  const scrollTabBottomClearance = "var(--listen-mobile-fullscreen-scroll-clearance)";

  const TAB_PILLS: { id: FSTab; icon: typeof Disc3; label: string }[] = [
    { id: "player", icon: Disc3, label: "Player" },
    { id: "queue", icon: ListMusic, label: "Queue" },
    { id: "lyrics", icon: AlignLeft, label: "Lyrics" },
    { id: "info", icon: Info, label: "Info" },
  ];

  return (
    <div
      ref={fsRootRef}
      className={`fixed inset-0 z-fullscreen-player flex flex-col ease-out ${
        animating
          ? "opacity-100"
          : "opacity-0 translate-y-full"
      }`}
      style={{
        background: "linear-gradient(180deg, #1a2030 0%, #0a0a0f 100%)",
        minHeight: "var(--listen-viewport-height)",
        height: "var(--listen-viewport-height)",
        transform: swipeY > 0 ? `translateY(${swipeY}px)` : undefined,
        transition: swipeY > 0 ? "none" : "all 300ms ease-out",
        opacity: swipeY > 0 ? Math.max(0.3, 1 - swipeY / 400) : undefined,
      }}
      onTouchStart={onSwipeStart}
      onTouchMove={onSwipeMove}
      onTouchEnd={onSwipeEnd}
    >
      {/* Drag handle */}
      <div className="flex justify-center pb-1" style={{ paddingTop: "calc(var(--listen-safe-top) + 0.75rem)" }}>
        <div className="w-10 h-1 rounded-full bg-white/20" />
      </div>

      {/* Header row 1: close + compact actions */}
      <div className="flex items-center justify-between px-4 pb-1">
        <button
          onClick={closeWithFeedback}
          aria-label="Close player"
          className="w-11 h-11 flex items-center justify-center -ml-2 text-white/60 active:text-white"
        >
          <ChevronDown size={28} />
        </button>

        <div className="flex items-center -mr-2">
          <PlayerSurfaceModeSwitch
            allowVisualizer={false}
            className="mr-1"
            mode={surfaceMode}
            onChange={(mode) => {
              triggerHaptic("selection");
              const nextMode = mode === "visualizer" ? "cd" : mode;
              setSurfaceMode(nextMode);
              setPlayerSurfaceModePreference(nextMode);
            }}
            size="md"
            variant="ghost"
          />
          {allowMobileEqualizer ? (
            <button
              ref={equalizerButtonRef}
              onClick={() => {
                triggerHaptic("selection");
                setShowEqualizer((v) => !v);
              }}
              aria-label="Equalizer"
              className={`w-11 h-11 flex items-center justify-center transition-colors ${showEqualizer ? "text-primary" : "text-white/40 active:text-white/60"}`}
            >
              <SlidersHorizontal size={18} />
            </button>
          ) : isMobileAudioRuntime ? (
            <button
              type="button"
              onClick={() => {
                triggerHaptic("warning");
                toast.info(
                  stableMobileAudioPipeline
                    ? "Enable Enhanced mobile audio in Settings, then restart Listen to use EQ on mobile."
                    : "Restart Listen to apply the mobile audio mode change.",
                );
              }}
              aria-label="Equalizer is disabled in stable mobile audio mode"
              className="w-11 h-11 flex items-center justify-center text-white/20"
            >
              <SlidersHorizontal size={18} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Header row 2: tab pills */}
      <div className="flex items-center gap-2 px-4 pb-3">
        {TAB_PILLS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => {
              triggerHaptic("selection");
              setActiveTab(id);
            }}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${
              activeTab === id
                ? "bg-white/12 text-white border border-white/15"
                : "text-white/40 border border-transparent active:text-white/60"
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {allowMobileEqualizer && showEqualizer && (
        <div
          ref={equalizerRef}
          className="absolute left-4 right-4 z-40 overflow-y-auto rounded-xl bg-white/5 p-4 backdrop-blur-md animate-fade-slide-up"
          style={{
            top: "var(--listen-mobile-fullscreen-eq-top)",
            maxHeight: "calc(var(--listen-viewport-height) - var(--listen-mobile-fullscreen-eq-top) - var(--listen-safe-bottom) - 1rem)",
          }}
        >
          <EqualizerPanel onClose={() => setShowEqualizer(false)} />
        </div>
      )}

      {/* ── Player tab ── */}
      {activeTab === "player" && (
      <div
        className="relative flex-1 flex flex-col items-center justify-center overflow-hidden px-6"
        style={{ paddingBottom: playerTabBottomClearance }}
      >
        <div className="mx-auto w-full max-w-[360px]">
          <div ref={coverRef} className="relative">
            {isCdMode ? (
              <SpinningDisc
                albumCover={currentTrack.albumCover}
                className="w-full"
                crossfadeIncomingCover={crossfadeTransition?.incoming.albumCover}
                crossfadeOutgoingCover={crossfadeTransition?.outgoing.albumCover}
                crossfadeProgress={crossfadeProgress}
                currentTime={displayedTime}
                duration={displayedDuration}
                isBuffering={isBuffering}
                isPlaying={isPlaying}
                jogEnabled
                onJoggingChange={(jogging) => { draggingRef.current = jogging; }}
                onSeek={seek}
                onTogglePlay={togglePlaybackWithFeedback}
              />
            ) : (
              <div className="relative aspect-square overflow-hidden rounded-xl">
                {crossfadeTransition ? (
                  <>
                    {crossfadeTransition.outgoing.albumCover ? (
                      <img
                        src={crossfadeTransition.outgoing.albumCover}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover shadow-2xl shadow-black/60"
                        style={{
                          opacity: 1 - crossfadeProgress,
                        }}
                      />
                    ) : null}
                    {crossfadeTransition.incoming.albumCover ? (
                      <img
                        src={crossfadeTransition.incoming.albumCover}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover shadow-2xl shadow-black/60"
                        style={{
                          opacity: crossfadeProgress,
                        }}
                      />
                    ) : null}
                  </>
                ) : currentTrack.albumCover ? (
                  <img
                    src={currentTrack.albumCover}
                    alt=""
                    className="h-full w-full object-cover shadow-2xl shadow-black/60"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white/5 shadow-2xl shadow-black/60">
                    <ListMusic size={64} className="text-white/10" />
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

        {/* Track info */}
        <div className="w-full mt-5 text-center">
          <PlayerTrackIdentity
            currentTrack={currentTrack}
            crossfadeTransition={crossfadeTransition}
            crossfadeProgress={crossfadeProgress}
            sourceLabel={sourceLabel}
            artistAvatarUrl={artistAvatarUrl}
            onArtistAvatarError={markArtistPhotoFailed}
            onArtistClick={goToArtist}
            artistClickable={!!resolvedArtist?.id}
            titleClassName="text-lg"
            albumClassName="text-xs"
          />
          <div className="mx-auto mt-4 w-full max-w-[360px]">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium tabular-nums text-muted-foreground">
              <span>{formatPlayerTime(displayedTime)}</span>
              <span>-{formatPlayerTime(remainingTime)}</span>
            </div>
            <PlayerSeekBar
              currentTime={displayedTime}
              duration={displayedDuration}
              onSeek={seek}
              thin
              variant="glow"
            />
          </div>

          <div className="mx-auto mt-5 flex w-full max-w-[360px] items-center justify-center gap-3">
            <button
              onClick={toggleShuffleWithFeedback}
              aria-label={shuffle ? "Disable shuffle" : "Enable shuffle"}
              className={`flex h-11 w-11 touch-manipulation items-center justify-center rounded-full transition-colors active:bg-white/8 ${
                shuffle ? "text-primary" : "text-white/35 active:text-white/70"
              }`}
            >
              <Shuffle size={18} />
            </button>
            <button
              onClick={goPrevWithFeedback}
              aria-label="Previous track"
              className="flex h-12 w-12 touch-manipulation items-center justify-center rounded-full text-white/70 transition-colors active:bg-white/8 active:text-white"
            >
              <SkipBack size={22} fill="currentColor" />
            </button>
            <button
              onClick={togglePlaybackWithFeedback}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="flex h-16 w-16 touch-manipulation items-center justify-center rounded-full bg-primary text-black shadow-[0_12px_36px_rgba(6,182,212,0.28)] transition-transform active:scale-95"
            >
              {isBuffering ? (
                <Loader2 size={22} className="animate-spin" />
              ) : isPlaying ? (
                <Pause size={24} />
              ) : (
                <Play size={24} className="ml-1" fill="currentColor" />
              )}
            </button>
            <button
              onClick={goNextWithFeedback}
              aria-label="Next track"
              className="flex h-12 w-12 touch-manipulation items-center justify-center rounded-full text-white/70 transition-colors active:bg-white/8 active:text-white"
            >
              <SkipForward size={22} fill="currentColor" />
            </button>
            <button
              onClick={cycleRepeatWithFeedback}
              aria-label={`Repeat: ${repeat}`}
              className={`flex h-11 w-11 touch-manipulation items-center justify-center rounded-full transition-colors active:bg-white/8 ${
                repeat !== "off" ? "text-primary" : "text-white/35 active:text-white/70"
              }`}
            >
              {repeat === "one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
            </button>
          </div>

          <div className="mx-auto mt-3 flex w-full max-w-[360px] items-center justify-center gap-3">
            <button
              onClick={() => { void toggleLikeWithFeedback(); }}
              aria-label={liked ? "Unlike track" : "Like track"}
              className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/55 transition-colors active:bg-white/8 active:text-white"
            >
              <Heart size={19} className={liked ? "fill-primary text-primary" : ""} />
            </button>
            <PlayerTrackMenu
              currentTrack={currentTrack}
              className="h-11 w-11 rounded-full border border-white/10 bg-white/[0.04] text-white/55 transition-colors active:bg-white/8 active:text-white"
            />
          </div>
        </div>
      </div>
      )}

      {/* ── Queue tab ── */}
      {activeTab === "queue" && (
        <div className="flex-1 overflow-y-auto" style={{ paddingBottom: scrollTabBottomClearance }}>
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
                <FullscreenQueueRow
                  key={`${track.id}-${queueIndex}`}
                  track={track}
                  onJump={() => jumpTo(queueIndex)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ── Lyrics tab ── */}
      {activeTab === "lyrics" && (
        <div ref={lyricsContainerRef} className="flex-1 overflow-y-auto px-6 py-4" style={{ paddingBottom: scrollTabBottomClearance }}>
          {!lyrics ? (
            <p className="text-center text-white/40 text-sm mt-20">Loading lyrics...</p>
          ) : lyrics.synced ? (
            <div className="flex flex-col items-center gap-1 py-8">
              {lyrics.synced.map((line, i) => (
                <button
                  key={i}
                  ref={i === activeLyricIndex ? activeLyricRef : null}
                  onClick={() => {
                    triggerHaptic("selection");
                    seek(line.time);
                  }}
                  className={`w-full max-w-md rounded-md px-3 py-1 text-center transition-all duration-500 ${
                    i === activeLyricIndex
                      ? "bg-primary/10 text-lg font-semibold text-primary"
                      : i < activeLyricIndex
                        ? "text-[15px] text-white/25"
                        : "text-[15px] text-white/50"
                  }`}
                >
                  {line.text || "♪"}
                </button>
              ))}
            </div>
          ) : lyrics.plain ? (
            <pre className="text-sm text-muted-foreground whitespace-pre-wrap text-center leading-relaxed py-8">{lyrics.plain}</pre>
          ) : (
            <p className="text-center text-white/40 text-sm mt-20">No lyrics available</p>
          )}
        </div>
      )}

      {activeTab === "info" && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3" style={{ paddingBottom: scrollTabBottomClearance }}>
          <InfoTab className="pr-0" />
        </div>
      )}
    </div>
  );
}
