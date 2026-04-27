import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Network } from "@capacitor/network";
import { StatusBar, Style } from "@capacitor/status-bar";

import { setAuthToken } from "@/lib/api";

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // "ios" | "android" | "web"
const OAUTH_NEXT_KEY = "crate-oauth-next";

function storePendingOAuthNext(next: string): void {
  try {
    localStorage.setItem(OAUTH_NEXT_KEY, next || "/");
  } catch {
    // Ignore storage failures; the token is still persisted separately.
  }
}

export function consumePendingOAuthNext(): string | null {
  try {
    const next = localStorage.getItem(OAUTH_NEXT_KEY);
    if (next) localStorage.removeItem(OAUTH_NEXT_KEY);
    return next;
  } catch {
    return null;
  }
}

export function getOAuthCallbackPayload(search: string | URLSearchParams): { token: string | null; next: string } {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return {
    token: params.get("token"),
    next: params.get("next") || "/",
  };
}

export function persistOAuthCallbackPayload(
  search: string | URLSearchParams,
): { handled: boolean; next: string } {
  const { token, next } = getOAuthCallbackPayload(search);
  if (!token) {
    return { handled: false, next };
  }

  setAuthToken(token);
  storePendingOAuthNext(next);
  return { handled: true, next };
}

export async function consumeOAuthCallbackUrl(url: string): Promise<{ handled: boolean; next: string }> {
  if (!url.startsWith("cratemusic://oauth/callback")) {
    return { handled: false, next: "/" };
  }

  try {
    const result = persistOAuthCallbackPayload(new URL(url).searchParams);
    if (!result.handled) {
      return result;
    }
    void import("@capacitor/browser")
      .then(({ Browser }) => Browser.close().catch(() => {}))
      .catch(() => {});

    return result;
  } catch {
    return { handled: false, next: "/" };
  }
}

/** Call once at app startup to configure native plugins. No-ops on web. */
export async function initCapacitor(): Promise<string | null> {
  if (!isNative) return null;

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
    void consumeOAuthCallbackUrl(url).then((result) => {
      if (!result.handled) return;
      window.dispatchEvent(new CustomEvent("crate:auth-token-received"));
    });
  });

  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) {
      await consumeOAuthCallbackUrl(launch.url);
    }
  } catch {
    // Ignore launch URL failures
  }

  // Network status → trigger audio resume on reconnect
  Network.addListener("networkStatusChange", (status) => {
    console.log("[capacitor] network:", status.connected ? "online" : "offline");
    if (status.connected) {
      // Notify audio engine that network is back
      window.dispatchEvent(new CustomEvent("crate:network-restored"));
    }
  });

  return null;
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
