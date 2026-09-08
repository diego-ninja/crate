import { useState } from "react";

import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { getTrackCacheKey } from "@/contexts/player-utils";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";
import { useEqualizerEnabled } from "@/hooks/use-equalizer-enabled";
import {
  useCrossfadeAwareProgress,
  useCrossfadeProgress,
} from "@/hooks/use-crossfade-progress";
import { canUseWebAudioEffects } from "@/lib/mobile-audio-mode";
import { shouldUseAndroidNativePlayer } from "@/lib/android-native-engine";
import {
  getPlaybackDeliveryPolicyPreference,
  PLAYER_PLAYBACK_PREFS_EVENT,
  type PlaybackDeliveryPreference,
} from "@/lib/player-playback-prefs";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import { usePlayerBarActions } from "./bar/usePlayerBarActions";
import { usePlayerBarComputedState } from "./bar/usePlayerBarComputedState";
import { usePlayerBarDisplayState } from "./bar/usePlayerBarDisplayState";
import {
  usePlayerBarLongPressEffect,
  usePlayerBarPlaybackPreferenceEffect,
} from "./bar/usePlayerBarLifecycle";
import { usePlayerBarGestures } from "./bar/usePlayerBarGestures";
import { usePlayerBarRemotePlayback } from "./bar/usePlayerBarRemotePlayback";
import { usePlayerBarSurfaceState } from "./bar/use-player-bar-surface-state";

const SHOW_PLAYER_BAR_ANALYZER = true;

export function usePlayerBarController() {
  const {
    currentTime,
    duration,
    isPlaying,
    isBuffering,
    volume,
    analyserVersion,
    crossfadeTransition,
  } = usePlayer();
  const {
    currentTrack,
    jamQueueLocked,
    shuffle,
    repeat,
    playSource,
    queue,
    currentIndex,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
    publishConnectState,
    connect,
    toggleShuffle,
    cycleRepeat,
  } = usePlayerActions();
  const isDesktop = useIsDesktop();
  const equalizerEnabled = useEqualizerEnabled();
  const equalizerRuntimeAvailable =
    canUseWebAudioEffects || shouldUseAndroidNativePlayer();
  const allowEqualizer = equalizerEnabled && equalizerRuntimeAvailable;
  const showPlayerBarAnalyzer =
    SHOW_PLAYER_BAR_ANALYZER && isDesktop && equalizerRuntimeAvailable;

  const crossfadeProgress = useCrossfadeProgress(crossfadeTransition);
  const { displayedTime, displayedDuration } = useCrossfadeAwareProgress(
    crossfadeTransition,
    currentTime,
    duration,
  );

  const {
    legacyConnectEnabled,
    activeConnectDeviceId,
    activeConnectSession,
    remoteConnectState,
    isRemoteConnectActive,
    effectiveIsPlaying,
    effectiveDisplayedTime,
    effectiveDisplayedDuration,
    effectiveVolume,
    handlePlayPause,
    handlePreviousTrack,
    handleNextTrack,
    handleSeek,
    handleVolumeChange,
  } = usePlayerBarRemotePlayback({
    isPlaying,
    displayedTime,
    displayedDuration,
    volume,
    jamQueueLocked,
    actions: {
      pause,
      resume,
      next,
      prev,
      seek,
      setVolume,
      connect,
    },
  });

  const { frequenciesDb, sampleRate } = useAudioVisualizer(
    showPlayerBarAnalyzer && isPlaying && !isRemoteConnectActive,
    `${
      currentTrack ? getTrackCacheKey(currentTrack) : "none"
    }:${analyserVersion}`,
  );

  const [seekHover, setSeekHover] = useState<{
    pct: number;
    time: string;
  } | null>(null);
  const [playbackDeliveryPolicy, setPlaybackDeliveryPolicy] =
    useState<PlaybackDeliveryPreference>(getPlaybackDeliveryPolicyPreference);
  const { isLiked, likeTrack, unlikeTrack } = useLikedTracks();
  usePlayerBarPlaybackPreferenceEffect({
    eventName: PLAYER_PLAYBACK_PREFS_EVENT,
    getPreference: getPlaybackDeliveryPolicyPreference,
    setPlaybackDeliveryPolicy,
  });

  const { handleTouchEnd, handleTouchStart } = usePlayerBarGestures({
    onNextTrack: handleNextTrack,
    onPreviousTrack: handlePreviousTrack,
  });

  const {
    displayTrack,
    displayQueue,
    displayCurrentIndex,
    displayPlaySource,
    qualityBadge,
    showsDeliveryQuality,
    shapedRadioSessionId,
    isShapedRadioTrack,
    sourceLabel,
  } = usePlayerBarDisplayState({
    currentTrack,
    queue,
    currentIndex,
    playSource,
    remoteConnectState,
    isRemoteConnectActive,
    legacyConnectEnabled,
    playbackDeliveryPolicy,
  });
  const surface = usePlayerBarSurfaceState({
    allowEqualizer,
    currentTrackAvailable: !!currentTrack,
    displayTrackAvailable: !!displayTrack,
    isDesktop,
    isRemoteConnectActive,
  });
  const {
    displayCrossfadeTransition,
    effectiveIsBuffering,
    hidePlayerBarForMobileFullscreen,
    liked,
    playbackTargetContext,
    progressPct,
  } = usePlayerBarComputedState({
    activeConnectDeviceId,
    activeConnectSession,
    connect,
    crossfadeTransition,
    displayCurrentIndex,
    displayQueue,
    displayTrack,
    effectiveDisplayedDuration,
    effectiveDisplayedTime,
    effectiveVolume,
    fsOpen: surface.fsOpen,
    isDesktop,
    isLiked,
    isBuffering,
    isRemoteConnectActive,
    legacyConnectEnabled,
    pause,
    publishConnectState,
  });

  const {
    clearCoverLongPressTimer,
    handleAddToCollection,
    handleCoverTouchEnd,
    handleCoverTouchMove,
    handleCoverTouchStart,
    handleCycleRepeat,
    handleToggleEqualizer,
    handleToggleExtendedPlayer,
    handleToggleLyrics,
    handleToggleQueue,
    handleToggleShuffle,
    isCoverLongPressTriggered,
    openFullscreenPlayer,
    prepareEqualizerPopover,
    prepareExtendedPlayer,
    prepareFullscreenPlayer,
    prepareLyricsPanel,
    prepareQueuePanel,
    resetCoverLongPress,
    toggleLike,
  } = usePlayerBarActions({
    displayTrack,
    isDesktop,
    isRemoteConnectActive,
    jamQueueLocked,
    showQueue: surface.showQueue,
    showLyrics: surface.showLyrics,
    extendedOpen: surface.extendedOpen,
    setShowQueue: surface.setShowQueue,
    setShowLyrics: surface.setShowLyrics,
    setShowEqualizer: surface.setShowEqualizer,
    setExtendedOpen: surface.setExtendedOpen,
    setShouldRenderQueuePanel: surface.setShouldRenderQueuePanel,
    setShouldRenderLyricsPanel: surface.setShouldRenderLyricsPanel,
    setShouldRenderEqualizerPopover: surface.setShouldRenderEqualizerPopover,
    setShouldRenderExtendedPlayer: surface.setShouldRenderExtendedPlayer,
    setShouldRenderFullscreenPlayer: surface.setShouldRenderFullscreenPlayer,
    setFsOpen: surface.setFsOpen,
    likeTrack,
    unlikeTrack,
    liked,
    toggleShuffle,
    cycleRepeat,
  });

  usePlayerBarLongPressEffect(clearCoverLongPressTimer);

  return {
    isDesktop,
    liked,
    isShapedRadioTrack,
    effectiveIsPlaying,
    effectiveIsBuffering,
    isPlaying,
    shuffle,
    jamQueueLocked,
    jamTransportDisabled: jamQueueLocked,
    showPlayerBarAnalyzer,
    isRemoteConnectActive,
    extendedOpen: surface.extendedOpen,
    allowEqualizer,
    showEqualizer: surface.showEqualizer,
    showQueue: surface.showQueue,
    showLyrics: surface.showLyrics,
    hidePlayerBarForMobileFullscreen,
    hasFloatingOverlayOpen: surface.hasFloatingOverlayOpen,
    fsOpen: surface.fsOpen,
    shouldRenderQueuePanel: surface.shouldRenderQueuePanel,
    shouldRenderLyricsPanel: surface.shouldRenderLyricsPanel,
    shouldRenderEqualizerPopover: surface.shouldRenderEqualizerPopover,
    shouldRenderExtendedPlayer: surface.shouldRenderExtendedPlayer,
    shouldRenderFullscreenPlayer: surface.shouldRenderFullscreenPlayer,
    displayTrack,
    displayCrossfadeTransition,
    crossfadeProgress,
    displayPlaySource,
    sourceLabel,
    shapedRadioSessionId,
    effectiveDisplayedDuration,
    duration,
    onPrepareFullscreen: prepareFullscreenPlayer,
    onOpenFullscreen: openFullscreenPlayer,
    onCoverTouchStart: handleCoverTouchStart,
    onCoverTouchMove: handleCoverTouchMove,
    onCoverTouchEnd: handleCoverTouchEnd,
    isCoverLongPressTriggered,
    resetCoverLongPress,
    onToggleLike: () => void toggleLike(),
    onNextTrack: handleNextTrack,
    onAddToCollection: handleAddToCollection,
    onOverlayChange: surface.setHasFloatingOverlayOpen,
    handleTouchStart,
    handleTouchEnd,
    effectiveDisplayedTime,
    repeat,
    frequenciesDb,
    sampleRate,
    progressPct,
    seekHover,
    onSeekHoverChange: setSeekHover,
    onToggleShuffle: handleToggleShuffle,
    onPreviousTrack: handlePreviousTrack,
    onPlayPause: handlePlayPause,
    onCycleRepeat: handleCycleRepeat,
    onSeek: handleSeek,
    qualityBadge,
    showsDeliveryQuality,
    effectiveVolume,
    onVolumeChange: handleVolumeChange,
    playbackTargetContext,
    displayQueue,
    displayCurrentIndex,
    onToggleEqualizer: handleToggleEqualizer,
    onPrepareEqualizer: prepareEqualizerPopover,
    onToggleQueue: handleToggleQueue,
    onPrepareQueue: prepareQueuePanel,
    onToggleLyrics: handleToggleLyrics,
    onPrepareLyrics: prepareLyricsPanel,
    onToggleExtendedPlayer: handleToggleExtendedPlayer,
    onPrepareExtendedPlayer: prepareExtendedPlayer,
    onCloseQueue: surface.closeQueue,
    onCloseLyrics: surface.closeLyrics,
    onCloseEqualizer: surface.closeEqualizer,
    onCloseExtendedPlayer: surface.closeExtendedPlayer,
    onCloseFullscreenPlayer: surface.closeFullscreenPlayer,
  };
}
