import { getCastSenderCapabilities, startCastSession } from "@/lib/cast-sender";
import type { PlaybackTargetProvider } from "./playback-target-types";

export const googleCastTargetProvider: PlaybackTargetProvider = {
  id: "google-cast",
  label: "Cast",
  getTargets: async (context) => {
    const capabilities = await getCastSenderCapabilities();
    if (!capabilities.visible) return [];

    const hasTrack = Boolean(context?.currentTrack);
    const available = capabilities.available && hasTrack;
    return [
      {
        id: "google-cast:default",
        providerId: "google-cast",
        kind: "google-cast",
        name: capabilities.targetName || "Google Cast",
        subtitle: capabilities.activeSession
          ? "Connected Cast receiver"
          : available
            ? "Choose a Cast receiver"
            : capabilities.available
              ? "Start a track before casting"
              : capabilities.reason,
        active: capabilities.activeSession,
        available,
        unavailableReason: available
          ? undefined
          : hasTrack
            ? capabilities.reason || "Google Cast is unavailable."
            : "Start a track before casting.",
        capabilities: {
          canPlay: true,
          canSeek: true,
          canSetVolume: true,
        },
      },
    ];
  },
  selectTarget: async (target, context) => {
    const currentTrack = context?.currentTrack;
    if (!currentTrack) {
      return { ok: false, message: "Start a track before casting." };
    }
    const result = await startCastSession({
      track: currentTrack,
      currentTime: context?.currentTime,
      targetDeviceId: target.id,
    });
    if (result.ok) await context?.pause?.();
    return result;
  },
};
