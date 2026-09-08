import { useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Toaster } from "sonner";
import { App } from "./App";
import { I18nProvider } from "./i18n/I18nProvider";
import { startMediaAccessTicketRefresh } from "./lib/api";
import { initCapacitor } from "./lib/capacitor";
import { applyNativeColorMode } from "./lib/capacitor-init";
import { primeOfflineRuntimeProfile } from "./lib/offline";
import {
  isCapacitorRuntime,
  shouldRegisterServiceWorker,
  usesMobileShell,
} from "./lib/platform";
import { bootstrapNativeSessionStore } from "./lib/server-store";
import { renderSecureSessionError } from "./lib/secure-session-error";
import { syncThemeColor } from "./lib/theme-color";
import {
  getAppliedThemeSkin,
  initializeThemeSkin,
  subscribeThemeSkin,
} from "@crate/ui/lib/theme-skin";
import { initSentry } from "./lib/sentry";
import "./index.css";

async function disableDevServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map((registration) => registration.unregister()),
    );
  } catch {
    // Ignore cleanup failures; the page can still boot without dev offline support.
  }

  if (!("caches" in window)) return;

  try {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map((cacheName) =>
        cacheName.startsWith("crate-listen")
          ? caches.delete(cacheName)
          : Promise.resolve(false),
      ),
    );
  } catch {
    // Ignore cache cleanup failures; the next hard refresh can finish the reset.
  }
}

const isCapacitorBuild = import.meta.env.MODE === "capacitor";

function ThemeAwareToaster() {
  const resolvedMode = useSyncExternalStore(
    subscribeThemeSkin,
    () => getAppliedThemeSkin().resolvedMode,
    () => "dark" as const,
  );

  useEffect(() => {
    syncThemeColor(document.documentElement, resolvedMode);
    void applyNativeColorMode(resolvedMode);
  }, [resolvedMode]);

  return (
    <Toaster
      theme={resolvedMode}
      position="bottom-center"
      richColors
      mobileOffset={{
        bottom: "calc(var(--listen-mobile-bottom-chrome-height) + 0.75rem)",
      }}
    />
  );
}

if (isCapacitorRuntime) {
  void import("./lib/sentry-capacitor").then(({ initNativeSentry }) => {
    initNativeSentry();
  });
} else {
  initSentry();
}

// Load Poppins only on web — iOS/Android use system fonts (San
// Francisco / Roboto) for a native feel. The mode guard is build-time
// constant, so Vite drops the font chunk from Capacitor bundles.
if (!isCapacitorBuild && !usesMobileShell) {
  import("../../shared/fonts/poppins.css");
}

function renderApp(): void {
  createRoot(document.getElementById("root")!).render(
    <BrowserRouter>
      <I18nProvider>
        <App />
      </I18nProvider>
      <ThemeAwareToaster />
    </BrowserRouter>,
  );
}

async function bootstrap(): Promise<void> {
  try {
    await bootstrapNativeSessionStore();
  } catch {
    const root = document.getElementById("root");
    if (root) renderSecureSessionError(root);
    return;
  }

  startMediaAccessTicketRefresh();
  const appliedTheme = initializeThemeSkin();
  syncThemeColor(document.documentElement, appliedTheme.resolvedMode);
  await initCapacitor();
  void primeOfflineRuntimeProfile();

  if (
    shouldRegisterServiceWorker &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator
  ) {
    if (import.meta.env.DEV) {
      void disableDevServiceWorker();
    } else {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // Ignore registration failures; the app still works without offline mirror.
      });
    }
  }
  renderApp();
}

void bootstrap();
