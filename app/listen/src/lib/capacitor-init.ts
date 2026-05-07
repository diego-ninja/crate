import { App } from "@capacitor/app";
import { Keyboard, KeyboardResize, KeyboardStyle } from "@capacitor/keyboard";
import { Network } from "@capacitor/network";
import { StatusBar, Style } from "@capacitor/status-bar";

import { consumeOAuthCallbackUrl } from "@/lib/capacitor-oauth";
import { isIosRuntime, isNative, platform } from "@/lib/capacitor-runtime";

let viewportFallbackInitialized = false;
let keyboardInitialized = false;

function setViewportHeightVar() {
  if (typeof window === "undefined") return;
  document.documentElement.style.setProperty("--listen-viewport-height", `${window.innerHeight}px`);
}

function initViewportHeightFallback() {
  if (viewportFallbackInitialized || !isIosRuntime || typeof window === "undefined") return;
  viewportFallbackInitialized = true;
  setViewportHeightVar();
  window.addEventListener("resize", setViewportHeightVar, { passive: true });
  window.addEventListener("orientationchange", () => {
    requestAnimationFrame(setViewportHeightVar);
  }, { passive: true });
}

function setKeyboardHeight(height: number) {
  document.documentElement.style.setProperty("--listen-keyboard-height", `${Math.max(0, height)}px`);
  document.documentElement.toggleAttribute("data-keyboard-open", height > 0);
  window.dispatchEvent(new CustomEvent("crate:keyboard-change", { detail: { height } }));
}

function scrollFocusedInputIntoView() {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return;
  if (!activeElement.matches("input, textarea, select, [contenteditable='true']")) return;
  activeElement.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
}

async function initKeyboardHandling() {
  if (keyboardInitialized || platform !== "ios") return;
  keyboardInitialized = true;

  try {
    await Keyboard.setStyle({ style: KeyboardStyle.Dark });
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
    await Keyboard.setAccessoryBarVisible({ isVisible: false });
    await Keyboard.setScroll({ isDisabled: false });
  } catch {
    // Keyboard APIs are iOS-only and best-effort across Capacitor shells.
  }

  void Keyboard.addListener("keyboardWillShow", ({ keyboardHeight }) => {
    setKeyboardHeight(keyboardHeight);
    requestAnimationFrame(scrollFocusedInputIntoView);
  });
  void Keyboard.addListener("keyboardWillHide", () => {
    setKeyboardHeight(0);
    requestAnimationFrame(setViewportHeightVar);
  });
}

export async function initCapacitor(): Promise<string | null> {
  initViewportHeightFallback();
  if (!isNative) return null;
  await initKeyboardHandling();

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

  App.addListener("pause", () => {
    window.dispatchEvent(new CustomEvent("crate:app-paused"));
  });

  App.addListener("resume", () => {
    window.dispatchEvent(new CustomEvent("crate:app-resumed"));
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
