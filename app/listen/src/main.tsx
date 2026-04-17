import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Toaster } from "sonner";
import { App } from "./App";
import { initCapacitor, isNative } from "./lib/capacitor";
import "./index.css";

// Load Poppins only on web — iOS/Android use system fonts (San
// Francisco / Roboto) for a native feel. The import is dynamic so
// the woff2 files never end up in the Capacitor bundle.
if (!isNative) {
  import("../../shared/fonts/poppins.css");
}

initCapacitor();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <Toaster theme="dark" position="bottom-center" richColors />
    </BrowserRouter>
  </StrictMode>,
);
