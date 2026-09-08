import {
  fetchActiveConnectSession,
  transferPlaybackToDevice,
} from "@/lib/crate-connect";
import {
  getListenDeviceCapabilities,
  getListenDeviceId,
  getListenDeviceLabel,
} from "@/lib/listen-device";
import {
  isLegacyCrateConnectEnabled,
  isWsCrateConnectContext,
} from "./playback-target-provider-utils";
import type { PlaybackTargetProvider } from "./playback-target-types";

export const localTargetProvider: PlaybackTargetProvider = {
  id: "local",
  label: "This device",
  getTargets: (context) => {
    const capabilities = getListenDeviceCapabilities();
    const activeConnectDeviceId = context?.activeConnectDeviceId;
    const localActive = isWsCrateConnectContext(context)
      ? !context.connect.activeInstanceId ||
        context.connect.activeInstanceId === context.connect.playbackInstanceId
      : !activeConnectDeviceId || activeConnectDeviceId === getListenDeviceId();
    return [
      {
        id: "local:current",
        providerId: "local",
        kind: "local",
        name: getListenDeviceLabel(),
        subtitle: localActive
          ? "System-selected output"
          : "Available on this device",
        active: localActive,
        available: true,
        capabilities: {
          canPlay: capabilities.can_play,
          canSeek: true,
          canSetVolume: capabilities.can_set_volume,
          canShowSystemPicker: false,
        },
      },
    ];
  },
  selectTarget: async (_target, context) => {
    if (isWsCrateConnectContext(context)) {
      const { activeInstanceId, playbackInstanceId, requestTransfer } =
        context.connect;
      if (
        playbackInstanceId &&
        activeInstanceId &&
        activeInstanceId !== playbackInstanceId
      ) {
        const sent = requestTransfer(playbackInstanceId);
        return sent
          ? { ok: true, message: "Playing here." }
          : { ok: false, message: "Crate Connect is still connecting." };
      }
      return {
        ok: true,
        message: "Already playing on this device.",
      };
    }
    if (!isLegacyCrateConnectEnabled()) {
      return {
        ok: true,
        message: "Already playing on this device.",
      };
    }
    const currentDeviceId = getListenDeviceId();
    const freshSession = await fetchActiveConnectSession().catch(() => null);
    const activeDeviceId =
      freshSession?.active_device_id || context?.activeConnectDeviceId;
    if (activeDeviceId && activeDeviceId !== currentDeviceId) {
      await transferPlaybackToDevice(currentDeviceId, {
        sourceDeviceId: activeDeviceId,
        startPlaying: true,
      });
      return { ok: true, message: "Playing here." };
    }
    return {
      ok: true,
      message: "Already playing on this device.",
    };
  },
};
