import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Toaster } from "sonner";
import { App } from "./App";
import { initCapacitor, isNative } from "./lib/capacitor";
import { primeOfflineRuntimeProfile } from "./lib/offline";
import "./index.css";

async function disableDevServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
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

// Load Poppins only on web — iOS/Android use system fonts (San
// Francisco / Roboto) for a native feel. The mode guard is build-time
// constant, so Vite drops the font chunk from Capacitor bundles.
if (!isCapacitorBuild && !isNative) {
  import("../../shared/fonts/poppins.css");
}

initCapacitor();
void primeOfflineRuntimeProfile();

if (!isNative && typeof window !== "undefined" && "serviceWorker" in navigator) {
  if (import.meta.env.DEV) {
    void disableDevServiceWorker();
  } else {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Ignore registration failures; the app still works without offline mirror.
    });
  }
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
    <Toaster theme="dark" position="bottom-center" richColors />
  </BrowserRouter>,
);
