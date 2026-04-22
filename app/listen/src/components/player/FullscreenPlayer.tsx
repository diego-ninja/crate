import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import { ItemActionMenu, ItemActionMenuButton, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { trackToMenuData } from "@/components/actions/shared";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { useMusicVisualizer } from "@/components/player/visualizer/useMusicVisualizer";
import { useVisualizerConfig } from "@/components/player/visualizer/useVisualizerConfig";
import { EqualizerPanel } from "@/components/player/EqualizerPanel";
import { VisualizerSettingsPanel } from "@/components/player/visualizer/VisualizerSettingsPanel";
import { api } from "@/lib/api";
import {
  ChevronDown,
  ListMusic,
  AlignLeft,
  Disc3,
  Settings,
  SlidersHorizontal,
  User,
} from "lucide-react";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";
import { usePlayer, type Track } from "@/contexts/PlayerContext";
import { useCrossfadeAwareProgress, useCrossfadeProgress } from "@/hooks/use-crossfade-progress";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { PlayerSeekBar } from "@/components/player/bar/PlayerSeekBar";
import { formatPlayerTime } from "@/components/player/bar/player-bar-utils";

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

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onJump}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onJump();
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
  const { currentTrack, queue, currentIndex, currentTime, duration, seek, jumpTo, isPlaying, volume, analyserVersion, crossfadeTransition } = usePlayer();
  const crossfadeProgress = useCrossfadeProgress(crossfadeTransition);
  // Keep the crossfade visuals, but let time/progress track the live
  // incoming song so the UI does not jump backwards after the fade.
  const { displayedTime, displayedDuration } = useCrossfadeAwareProgress(
    crossfadeTransition,
    currentTime,
    duration,
  );
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<FSTab>("player");
  const [lyrics, setLyrics] = useState<{ synced: LyricLine[] | null; plain: string | null } | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [swipeY, setSwipeY] = useState(0);
  const [showVizSettings, setShowVizSettings] = useState(false);
  const [showEqualizer, setShowEqualizer] = useState(false);

  const swipeStartRef = useRef<number | null>(null);
  const draggingRef = useRef(false);

  // Visualizer
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const fsRootRef = useRef<HTMLDivElement>(null);
  const playbackState = useMemo(() => ({ isPlaying, volume }), [isPlaying, volume]);
  const vizRef = useMusicVisualizer(
    canvasRef,
    `${currentTrack?.id ?? "none"}:${analyserVersion}`,
    visible && activeTab === "player",
    playbackState,
  );
  const vizCfg = useVisualizerConfig(vizRef, currentTrack, visible && activeTab === "player", crossfadeTransition);
  const [canvasRect, setCanvasRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  // Measure cover position relative to FS root, expand canvas 25%.
  // Re-runs on viz settings toggle, tab change, and window resize.
  useEffect(() => {
    if (!visible || activeTab !== "player") return;
    const measure = () => {
      const cover = coverRef.current;
      const root = fsRootRef.current;
      if (!cover || !root) return;
      const cr = cover.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      // Skip if still animating in (root off-screen)
      if (rr.top > window.innerHeight * 0.5) return;
      const expand = 0.25;
      const ew = cr.width * expand;
      const eh = cr.height * expand;
      setCanvasRect({
        top: cr.top - rr.top - eh / 2,
        left: cr.left - rr.left - ew / 2,
        width: cr.width + ew,
        height: cr.height + eh,
      });
    };
    // Wait for open animation to settle before first measure
    const t1 = window.setTimeout(measure, 350);
    const resizeObs = new ResizeObserver(measure);
    if (coverRef.current) resizeObs.observe(coverRef.current);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(t1);
      resizeObs.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [visible, activeTab, showVizSettings]);

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
    if (showVizSettings) {
      setShowVizSettings(false);
      return;
    }
    if (activeTab !== "player") {
      setActiveTab("player");
      return;
    }
    onClose();
  });

  function goToArtist() {
    if (currentTrack?.artistId == null) return;
    onClose();
    navigate(artistPagePath({ artistId: currentTrack.artistId, artistSlug: currentTrack.artistSlug }));
  }

  const artistPhotoUrl = currentTrack?.artistId != null
    ? artistPhotoApiUrl({ artistId: currentTrack.artistId, artistSlug: currentTrack.artistSlug, artistName: currentTrack.artist })
    : null;

  // Lyrics fetch
  useEffect(() => {
    if (!visible || !currentTrack) { setLyrics(null); return; }
    let cancelled = false;
    setLyrics(null);
    api<{ syncedLyrics: string | null; plainLyrics: string | null }>(`/api/lyrics?artist=${encodeURIComponent(currentTrack.artist || "")}&title=${encodeURIComponent(currentTrack.title || "")}`)
      .then((d) => {
        if (cancelled) return;
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
  useEffect(() => { if (!visible) { setActiveTab("player"); setSwipeY(0); setShowVizSettings(false); setShowEqualizer(false); } }, [visible]);

  // Swipe-down to dismiss (only from top 150px)
  const onSwipeStart = useCallback((e: React.TouchEvent) => {
    if (draggingRef.current) return;
    const startY = e.touches[0]!.clientY;
    const el = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (startY - el.top > 150) return;
    swipeStartRef.current = startY;
  }, []);
  const onSwipeMove = useCallback((e: React.TouchEvent) => {
    if (swipeStartRef.current === null || draggingRef.current) return;
    const dy = e.touches[0]!.clientY - swipeStartRef.current;
    setSwipeY(dy > 0 ? Math.min(dy * 0.6, 300) : 0);
  }, []);
  const onSwipeEnd = useCallback(() => {
    if (swipeY > 100) {
      onClose();
    }
    setSwipeY(0);
    swipeStartRef.current = null;
  }, [swipeY, onClose]);

  if (!visible || !currentTrack) return null;

  const upcomingTracks = queue.slice(currentIndex + 1, currentIndex + 20);
  const remainingTime = Math.max(0, displayedDuration - displayedTime);

  const TAB_PILLS: { id: FSTab; icon: typeof Disc3; label: string }[] = [
    { id: "player", icon: Disc3, label: "Player" },
    { id: "queue", icon: ListMusic, label: "Queue" },
    { id: "lyrics", icon: AlignLeft, label: "Lyrics" },
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
        transform: swipeY > 0 ? `translateY(${swipeY}px)` : undefined,
        transition: swipeY > 0 ? "none" : "all 300ms ease-out",
        opacity: swipeY > 0 ? Math.max(0.3, 1 - swipeY / 400) : undefined,
      }}
      onTouchStart={onSwipeStart}
      onTouchMove={onSwipeMove}
      onTouchEnd={onSwipeEnd}
    >
      {/* WebGL canvas — positioned at root level, floats above cover */}
      <div
        className={`pointer-events-none absolute ${showVizSettings || showEqualizer ? "z-30" : "z-50"} ${
          vizCfg.vizEnabled && activeTab === "player" && canvasRect ? "" : "hidden"
        }`}
        style={canvasRect ? { top: canvasRect.top, left: canvasRect.left, width: canvasRect.width, height: canvasRect.height } : undefined}
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full"
          style={{ background: "transparent" }}
        />
      </div>

      {/* Drag handle */}
      <div className="flex justify-center pt-3 pb-1">
        <div className="w-10 h-1 rounded-full bg-white/20" />
      </div>

      {/* Header row 1: close + artist pill + viz settings */}
      <div className="flex items-center justify-between px-4 pt-[env(safe-area-inset-top,8px)] pb-1">
        <button
          onClick={onClose}
          aria-label="Close player"
          className="w-11 h-11 flex items-center justify-center -ml-2 text-white/60 active:text-white"
        >
          <ChevronDown size={28} />
        </button>

        {/* Artist pill */}
        <button
          onClick={goToArtist}
          aria-label={`Go to ${currentTrack.artist}`}
          className="flex items-center gap-2 rounded-full bg-white/8 border border-white/10 pl-1 pr-3 py-1 active:bg-white/12 transition-colors"
        >
          {artistPhotoUrl ? (
            <img src={artistPhotoUrl} alt={currentTrack.artist} className="w-6 h-6 rounded-full object-cover" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
              <User size={12} className="text-white/40" />
            </div>
          )}
          <span className="text-[12px] font-medium text-white/80 truncate max-w-[140px]">
            {currentTrack.artist}
          </span>
        </button>

        <div className="flex items-center -mr-2">
          <button
            onClick={() => { setShowEqualizer((v) => !v); setShowVizSettings(false); }}
            aria-label="Equalizer"
            className={`w-11 h-11 flex items-center justify-center transition-colors ${showEqualizer ? "text-primary" : "text-white/40 active:text-white/60"}`}
          >
            <SlidersHorizontal size={18} />
          </button>
          <button
            onClick={() => { setShowVizSettings(!showVizSettings); setShowEqualizer(false); }}
            aria-label="Visualizer settings"
            className={`w-11 h-11 flex items-center justify-center transition-colors ${showVizSettings ? "text-primary" : "text-white/40 active:text-white/60"}`}
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* Header row 2: tab pills */}
      <div className="flex items-center gap-2 px-4 pb-3">
        {TAB_PILLS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => { setActiveTab(id); setShowVizSettings(false); }}
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

      {/* Visualizer settings panel */}
      {showVizSettings && (
        <div className="relative z-40 mx-4 mb-2 rounded-xl bg-white/5 backdrop-blur-md p-4 animate-fade-slide-up">
          <VisualizerSettingsPanel config={vizCfg} />
        </div>
      )}

      {/* Equalizer panel — absolute overlay so it doesn't push the cover
          (and its measured visualizer canvas) out of place on mobile. */}
      {showEqualizer && (
        <div className="absolute left-4 right-4 top-28 z-40 max-h-[calc(100dvh-220px)] overflow-y-auto rounded-xl bg-white/5 p-4 backdrop-blur-md animate-fade-slide-up">
          <EqualizerPanel onClose={() => setShowEqualizer(false)} />
        </div>
      )}

      {/* ── Player tab ── */}
      {activeTab === "player" && (
      <div className="relative flex-1 flex flex-col items-center justify-center overflow-hidden px-6 pb-40">
        <div className="mx-auto w-full max-w-[360px]">
          {/* Album cover — large, centered. Crossfades during audio crossfade. */}
          <div ref={coverRef} className="relative overflow-hidden rounded-xl" style={{ aspectRatio: "1" }}>
            {crossfadeTransition ? (
              <>
                {crossfadeTransition.outgoing.albumCover ? (
                  <img
                    src={crossfadeTransition.outgoing.albumCover}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover shadow-2xl shadow-black/60"
                    style={{
                      filter: vizCfg.vizEnabled ? "grayscale(100%) brightness(0.35)" : "none",
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
                      filter: vizCfg.vizEnabled ? "grayscale(100%) brightness(0.35)" : "none",
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
                style={{ filter: vizCfg.vizEnabled ? "grayscale(100%) brightness(0.35)" : "none" }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-white/5 shadow-2xl shadow-black/60">
                <ListMusic size={64} className="text-white/10" />
              </div>
            )}
          </div>

        </div>

        {/* Track info */}
        <div className="w-full mt-5 text-center">
          {/* Title + album crossfade during audio crossfade; overlap via
              absolute positioning of the outgoing copy. */}
          <div className="relative">
            {crossfadeTransition ? (
              <>
                <div className="absolute inset-0" style={{ opacity: 1 - crossfadeProgress }}>
                  <h2 className="text-lg font-bold text-white truncate">
                    {crossfadeTransition.outgoing.title}
                  </h2>
                  {crossfadeTransition.outgoing.album && (
                    <p className="mt-1 text-xs text-white/40 truncate">{crossfadeTransition.outgoing.album}</p>
                  )}
                </div>
                <div style={{ opacity: crossfadeProgress }}>
                  <h2 className="text-lg font-bold text-white truncate">
                    {crossfadeTransition.incoming.title}
                  </h2>
                  {crossfadeTransition.incoming.album && (
                    <p className="mt-1 text-xs text-white/40 truncate">{crossfadeTransition.incoming.album}</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-white truncate">
                  {currentTrack.title}
                </h2>
                {currentTrack.album && (
                  <p className="mt-1 text-xs text-white/40 truncate">{currentTrack.album}</p>
                )}
              </>
            )}
          </div>
          {vizCfg.vizEnabled && vizCfg.trackAdaptiveViz && vizCfg.trackVizProfile.hasAnalysis && vizCfg.trackVizProfile.summary ? (
            <p className="mt-1 text-[9px] font-medium uppercase tracking-[0.18em] text-white/40">
              {vizCfg.trackVizProfile.summary}
            </p>
          ) : null}

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
            />
          </div>
        </div>
      </div>
      )}

      {/* ── Queue tab ── */}
      {activeTab === "queue" && (
        <div className="flex-1 overflow-y-auto pb-40">
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
        <div ref={lyricsContainerRef} className="flex-1 overflow-y-auto px-6 py-4 pb-40">
          {!lyrics ? (
            <p className="text-center text-white/40 text-sm mt-20">Loading lyrics...</p>
          ) : lyrics.synced ? (
            <div className="flex flex-col items-center gap-1 py-8">
              {lyrics.synced.map((line, i) => (
                <button
                  key={i}
                  ref={i === activeLyricIndex ? activeLyricRef : null}
                  onClick={() => seek(line.time)}
                  className={`w-full max-w-md rounded-lg border px-4 py-2.5 text-center transition-all duration-300 ${
                    i === activeLyricIndex
                      ? "border-primary/30 bg-primary/10 text-lg font-bold text-primary"
                      : i < activeLyricIndex
                        ? "border-transparent text-[15px] text-white/25"
                        : "border-transparent text-[15px] text-white/45 hover:bg-white/[0.03] hover:text-white/60"
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
    </div>
  );
}
