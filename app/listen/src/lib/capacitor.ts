import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Network } from "@capacitor/network";
import { StatusBar, Style } from "@capacitor/status-bar";

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // "ios" | "android" | "web"

/** Call once at app startup to configure native plugins. No-ops on web. */
export async function initCapacitor() {
  if (!isNative) return;

  // Dark status bar to match app theme
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    if (platform === "android") {
      await StatusBar.setBackgroundColor({ color: "#0a0a0f" });
    }
  } catch {
    // Silently ignore — status bar API may not be available in all contexts
  }

  // Handle back button on Android (default: close app → instead navigate back)
  App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      App.exitApp();
    }
  });

  // Log network status changes
  Network.addListener("networkStatusChange", (status) => {
    console.log("[capacitor] network:", status.connected ? "online" : "offline");
  });
}

/** Register a callback for when the app goes to background. */
export function onAppPause(callback: () => void): () => void {
  if (!isNative) return () => {};
  const handle = App.addListener("pause", callback);
  return () => { handle.then((h) => h.remove()); };
}

/** Register a callback for when the app comes back to foreground. */
export function onAppResume(callback: () => void): () => void {
  if (!isNative) return () => {};
  const handle = App.addListener("resume", callback);
  return () => { handle.then((h) => h.remove()); };
}

/** Check current network connectivity. */
export async function isOnline(): Promise<boolean> {
  if (!isNative) return navigator.onLine;
  const status = await Network.getStatus();
  return status.connected;
}
