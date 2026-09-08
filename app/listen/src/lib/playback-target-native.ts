import {
  getNativeCurrentOutputRoute,
  getNativeOutputCapabilities,
  isNativeOutputRoutingAvailable,
  showNativeOutputPicker,
} from "@/lib/native-output-router";
import type {
  PlaybackTargetKind,
  PlaybackTargetProvider,
} from "./playback-target-types";

function nativeOutputTargetKind(
  platform: string,
  routeType?: string,
): PlaybackTargetKind {
  if (platform === "ios" && routeType === "airplay") return "airplay";
  return "system-route";
}

function nativeOutputSubtitle(platform: string, routeType?: string): string {
  if (platform === "ios") {
    return routeType === "airplay"
      ? "Open AirPlay route picker"
      : "Open AirPlay and Bluetooth route picker";
  }
  return "Open Android output switcher";
}

export const nativeOutputRouteProvider: PlaybackTargetProvider = {
  id: "native-output",
  label: "System routes",
  getTargets: async () => {
    if (!isNativeOutputRoutingAvailable()) return [];
    const [capabilities, route] = await Promise.all([
      getNativeOutputCapabilities(),
      getNativeCurrentOutputRoute(),
    ]);
    const available =
      capabilities.canShowSystemOutputSwitcher ||
      capabilities.canPresentRoutePicker;
    const platform = capabilities.platform;
    const routeType = route?.type;
    return [
      {
        id: "native-output:system",
        providerId: "native-output",
        kind: nativeOutputTargetKind(platform, routeType),
        name:
          route?.name ||
          (platform === "ios" ? "AirPlay and Bluetooth" : "System output"),
        subtitle: nativeOutputSubtitle(platform, routeType),
        active: false,
        available,
        unavailableReason: available
          ? undefined
          : platform === "android"
            ? "Android output switcher requires Android 14 or newer."
            : "System route picker is unavailable on this device.",
        capabilities: {
          canPlay: true,
          canSeek: false,
          canSetVolume: false,
          canShowSystemPicker: available,
        },
      },
    ];
  },
  selectTarget: async () => {
    const result = await showNativeOutputPicker();
    return {
      ok: result.shown !== false,
      message: result.reason,
    };
  },
};
