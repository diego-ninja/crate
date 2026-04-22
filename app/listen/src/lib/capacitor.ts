import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Network } from "@capacitor/network";
import { StatusBar, Style } from "@capacitor/status-bar";

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // "ios" | "android" | "web"

/** Call once at app startup to configure native plugins. No-ops on web. */
export async function initCapacitor() {
  if (!isNative) return;

  // Dark status bar, overlays WebView content (no black gap)
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: true });
    if (platform === "android") {
      await StatusBar.setBackgroundColor({ color: "#00000000" });
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

  // OAuth deep link handler — capture token from system browser callback
  App.addListener("appUrlOpen", ({ url }) => {
    if (url.startsWith("cratemusic://oauth/callback")) {
      try {
        const params = new URL(url).searchParams;
        const token = params.get("token");
        const next = params.get("next") || "/";
        if (token) {
          import("@/lib/api").then(({ setAuthToken }) => {
            setAuthToken(token);
          });
          import("@capacitor/browser").then(({ Browser }) => {
            Browser.close().catch(() => {});
          });
          window.dispatchEvent(new CustomEvent("crate:auth-token-received", { detail: { next } }));
          window.location.href = next;
        }
      } catch {
        // Malformed URL
      }
    }
  });

  // Network status → trigger audio resume on reconnect
  Network.addListener("networkStatusChange", (status) => {
    console.log("[capacitor] network:", status.connected ? "online" : "offline");
    if (status.connected) {
      // Notify audio engine that network is back
      window.dispatchEvent(new CustomEvent("crate:network-restored"));
    }
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
