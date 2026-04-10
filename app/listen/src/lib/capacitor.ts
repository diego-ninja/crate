import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Network } from "@capacitor/network";
import { StatusBar, Style } from "@capacitor/status-bar";

export const isNative = Capacitor.isNativePlatform();

/** Call once at app startup to configure native plugins. No-ops on web. */
export async function initCapacitor(onPause?: () => void) {
  if (!isNative) return;

  // Dark status bar to match app theme
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0a0a0f" });
  } catch {
    // Android only — iOS ignores setBackgroundColor
  }

  // Pause audio when app goes to background
  if (onPause) {
    App.addListener("pause", onPause);
  }

  // Log network status changes (useful for debugging)
  Network.addListener("networkStatusChange", (status) => {
    console.log("[capacitor] network:", status.connected ? "online" : "offline");
  });
}

/** Check current network connectivity. */
export async function isOnline(): Promise<boolean> {
  if (!isNative) return navigator.onLine;
  const status = await Network.getStatus();
  return status.connected;
}
