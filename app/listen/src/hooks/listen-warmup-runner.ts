import type { AuthUser } from "@/contexts/auth-context";
import { api, getApiBase } from "@/lib/api";
import {
  canonicalArtworkTransportIdentity,
  preloadArtwork,
} from "@/lib/artwork-manager";
import { artworkFromUrl } from "@/lib/artwork-source";
import { cacheSet } from "@/lib/cache";

const WARMUP_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const WARMUP_CONCURRENCY = 2;
const WARMUP_STORAGE_PREFIX = "listen-warmup";

type WarmupTask = (signal: AbortSignal) => Promise<void>;
type IdleWindow = Window & {
  requestIdleCallback?: (
    cb: () => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function scheduleWarmup(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const idleWindow = window as IdleWindow;
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 4_000 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(callback, 1_500);
  return () => window.clearTimeout(handle);
}

function warmupStorageKey(user: AuthUser): string {
  const origin = getApiBase() || window.location.origin || "listen";
  return `${WARMUP_STORAGE_PREFIX}:${origin}:${user.id}`;
}

export function shouldRunWarmup(user: AuthUser): boolean {
  if (typeof window === "undefined") return false;
  if (typeof document !== "undefined" && document.visibilityState === "hidden")
    return false;
  if (
    typeof navigator !== "undefined" &&
    "onLine" in navigator &&
    !navigator.onLine
  )
    return false;
  try {
    const lastRun = Number(localStorage.getItem(warmupStorageKey(user)) || 0);
    return (
      !Number.isFinite(lastRun) || Date.now() - lastRun > WARMUP_COOLDOWN_MS
    );
  } catch {
    return true;
  }
}

export function markWarmupStarted(user: AuthUser): void {
  try {
    localStorage.setItem(warmupStorageKey(user), String(Date.now()));
  } catch {
    // ignore persistence failures
  }
}

export async function warmApiCache<T>(
  url: string,
  signal: AbortSignal,
): Promise<T | null> {
  if (signal.aborted) return null;
  try {
    const data = await api<T>(url, "GET", undefined, { signal });
    if (!signal.aborted) cacheSet(url, data);
    return data;
  } catch {
    return null;
  }
}

function warmupConcurrency(): number {
  if (typeof window === "undefined") return WARMUP_CONCURRENCY;
  const navigatorWithConnection = navigator as Navigator & {
    connection?: { saveData?: boolean };
  };
  if (navigatorWithConnection.connection?.saveData) return 1;
  if (window.matchMedia?.("(max-width: 767px)").matches) return 1;
  return WARMUP_CONCURRENCY;
}

export async function runWarmupPool(
  tasks: WarmupTask[],
  signal: AbortSignal,
): Promise<void> {
  let index = 0;
  const workerCount = Math.min(warmupConcurrency(), tasks.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!signal.aborted) {
        const task = tasks[index++];
        if (!task) return;
        // Each worker intentionally processes one warmup at a time.
        // react-doctor-disable-next-line async-await-in-loop
        await task(signal);
      }
    }),
  );
}

export function warmImage(url: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return preloadArtwork(
    artworkFromUrl(url, {
      logicalKey: `warmup:${canonicalArtworkTransportIdentity(url)}`,
    }),
    { fetchPriority: "low", signal },
  ).then(
    () => undefined,
    () => undefined,
  );
}
