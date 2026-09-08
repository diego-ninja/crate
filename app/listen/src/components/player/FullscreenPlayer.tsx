import { useRef } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { getPlaySourceLabel } from "@/components/player/player-source";
import { useResolvedPlayerArtist } from "@/components/player/useResolvedPlayerArtist";
import { useFullscreenPlayerLyrics } from "@/components/player/useFullscreenPlayerLyrics";
import { shouldUseAndroidNativePlayer } from "@/lib/android-native-engine";
import { canUseWebAudioEffects } from "@/lib/mobile-audio-mode";
import { useEqualizerEnabled } from "@/hooks/use-equalizer-enabled";
import { artistPagePath } from "@/lib/library-routes";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import {
  useCrossfadeAwareProgress,
  useCrossfadeProgress,
} from "@/hooks/use-crossfade-progress";
import { useFullscreenPlayerActions } from "@/components/player/useFullscreenPlayerActions";
import { useFullscreenPlayerGestures } from "@/components/player/useFullscreenPlayerGestures";
import { useFullscreenPlayerLifecycle } from "@/components/player/useFullscreenPlayerLifecycle";
import { FullscreenPlayerView } from "@/components/player/FullscreenPlayerView";

interface FullscreenPlayerProps {
  open: boolean;
  onClose: () => void;
}

export function FullscreenPlayer({ open, onClose }: FullscreenPlayerProps) {
  const { t } = useTranslation();
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
  const {
    pause,
    resume,
    next,
    prev,
    jamQueueLocked,
    setPlaybackRate,
    toggleShuffle,
    cycleRepeat,
  } = usePlayerActions();
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
  const androidNativePlayerEnabled = shouldUseAndroidNativePlayer();
  const equalizerEnabled = useEqualizerEnabled();
  const allowMobileEqualizer =
    equalizerEnabled && (canUseWebAudioEffects || androidNativePlayerEnabled);
  const spinningDiscJogSeekMode = androidNativePlayerEnabled
    ? "commit"
    : "live";

  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const activeLyricRef = useRef<HTMLButtonElement>(null);
  const { resolvedArtist, artistAvatarUrl, markArtistPhotoFailed } =
    useResolvedPlayerArtist(currentTrack, queue);
  const sourceLabel = getPlaySourceLabel(playSource);
  const liked = currentTrack
    ? isLiked(
        currentTrack.libraryTrackId ?? null,
        currentTrack.entityUid ?? null,
        currentTrack.path || currentTrack.id,
        currentTrack.globalTrackUid ?? null,
      )
    : false;
  const jamTransportDisabled = jamQueueLocked;

  const coverRef = useRef<HTMLDivElement>(null);
  const fsRootRef = useRef<HTMLDivElement>(null);
  const equalizerRef = useRef<HTMLDivElement>(null);
  const equalizerButtonRef = useRef<HTMLButtonElement>(null);
  const {
    activePanel,
    animating,
    resetClosedUi,
    setActivePanel,
    setShowEqualizer,
    setSurfaceMode,
    showEqualizer,
    surfaceMode,
    visible,
  } = useFullscreenPlayerLifecycle({
    equalizerButtonRef,
    equalizerRef,
    onClose,
    open,
  });
  const isCdMode = surfaceMode === "cd";

  const { activeLyricIndex, lyrics } = useFullscreenPlayerLyrics({
    activeLyricRef,
    activePanel,
    currentTime,
    currentTrack: currentTrack ?? null,
    visible,
  });

  const {
    closeWithFeedback,
    cycleRepeatWithFeedback,
    goNextWithFeedback,
    goPrevWithFeedback,
    seekWithFeedback,
    toggleLikeWithFeedback,
    togglePlaybackWithFeedback,
    toggleShuffleWithFeedback,
    toggleSurfaceModeWithFeedback,
  } = useFullscreenPlayerActions({
    currentTrack,
    cycleRepeat,
    isPlaying,
    jamQueueLocked,
    next,
    onClose: resetClosedUi,
    pause,
    prev,
    resume,
    seek,
    setSurfaceMode,
    surfaceMode,
    t,
    toggleShuffle,
    toggleTrackLike,
  });
  const { draggingRef, onSwipeEnd, onSwipeMove, onSwipeStart, swipeY } =
    useFullscreenPlayerGestures({
      activePanel,
      goNextWithFeedback,
      goPrevWithFeedback,
      onClose: resetClosedUi,
    });

  function goToArtist() {
    const targetArtist = resolvedArtist;
    if (!targetArtist?.id && !targetArtist?.globalArtistUid) return;
    resetClosedUi();
    navigate(
      targetArtist.globalArtistUid
        ? artistPagePath({
            artistId: targetArtist.id,
            globalArtistUid: targetArtist.globalArtistUid,
            artistSlug: targetArtist.slug,
            artistName: targetArtist.name,
          })
        : artistPagePath({
            artistId: targetArtist.id,
            artistSlug: targetArtist.slug,
            artistName: targetArtist.name,
          }),
    );
  }

  if (!visible || !currentTrack) return null;

  const upcomingTracks = queue.slice(currentIndex + 1, currentIndex + 20);
  const remainingTime = Math.max(0, displayedDuration - displayedTime);
  const playerTabBottomClearance =
    "var(--listen-mobile-fullscreen-player-clearance)";
  const scrollTabBottomClearance =
    "var(--listen-mobile-fullscreen-scroll-clearance)";

  return (
    <FullscreenPlayerView
      t={t}
      state={{
        activePanel,
        animating,
        allowMobileEqualizer,
        isBuffering,
        isCdMode,
        isPlaying,
        jamQueueLocked,
        jamTransportDisabled,
        liked,
        repeat,
        showEqualizer: allowMobileEqualizer && showEqualizer,
        shuffle,
        surfaceMode,
        swipeY,
      }}
      player={{
        currentTrack,
        crossfadeProgress,
        crossfadeTransition,
        displayedDuration,
        displayedTime,
        duration,
        effectiveRemainingTime: remainingTime,
        resolvedArtist,
        artistAvatarUrl,
        sourceLabel,
        spinningDiscJogSeekMode,
        upcomingTracks,
      }}
      refs={{
        activeLyricRef,
        coverRef,
        equalizerButtonRef,
        equalizerRef,
        fsRootRef,
        lyricsContainerRef,
      }}
      actions={{
        closeWithFeedback,
        cycleRepeatWithFeedback,
        goNextWithFeedback,
        goPrevWithFeedback,
        goToArtist,
        jumpTo: (index) => jumpTo(currentIndex + 1 + index),
        onClose: resetClosedUi,
        onSwipeEnd,
        onSwipeMove,
        onSwipeStart,
        seek,
        seekWithFeedback,
        setDragging: (dragging) => {
          draggingRef.current = dragging;
        },
        setShowEqualizer,
        setPlaybackRate,
        equalizerButtonRef,
        toggleLikeWithFeedback,
        togglePlaybackWithFeedback,
        toggleShuffleWithFeedback,
        toggleSurfaceModeWithFeedback,
      }}
      lyrics={lyrics}
      activeLyricIndex={activeLyricIndex}
      playerTabBottomClearance={playerTabBottomClearance}
      scrollTabBottomClearance={scrollTabBottomClearance}
      onSelectPanel={setActivePanel}
      setShowEqualizer={setShowEqualizer}
      markArtistPhotoFailed={markArtistPhotoFailed}
    />
  );
}
