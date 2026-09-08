import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { artistPagePath } from "@/lib/library-routes";
import { getPlaySourceLabel } from "@/components/player/player-source";
import { triggerHaptic } from "@/lib/haptics";
import { useResolvedPlayerArtist } from "@/components/player/useResolvedPlayerArtist";
import { useMusicVisualizer } from "@/components/player/visualizer/useMusicVisualizer";
import { useVisualizerConfig } from "@/components/player/visualizer/useVisualizerConfig";
import { measureVisualizerCanvasRect } from "@/components/player/visualizer/canvas-layout";
import type { MusicVisualizer } from "@/components/player/visualizer/MusicVisualizer";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { getTrackCacheKey } from "@/contexts/player-utils";
import {
  useCrossfadeAwareProgress,
  useCrossfadeProgress,
} from "@/hooks/use-crossfade-progress";
import { useEqualizerEnabled } from "@/hooks/use-equalizer-enabled";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { useEscapeKey } from "@crate/ui/lib/use-escape-key";
import {
  ExtendedPlayerView,
  type ExtendedPlayerTabId,
} from "@/components/player/ExtendedPlayerView";

interface ExtendedPlayerProps {
  open: boolean;
  onClose: () => void;
}

export function ExtendedPlayer({ open, onClose }: ExtendedPlayerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const {
    currentTrack,
    currentTime,
    duration,
    isPlaying,
    isBuffering,
    volume,
    analyserVersion,
    crossfadeTransition,
  } = usePlayer();
  const { pause, resume, playSource, queue, seek, jamQueueLocked } =
    usePlayerActions();
  function toggleDiscPlay() {
    if (jamQueueLocked) return;
    if (isPlaying) pause();
    else resume();
  }
  const crossfadeProgress = useCrossfadeProgress(crossfadeTransition);
  const { displayedTime, displayedDuration } = useCrossfadeAwareProgress(
    crossfadeTransition,
    currentTime,
    duration,
  );
  const [tab, setTab] = useState<ExtendedPlayerTabId>("queue");
  const [showVizSettings, setShowVizSettings] = useState(false);
  const [showEqualizer, setShowEqualizer] = useState(false);
  const equalizerEnabled = useEqualizerEnabled();
  const { resolvedArtist, artistAvatarUrl, markArtistPhotoFailed } =
    useResolvedPlayerArtist(currentTrack, queue);
  const sourceLabel = getPlaySourceLabel(playSource);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const equalizerRef = useRef<HTMLDivElement>(null);
  const equalizerButtonRef = useRef<HTMLButtonElement>(null);
  const vizSettingsRef = useRef<HTMLDivElement>(null);
  const vizSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const vizRef = useRef<MusicVisualizer | null>(null);
  const playbackState = useMemo(
    () => ({ isPlaying, volume }),
    [isPlaying, volume],
  );
  const vizCfg = useVisualizerConfig(
    vizRef,
    currentTrack,
    open && isDesktop,
    crossfadeTransition,
  );
  const isVisualizerMode = vizCfg.surfaceMode === "visualizer";

  const [canvasRect, setCanvasRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    referenceSize: number;
  } | null>(null);
  useMusicVisualizer(
    canvasRef,
    `${
      currentTrack ? getTrackCacheKey(currentTrack) : "none"
    }:${analyserVersion}`,
    open && isDesktop && isVisualizerMode && canvasRect != null,
    playbackState,
    "spheres",
    vizRef,
  );

  // Measure cover position relative to the left panel and give the WebGL
  // canvas a bit more breathing room than the visualizer itself needs.
  useEffect(() => {
    if (!open || !isDesktop) return;
    const measure = () => {
      const cover = coverRef.current;
      const panel = panelRef.current;
      if (!cover || !panel) return;
      const cr = cover.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      // Skip measurement if panel is still animating (off-screen)
      if (pr.top > window.innerHeight * 0.5) return;
      setCanvasRect(
        measureVisualizerCanvasRect(cr, pr, {
          baseScale: 1.4,
          edgePadding: 20,
        }),
      );
    };
    // Wait for open animation to settle before first measure
    const t1 = window.setTimeout(measure, 550);
    const resizeObs = new ResizeObserver(measure);
    if (coverRef.current) resizeObs.observe(coverRef.current);
    if (panelRef.current) resizeObs.observe(panelRef.current);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(t1);
      resizeObs.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, isDesktop, showVizSettings, vizCfg.surfaceMode]);

  useDismissibleLayer({
    active:
      (isVisualizerMode && showVizSettings) ||
      (equalizerEnabled && showEqualizer),
    refs: [
      vizSettingsRef,
      vizSettingsButtonRef,
      equalizerRef,
      equalizerButtonRef,
    ],
    onDismiss: () => {
      setShowVizSettings(false);
      setShowEqualizer(false);
    },
    closeOnEscape: false,
  });

  const handleEscape = useCallback(
    (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (showVizSettings) {
        setShowVizSettings(false);
        return;
      }
      if (showEqualizer) {
        setShowEqualizer(false);
        return;
      }
      onClose();
    },
    [onClose, showEqualizer, showVizSettings],
  );

  useEscapeKey(open, handleEscape);

  if (!isDesktop || !currentTrack) return null;

  function closeWithFeedback() {
    triggerHaptic("selection");
    onClose();
  }

  function goToArtist() {
    if (!resolvedArtist?.id && !resolvedArtist?.globalArtistUid) return;
    navigate(
      resolvedArtist.globalArtistUid
        ? artistPagePath({
            artistId: resolvedArtist.id,
            globalArtistUid: resolvedArtist.globalArtistUid,
            artistSlug: resolvedArtist.slug,
            artistName: resolvedArtist.name,
          })
        : artistPagePath({
            artistId: resolvedArtist.id,
            artistSlug: resolvedArtist.slug,
            artistName: resolvedArtist.name,
          }),
    );
  }

  return (
    <ExtendedPlayerView
      open={open}
      t={t}
      state={{
        artistClickable: !!resolvedArtist?.id,
        currentTrack,
        crossfadeProgress,
        crossfadeTransition,
        displayedDuration,
        displayedTime,
        isBuffering,
        isPlaying,
        jamQueueLocked,
        showEqualizer: equalizerEnabled && showEqualizer,
        showVizSettings: isVisualizerMode && showVizSettings,
        tab,
        volume,
        canvasRect,
        vizCfg,
        equalizerEnabled,
      }}
      refs={{
        canvasRef,
        coverRef,
        panelRef,
        equalizerRef,
        equalizerButtonRef,
        vizSettingsRef,
        vizSettingsButtonRef,
      }}
      actions={{
        closeWithFeedback,
        goToArtist,
        onSurfaceModeChange: (mode) => {
          vizCfg.setSurfaceMode(mode);
          if (mode !== "visualizer") setShowVizSettings(false);
        },
        onTabChange: setTab,
        seek,
        setShowEqualizer,
        setShowVizSettings,
        toggleDiscPlay,
      }}
      artistAvatarUrl={artistAvatarUrl}
      sourceLabel={sourceLabel}
      markArtistPhotoFailed={markArtistPhotoFailed}
    />
  );
}
