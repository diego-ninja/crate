import { useCallback, useRef } from "react";
import { toast } from "sonner";
import type { Track } from "@/contexts/player-types";
import {
  preloadEqualizerPopover,
  preloadExtendedPlayer,
  preloadFullscreenPlayer,
  preloadLyricsPanel,
  preloadQueuePanel,
} from "@/components/player/lazy-player-surfaces";
import { triggerHaptic } from "@/lib/haptics";

type UsePlayerBarActionsOptions = {
  displayTrack: Track | undefined;
  isDesktop: boolean;
  isRemoteConnectActive: boolean;
  jamQueueLocked: boolean;
  showQueue: boolean;
  showLyrics: boolean;
  extendedOpen: boolean;
  setShowQueue: (open: boolean) => void;
  setShowLyrics: (open: boolean) => void;
  setShowEqualizer: (open: boolean | ((open: boolean) => boolean)) => void;
  setExtendedOpen: (open: boolean) => void;
  setShouldRenderQueuePanel: (render: boolean) => void;
  setShouldRenderLyricsPanel: (render: boolean) => void;
  setShouldRenderEqualizerPopover: (render: boolean) => void;
  setShouldRenderExtendedPlayer: (render: boolean) => void;
  setShouldRenderFullscreenPlayer: (render: boolean) => void;
  setFsOpen: (open: boolean) => void;
  likeTrack: (
    trackId?: number | null,
    trackEntityUid?: string | null,
    trackPath?: string | null,
    globalTrackUid?: string | null,
  ) => Promise<boolean>;
  unlikeTrack: (
    trackId?: number | null,
    trackEntityUid?: string | null,
    trackPath?: string | null,
    globalTrackUid?: string | null,
  ) => Promise<boolean>;
  liked: boolean;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
};

export function usePlayerBarActions({
  displayTrack,
  isDesktop,
  isRemoteConnectActive,
  jamQueueLocked,
  showQueue,
  showLyrics,
  extendedOpen,
  setShowQueue,
  setShowLyrics,
  setShowEqualizer,
  setExtendedOpen,
  setShouldRenderQueuePanel,
  setShouldRenderLyricsPanel,
  setShouldRenderEqualizerPopover,
  setShouldRenderExtendedPlayer,
  setShouldRenderFullscreenPlayer,
  setFsOpen,
  likeTrack,
  unlikeTrack,
  liked,
  toggleShuffle,
  cycleRepeat,
}: UsePlayerBarActionsOptions) {
  const coverLongPressTimerRef = useRef<number | null>(null);
  const coverLongPressTriggeredRef = useRef(false);

  const clearCoverLongPressTimer = useCallback(() => {
    if (coverLongPressTimerRef.current === null) return;
    window.clearTimeout(coverLongPressTimerRef.current);
    coverLongPressTimerRef.current = null;
  }, []);

  const prepareQueuePanel = useCallback(() => {
    setShouldRenderQueuePanel(true);
    void preloadQueuePanel();
  }, [setShouldRenderQueuePanel]);

  const prepareLyricsPanel = useCallback(() => {
    if (isRemoteConnectActive) return;
    setShouldRenderLyricsPanel(true);
    void preloadLyricsPanel();
  }, [isRemoteConnectActive, setShouldRenderLyricsPanel]);

  const prepareEqualizerPopover = useCallback(() => {
    if (isRemoteConnectActive) return;
    setShouldRenderEqualizerPopover(true);
    void preloadEqualizerPopover();
  }, [isRemoteConnectActive, setShouldRenderEqualizerPopover]);

  const prepareExtendedPlayer = useCallback(() => {
    if (isRemoteConnectActive) return;
    setShouldRenderExtendedPlayer(true);
    void preloadExtendedPlayer();
  }, [isRemoteConnectActive, setShouldRenderExtendedPlayer]);

  const prepareFullscreenPlayer = useCallback(() => {
    if (isRemoteConnectActive) return;
    void preloadFullscreenPlayer();
  }, [isRemoteConnectActive]);

  const openFullscreenPlayer = useCallback(() => {
    if (isRemoteConnectActive) return;
    triggerHaptic("medium");
    setShouldRenderFullscreenPlayer(true);
    void preloadFullscreenPlayer();
    setFsOpen(true);
  }, [isRemoteConnectActive, setFsOpen, setShouldRenderFullscreenPlayer]);

  const handleToggleShuffle = useCallback(() => {
    if (jamQueueLocked) return;
    triggerHaptic("selection");
    toggleShuffle();
  }, [jamQueueLocked, toggleShuffle]);

  const handleCycleRepeat = useCallback(() => {
    if (jamQueueLocked) return;
    triggerHaptic("selection");
    cycleRepeat();
  }, [cycleRepeat, jamQueueLocked]);

  const handleToggleQueue = useCallback(() => {
    triggerHaptic("selection");
    prepareQueuePanel();
    setShowQueue(!showQueue);
    setShowLyrics(false);
  }, [prepareQueuePanel, setShowLyrics, setShowQueue, showQueue]);

  const handleToggleLyrics = useCallback(() => {
    if (isRemoteConnectActive) return;
    triggerHaptic("selection");
    prepareLyricsPanel();
    setShowLyrics(!showLyrics);
    setShowQueue(false);
  }, [
    isRemoteConnectActive,
    prepareLyricsPanel,
    setShowLyrics,
    setShowQueue,
    showLyrics,
  ]);

  const handleToggleEqualizer = useCallback(() => {
    triggerHaptic("selection");
    prepareEqualizerPopover();
    setShowEqualizer((value) => !value);
    setShowQueue(false);
    setShowLyrics(false);
  }, [prepareEqualizerPopover, setShowEqualizer, setShowLyrics, setShowQueue]);

  const handleToggleExtendedPlayer = useCallback(() => {
    if (isRemoteConnectActive) return;
    triggerHaptic("medium");
    prepareExtendedPlayer();
    setExtendedOpen(!extendedOpen);
    if (!extendedOpen) {
      setShowQueue(false);
      setShowLyrics(false);
    }
  }, [
    extendedOpen,
    isRemoteConnectActive,
    prepareExtendedPlayer,
    setExtendedOpen,
    setShowLyrics,
    setShowQueue,
  ]);

  const toggleLike = useCallback(async (): Promise<boolean | null> => {
    if (!displayTrack) return null;
    const trackId = displayTrack.libraryTrackId ?? null;
    const trackEntityUid = displayTrack.entityUid ?? null;
    const trackPath = displayTrack.path || displayTrack.id;
    try {
      if (liked) {
        await unlikeTrack(
          trackId,
          trackEntityUid,
          trackPath,
          displayTrack.globalTrackUid ?? null,
        );
        return false;
      }
      await likeTrack(
        trackId,
        trackEntityUid,
        trackPath,
        displayTrack.globalTrackUid ?? null,
      );
      return true;
    } catch {
      return null;
    }
  }, [displayTrack, likeTrack, liked, unlikeTrack]);

  const handleCoverTouchStart = useCallback(() => {
    if (isDesktop) return;
    coverLongPressTriggeredRef.current = false;
    clearCoverLongPressTimer();
    coverLongPressTimerRef.current = window.setTimeout(() => {
      coverLongPressTriggeredRef.current = true;
      coverLongPressTimerRef.current = null;
      triggerHaptic("selection");
      void toggleLike().then((nextLiked) => {
        if (nextLiked === null) return;
        toast.success(
          nextLiked ? "Added to liked tracks" : "Removed from liked tracks",
        );
      });
    }, 520);
  }, [clearCoverLongPressTimer, isDesktop, toggleLike]);

  const handleCoverTouchMove = useCallback(() => {
    clearCoverLongPressTimer();
  }, [clearCoverLongPressTimer]);

  const handleCoverTouchEnd = useCallback(() => {
    clearCoverLongPressTimer();
  }, [clearCoverLongPressTimer]);

  const handleAddToCollection = useCallback(async () => {
    if (!displayTrack) return;
    try {
      await likeTrack(
        displayTrack.libraryTrackId ?? null,
        displayTrack.entityUid ?? null,
        displayTrack.path || displayTrack.id,
        displayTrack.globalTrackUid ?? null,
      );
      toast.success("Added to collection");
    } catch {
      // The collection action reports failures through its own UI.
    }
  }, [displayTrack, likeTrack]);

  return {
    clearCoverLongPressTimer,
    coverLongPressTriggeredRef,
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
    isCoverLongPressTriggered: () => coverLongPressTriggeredRef.current,
    openFullscreenPlayer,
    prepareEqualizerPopover,
    prepareExtendedPlayer,
    prepareFullscreenPlayer,
    prepareLyricsPanel,
    prepareQueuePanel,
    resetCoverLongPress: () => {
      coverLongPressTriggeredRef.current = false;
    },
    toggleLike,
  };
}
