export type DevLogLevel = "debug" | "info" | "warn" | "error";

export interface DevLogEntry {
  id: number;
  timestamp: number;
  level: DevLogLevel;
  scope: string;
  message: string;
  detail?: string;
}

export const DEV_LOG_EVENT = "crate:dev-log";
const DEV_LOG_STORAGE_KEY = "crate-dev-logs";
const DEV_LOG_FORCE_KEY = "crate-dev-logs-enabled";
const MAX_LOGS = 200;

function devLogsEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return window.localStorage.getItem(DEV_LOG_FORCE_KEY) === "true";
  } catch {
    return false;
  }
}

function readLogs(): DevLogEntry[] {
  if (typeof window === "undefined") return [];
  if (window.__crateDevLogs) return window.__crateDevLogs;
  try {
    const raw = window.localStorage.getItem(DEV_LOG_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    window.__crateDevLogs = Array.isArray(parsed) ? parsed : [];
    return window.__crateDevLogs;
  } catch {
    window.__crateDevLogs = [];
    return window.__crateDevLogs;
  }
}

function persistLogs(logs: DevLogEntry[]): void {
  try {
    window.localStorage.setItem(DEV_LOG_STORAGE_KEY, JSON.stringify(logs));
  } catch {
    // ignore storage limits in constrained shells
  }
}

function dispatchRecordedLogEvent(entry: DevLogEntry): void {
  const dispatch = () => {
    window.dispatchEvent(
      new CustomEvent<DevLogEntry>(DEV_LOG_EVENT, { detail: entry }),
    );
  };

  if (typeof window.queueMicrotask === "function") {
    window.queueMicrotask(dispatch);
    return;
  }

  window.setTimeout(dispatch, 0);
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.searchParams.has("token")) {
      url.searchParams.set("token", "redacted");
    }
    return url.toString();
  } catch {
    return value.replace(/([?&]token=)[^&]+/g, "$1redacted");
  }
}

export function recordDevLog(
  scope: string,
  message: string,
  detail?: unknown,
  level: DevLogLevel = "info",
): void {
  if (typeof window === "undefined") return;
  if (!devLogsEnabled()) return;
  const logs = readLogs();
  const entry: DevLogEntry = {
    id: Date.now() + Math.random(),
    timestamp: Date.now(),
    level,
    scope,
    message,
    detail:
      typeof detail === "string"
        ? detail
        : detail == null
          ? undefined
          : JSON.stringify(detail),
  };
  const next = [...logs, entry].slice(-MAX_LOGS);
  window.__crateDevLogs = next;
  persistLogs(next);
  dispatchRecordedLogEvent(entry);

  const consoleMethod =
    level === "debug"
      ? "debug"
      : level === "warn"
        ? "warn"
        : level === "error"
          ? "error"
          : "info";
  console[consoleMethod](`[${scope}] ${message}`, entry.detail ?? "");
}

export function getDevLogs(): DevLogEntry[] {
  return [...readLogs()];
}

export function getDevLogsSnapshot(): DevLogEntry[] {
  return readLogs();
}

export function clearDevLogs(): void {
  if (typeof window === "undefined") return;
  window.__crateDevLogs = [];
  persistLogs([]);
  window.dispatchEvent(new CustomEvent(DEV_LOG_EVENT));
}

declare global {
  interface Window {
    __crateDevLogs?: DevLogEntry[];
    __crateDevLog?: typeof recordDevLog;
  }
}

if (typeof window !== "undefined") {
  window.__crateDevLog = recordDevLog;
}
