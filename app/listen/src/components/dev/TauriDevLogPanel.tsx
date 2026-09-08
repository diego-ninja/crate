import { useSyncExternalStore, useState } from "react";

import {
  clearDevLogs,
  DEV_LOG_EVENT,
  getDevLogsSnapshot,
  type DevLogEntry,
} from "@/lib/dev-logs";
import { isTauriRuntime } from "@/lib/platform";

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function TauriDevLogPanel() {
  const [open, setOpen] = useState(false);
  const logs = useSyncExternalStore<DevLogEntry[]>(
    (onStoreChange) => {
      const onLog = () => onStoreChange();
      window.addEventListener(DEV_LOG_EVENT, onLog);
      return () => window.removeEventListener(DEV_LOG_EVENT, onLog);
    },
    getDevLogsSnapshot,
    () => [],
  );

  if (!isTauriRuntime || !import.meta.env.DEV) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[9999] max-w-[calc(100vw-2rem)] font-mono text-xs text-text-primary">
      {open ? (
        <div className="w-[min(46rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-accent-action/25 bg-surface-canvas/95">
          <div className="flex items-center justify-between border-b border-border-quiet px-3 py-2">
            <div>
              <div className="font-sans text-sm font-semibold text-text-primary">
                Tauri playback logs
              </div>
              <div className="text-[0.65rem] uppercase tracking-[0.18em] text-text-accent/80">
                {logs.length} events
              </div>
            </div>
            <div className="flex gap-2 font-sans">
              <button
                type="button"
                className="rounded border border-border-quiet px-2 py-1 text-text-secondary-strong hover:border-accent-action/40 hover:text-text-primary"
                onClick={clearDevLogs}
              >
                Clear
              </button>
              <button
                type="button"
                className="rounded border border-border-quiet px-2 py-1 text-text-secondary-strong hover:border-accent-action/40 hover:text-text-primary"
                onClick={() => setOpen(false)}
              >
                Hide
              </button>
            </div>
          </div>
          <div className="max-h-[42vh] overflow-auto px-3 py-2">
            {logs.length === 0 ? (
              <div className="py-6 text-center font-sans text-text-muted">
                No playback events yet.
              </div>
            ) : (
              logs
                .slice()
                .reverse()
                .map((entry) => (
                  <div
                    key={entry.id}
                    className="border-b border-text-primary/5 py-2 last:border-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-text-muted">
                        {timeLabel(entry.timestamp)}
                      </span>
                      <span className="rounded bg-accent-action/10 px-1.5 py-0.5 uppercase tracking-wide text-text-accent">
                        {entry.scope}
                      </span>
                      <span
                        className={
                          entry.level === "error"
                            ? "text-state-danger-text"
                            : entry.level === "warn"
                              ? "text-state-warning-text"
                              : "text-text-primary"
                        }
                      >
                        {entry.message}
                      </span>
                    </div>
                    {entry.detail ? (
                      <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[0.68rem] leading-relaxed text-text-secondary">
                        {entry.detail}
                      </pre>
                    ) : null}
                  </div>
                ))
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="rounded-md border border-accent-action/30 bg-surface-canvas/90 px-3 py-2 font-sans text-xs font-semibold text-text-accent hover:border-accent-action/60"
          onClick={() => setOpen(true)}
        >
          Logs {logs.length}
        </button>
      )}
    </div>
  );
}
