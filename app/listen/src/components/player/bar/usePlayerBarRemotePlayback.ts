import { useCallback } from "react";
import type { PlayerActionsValue } from "@/contexts/player-context";
import { sendConnectCommand } from "@/lib/crate-connect";
import { triggerHaptic } from "@/lib/haptics";
import { toast } from "sonner";
import { usePlayerBarRemoteConnection } from "@/components/player/bar/usePlayerBarRemoteConnection";

type RemoteTransportCommand =
  | "pause"
  | "resume"
  | "seek"
  | "next"
  | "previous"
  | "set_volume";

type UsePlayerBarRemotePlaybackOptions = {
  isPlaying: boolean;
  displayedTime: number;
  displayedDuration: number;
  volume: number;
  jamQueueLocked: boolean;
  actions: Pick<
    PlayerActionsValue,
    "pause" | "resume" | "next" | "prev" | "seek" | "setVolume" | "connect"
  >;
};

export function usePlayerBarRemotePlayback({
  isPlaying,
  displayedTime,
  displayedDuration,
  volume,
  jamQueueLocked,
  actions,
}: UsePlayerBarRemotePlaybackOptions) {
  const { pause, resume, next, prev, seek, setVolume, connect } = actions;
  const connection = usePlayerBarRemoteConnection({
    isPlaying,
    displayedTime,
    displayedDuration,
    volume,
    connect,
  });
  const {
    activeConnectDeviceId,
    activeConnectSession,
    remoteConnectDeviceLabel,
    isRemoteConnectActive,
    v2RemoteConnectActive,
    effectiveIsPlaying,
    effectiveDisplayedDuration,
    runRefreshConnectSession,
    setOptimisticRemoteTime,
    setOptimisticRemoteVolume,
    updateActiveConnectStatus,
  } = connection;

  const sendRemoteTransportCommand = useCallback(
    async (type: RemoteTransportCommand, payload?: Record<string, unknown>) => {
      if (v2RemoteConnectActive) {
        const wsType =
          type === "next"
            ? "next_track"
            : type === "previous"
              ? "previous_track"
              : type === "set_volume"
                ? "volume"
                : type;
        const ok = connect.sendRemoteCommand(wsType, payload);
        if (!ok) {
          toast.error(
            remoteConnectDeviceLabel
              ? `Could not control ${remoteConnectDeviceLabel}`
              : "Could not control remote device",
          );
        }
        return ok;
      }
      if (!isRemoteConnectActive || !activeConnectDeviceId) return false;
      try {
        await sendConnectCommand({
          type,
          targetDeviceId: activeConnectDeviceId,
          playbackSessionId: activeConnectSession?.playback_session_id,
          payload,
        });
        if (type === "pause" || type === "resume") {
          updateActiveConnectStatus(type === "pause" ? "paused" : "playing");
        }
        window.setTimeout(runRefreshConnectSession, 600);
      } catch {
        toast.error(
          remoteConnectDeviceLabel
            ? `Could not control ${remoteConnectDeviceLabel}`
            : "Could not control remote device",
        );
        return false;
      }
      return true;
    },
    [
      activeConnectDeviceId,
      activeConnectSession?.playback_session_id,
      connect,
      isRemoteConnectActive,
      remoteConnectDeviceLabel,
      runRefreshConnectSession,
      updateActiveConnectStatus,
      v2RemoteConnectActive,
    ],
  );

  const handlePlayPause = useCallback(() => {
    triggerHaptic("light");
    if (jamQueueLocked) return;
    if (isRemoteConnectActive) {
      void sendRemoteTransportCommand(effectiveIsPlaying ? "pause" : "resume");
      return;
    }
    if (isPlaying) pause();
    else resume();
  }, [
    effectiveIsPlaying,
    isPlaying,
    jamQueueLocked,
    isRemoteConnectActive,
    pause,
    resume,
    sendRemoteTransportCommand,
  ]);

  const handlePreviousTrack = useCallback(() => {
    triggerHaptic("selection");
    if (jamQueueLocked) return;
    if (isRemoteConnectActive) {
      void sendRemoteTransportCommand("previous");
      return;
    }
    prev();
  }, [isRemoteConnectActive, jamQueueLocked, prev, sendRemoteTransportCommand]);

  const handleNextTrack = useCallback(() => {
    triggerHaptic("selection");
    if (jamQueueLocked) return;
    if (isRemoteConnectActive) {
      void sendRemoteTransportCommand("next");
      return;
    }
    next();
  }, [isRemoteConnectActive, jamQueueLocked, next, sendRemoteTransportCommand]);

  const handleSeek = useCallback(
    (time: number) => {
      if (jamQueueLocked) return;
      if (isRemoteConnectActive) {
        const nextTime =
          effectiveDisplayedDuration > 0
            ? Math.max(0, Math.min(time, effectiveDisplayedDuration))
            : Math.max(0, time);
        setOptimisticRemoteTime(nextTime);
        void sendRemoteTransportCommand("seek", {
          position_ms: Math.round(nextTime * 1000),
        }).then((ok) => {
          if (!ok) setOptimisticRemoteTime(null);
        });
        return;
      }
      seek(time);
    },
    [
      effectiveDisplayedDuration,
      jamQueueLocked,
      isRemoteConnectActive,
      seek,
      sendRemoteTransportCommand,
      setOptimisticRemoteTime,
    ],
  );

  const handleVolumeChange = useCallback(
    (nextVolume: number) => {
      if (isRemoteConnectActive) {
        const normalizedVolume = Math.max(0, Math.min(1, nextVolume));
        setOptimisticRemoteVolume(normalizedVolume);
        void sendRemoteTransportCommand("set_volume", {
          volume: normalizedVolume,
        }).then((ok) => {
          if (!ok) setOptimisticRemoteVolume(null);
        });
        return;
      }
      setVolume(nextVolume);
    },
    [
      isRemoteConnectActive,
      sendRemoteTransportCommand,
      setOptimisticRemoteVolume,
      setVolume,
    ],
  );

  return {
    ...connection,
    handlePlayPause,
    handlePreviousTrack,
    handleNextTrack,
    handleSeek,
    handleVolumeChange,
  };
}
