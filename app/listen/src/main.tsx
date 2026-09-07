import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Toaster } from "sonner";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { startMediaAccessTicketRefresh } from "./lib/api";
import { initCapacitor } from "./lib/capacitor";
import { primeOfflineRuntimeProfile } from "./lib/offline";
import {
  isCapacitorRuntime,
  shouldRegisterServiceWorker,
  usesMobileShell,
} from "./lib/platform";
import { bootstrapNativeSessionStore } from "./lib/server-store";
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
      cacheNames
        .filter((cacheName) => cacheName.startsWith("crate-listen"))
        .map((cacheName) => caches.delete(cacheName)),
    );
  } catch {
    // Ignore cache cleanup failures; the next hard refresh can finish the reset.
  }
}

const isCapacitorBuild = import.meta.env.MODE === "capacitor";

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
      <Toaster
        theme="dark"
        position="bottom-center"
        richColors
        mobileOffset={{
          bottom: "calc(var(--listen-mobile-bottom-chrome-height) + 0.75rem)",
        }}
      />
    </BrowserRouter>,
  );
}

function renderSecureSessionError(): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#08090d;color:#f4f6fb;font-family:system-ui,sans-serif">
      <section style="max-width:420px;text-align:center">
        <h1 style="font-size:1.25rem;margin:0 0 12px">Unable to unlock this session</h1>
        <p style="color:#98a2b8;margin:0 0 20px">Crate could not access the device secure storage. Restart the app and try again.</p>
        <button type="button" onclick="window.location.reload()" style="border:0;border-radius:999px;padding:10px 18px;background:#13bde2;color:#061017;font-weight:700">Retry</button>
      </section>
    </main>`;
}

async function bootstrap(): Promise<void> {
  try {
    await bootstrapNativeSessionStore();
  } catch {
    renderSecureSessionError();
    return;
  }

  startMediaAccessTicketRefresh();
  initCapacitor();
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
