import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Toaster } from "sonner";
import { App } from "./App";
import { initCapacitor, isNative } from "./lib/capacitor";
import { primeOfflineRuntimeProfile } from "./lib/offline";
import "./index.css";

// Load Poppins only on web — iOS/Android use system fonts (San
// Francisco / Roboto) for a native feel. The import is dynamic so
// the woff2 files never end up in the Capacitor bundle.
if (!isNative) {
  import("../../shared/fonts/poppins.css");
}

initCapacitor();
void primeOfflineRuntimeProfile();

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {
    // Ignore registration failures; the app still works without offline mirror.
  });
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
    <Toaster theme="dark" position="bottom-center" richColors />
  </BrowserRouter>,
);
