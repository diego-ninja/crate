import { App } from "@capacitor/app";
import { Network } from "@capacitor/network";
import { StatusBar, Style } from "@capacitor/status-bar";

import { consumeOAuthCallbackUrl } from "@/lib/capacitor-oauth";
import { isNative, platform } from "@/lib/capacitor-runtime";

export async function initCapacitor(): Promise<string | null> {
  if (!isNative) return null;

  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: true });
    if (platform === "android") {
      await StatusBar.setBackgroundColor({ color: "#00000000" });
    }
  } catch {
    // Silently ignore — status bar API may not be available in all contexts
  }

  App.addListener("backButton", ({ canGoBack }) => {
    const nativeBackEvent = new CustomEvent("crate:native-back", { cancelable: true });
    window.dispatchEvent(nativeBackEvent);
    if (nativeBackEvent.defaultPrevented) return;

    if (canGoBack) {
      window.history.back();
    } else {
      App.exitApp();
    }
  });

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

  Network.addListener("networkStatusChange", (status) => {
    console.log("[capacitor] network:", status.connected ? "online" : "offline");
    if (status.connected) {
      window.dispatchEvent(new CustomEvent("crate:network-restored"));
    }
  });

  return null;
}
