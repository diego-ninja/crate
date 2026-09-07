import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { AppErrorBoundary } from "@crate/ui/primitives/AppErrorBoundary";
import { captureRenderError, initSentry } from "./lib/sentry";

initSentry();

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary
    onError={captureRenderError}
    fallback={(error, onReset) => (
      <div className="flex min-h-screen items-center justify-center bg-app-surface px-6 text-foreground">
        <div className="w-full max-w-lg rounded-lg border border-white/10 bg-white/[0.04] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
            Admin crashed
          </p>
          <h1 className="mt-3 text-2xl font-semibold">
            Something went wrong while rendering.
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            This is usually caused by a stale dev chunk or a page-level runtime
            error. Reloading clears the current UI tree and asks Vite for fresh
            modules.
          </p>
          <pre className="mt-5 max-h-40 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-xs leading-5 text-white/70">
            {error.message}
          </pre>
          <button
            type="button"
            onClick={onReset}
            className="mt-5 inline-flex h-10 items-center rounded-md border border-white/12 bg-white/8 px-4 text-sm font-medium text-foreground transition-colors hover:bg-white/12"
          >
            Reload admin
          </button>
        </div>
      </div>
    )}
    onReset={() => window.location.reload()}
  >
    <App />
  </AppErrorBoundary>,
);
