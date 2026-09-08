import { useCallback } from "react";
import type { TFunction } from "i18next";
import type { Track } from "@/contexts/PlayerContext";
import type { PlayerSurfaceMode } from "@/lib/player-visualizer-prefs";
import { setPlayerSurfaceModePreference } from "@/lib/player-visualizer-prefs";
import { toast } from "sonner";
import { triggerHaptic } from "@/lib/haptics";

type LikeTrack = (
  trackId?: number | null,
  trackEntityUid?: string | null,
  trackPath?: string | null,
  globalTrackUid?: string | null,
) => Promise<boolean>;

type UseFullscreenPlayerActionsOptions = {
  currentTrack: Track | undefined;
  isPlaying: boolean;
  jamQueueLocked: boolean;
  surfaceMode: PlayerSurfaceMode;
  setSurfaceMode: (mode: PlayerSurfaceMode) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  toggleTrackLike: LikeTrack;
  t: TFunction;
  onClose: () => void;
};

export function useFullscreenPlayerActions({
  currentTrack,
  isPlaying,
  jamQueueLocked,
  surfaceMode,
  setSurfaceMode,
  pause,
  resume,
  next,
  prev,
  seek,
  toggleShuffle,
  cycleRepeat,
  toggleTrackLike,
  t,
  onClose,
}: UseFullscreenPlayerActionsOptions) {
  const closeWithFeedback = useCallback(() => {
    triggerHaptic("selection");
    onClose();
  }, [onClose]);

  const togglePlaybackWithFeedback = useCallback(() => {
    triggerHaptic("light");
    if (jamQueueLocked) return;
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  }, [isPlaying, jamQueueLocked, pause, resume]);

  const toggleLikeWithFeedback = useCallback(async () => {
    if (!currentTrack) return;
    triggerHaptic("selection");
    try {
      const nextLiked = await toggleTrackLike(
        currentTrack.libraryTrackId ?? null,
        currentTrack.entityUid ?? null,
        currentTrack.path || currentTrack.id,
        currentTrack.globalTrackUid ?? null,
      );
      toast.success(
        nextLiked
          ? t("actions.track.toasts.liked")
          : t("actions.track.toasts.unliked"),
      );
    } catch {
      toast.error(t("player.toasts.updateLikedTracksFailed"));
    }
  }, [currentTrack, t, toggleTrackLike]);

  const goNextWithFeedback = useCallback(() => {
    triggerHaptic("selection");
    if (jamQueueLocked) return;
    next();
  }, [jamQueueLocked, next]);

  const goPrevWithFeedback = useCallback(() => {
    triggerHaptic("selection");
    if (jamQueueLocked) return;
    prev();
  }, [jamQueueLocked, prev]);

  const seekWithFeedback = useCallback(
    (time: number) => {
      if (jamQueueLocked) return;
      seek(time);
    },
    [jamQueueLocked, seek],
  );

  const toggleShuffleWithFeedback = useCallback(() => {
    if (jamQueueLocked) return;
    triggerHaptic("selection");
    toggleShuffle();
  }, [jamQueueLocked, toggleShuffle]);

  const cycleRepeatWithFeedback = useCallback(() => {
    if (jamQueueLocked) return;
    triggerHaptic("selection");
    cycleRepeat();
  }, [cycleRepeat, jamQueueLocked]);

  const toggleSurfaceModeWithFeedback = useCallback(() => {
    triggerHaptic("selection");
    const nextMode = surfaceMode === "cd" ? "cover" : "cd";
    setSurfaceMode(nextMode);
    setPlayerSurfaceModePreference(nextMode);
  }, [setSurfaceMode, surfaceMode]);

  return {
    closeWithFeedback,
    cycleRepeatWithFeedback,
    goNextWithFeedback,
    goPrevWithFeedback,
    seekWithFeedback,
    toggleLikeWithFeedback,
    togglePlaybackWithFeedback,
    toggleShuffleWithFeedback,
    toggleSurfaceModeWithFeedback,
  };
}
