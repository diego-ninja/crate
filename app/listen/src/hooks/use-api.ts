import {
  startTransition,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";

import { api } from "@/lib/api";
import { catalogWarmingRetryDelayMs } from "../../../shared/web/use-api";
import {
  cacheGet,
  cacheSet,
  onCacheInvalidation,
  onCacheReconnect,
  scopesForUrl,
} from "@/lib/cache";

export interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  status?: number | null;
  refetch: () => void;
}

type HttpError = Error & { status?: number };

const TRANSIENT_READ_RETRY_DELAYS_MS = [250, 750] as const;

function transientReadRetryDelayMs(
  error: unknown,
  attempt: number,
): number | null {
  const status = (error as HttpError)?.status;
  if (![502, 503, 504].includes(status ?? 0)) return null;
  return TRANSIENT_READ_RETRY_DELAYS_MS[attempt] ?? null;
}

interface UseApiOptions {
  reactive?: boolean;
  revalidateOnReconnect?: boolean;
  safetyNetMs?: number;
  revalidateIfCached?: "immediate" | "idle" | "never";
  idleRevalidateMs?: number;
}

type IdleWindow = Window & {
  requestIdleCallback?: (
    cb: () => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function scheduleIdleRevalidate(
  callback: () => void,
  timeoutMs: number,
): () => void {
  if (typeof window === "undefined") return () => {};
  const idleWindow = window as IdleWindow;
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, {
      timeout: timeoutMs,
    });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(callback, Math.min(timeoutMs, 2_000));
  return () => window.clearTimeout(handle);
}

function scheduleTimeout(callback: () => void, timeoutMs: number): () => void {
  const handle = window.setTimeout(callback, timeoutMs);
  return () => window.clearTimeout(handle);
}

/**
 * SWR-enabled API hook.
 * - Returns cached data immediately (no skeleton flash)
 * - Fetches fresh data in background
 * - Updates if response differs from cache
 * - Listens to SSE invalidation events and refetches when scope matches
 */
export function useApi<T>(
  url: string | null,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown,
  options: UseApiOptions = {},
): UseApiState<T> {
  const {
    reactive = true,
    revalidateOnReconnect = true,
    safetyNetMs = 0,
    revalidateIfCached = "immediate",
    idleRevalidateMs = 8_000,
  } = options;
  const [initialState] = useState<{ data: T | null; loading: boolean }>(() => {
    const initialData = url ? cacheGet<T>(url) : null;
    return {
      data: initialData,
      loading: !initialData && !!url,
    };
  });
  const [data, setData] = useState<T | null>(initialState.data);
  const [loading, setLoading] = useState(initialState.loading);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [trigger, setTrigger] = useState(0);
  const urlRef = useRef(url);
  const dataUrlRef = useRef(url);
  const dataRef = useRef(data);
  const bodyRef = useRef(body);
  useEffect(() => {
    dataRef.current = data;
    bodyRef.current = body;
  }, [body, data]);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  // Reset on URL change
  useEffect(() => {
    if (url !== urlRef.current) {
      urlRef.current = url;
      dataUrlRef.current = url;
      const freshCache = url ? cacheGet<T>(url) : null;
      setData(freshCache);
      setLoading(!freshCache && !!url);
      setError(null);
      setStatus(null);
    }
  }, [url]);

  // Fetch + SWR
  useEffect(() => {
    if (!url) return;
    const requestUrl = url;
    const controller = new AbortController();
    let cancelled = false;
    let cancelScheduledFetch: (() => void) | null = null;
    let cancelWarmingRetry: (() => void) | null = null;
    let transientRetryAttempt = 0;
    const hasCachedPayload =
      method === "GET" ? cacheGet<T>(requestUrl) !== null : false;

    // Only show loading if no cached data
    if (!dataRef.current) setLoading(true);
    setError(null);
    setStatus(null);

    const runFetch = () => {
      if (cancelled || controller.signal.aborted) return;
      cancelWarmingRetry = null;
      api<T>(requestUrl, method, bodyRef.current, { signal: controller.signal })
        .then((freshData) => {
          transientRetryAttempt = 0;
          cacheSet(requestUrl, freshData);
          if (cancelled) return;
          if (urlRef.current !== requestUrl) return;
          dataUrlRef.current = requestUrl;
          startTransition(() => {
            setData(freshData);
          });
        })
        .catch((e: HttpError) => {
          const warmingRetryDelay =
            method === "GET" ? catalogWarmingRetryDelayMs(e) : null;
          const transientRetryDelay =
            method === "GET" && warmingRetryDelay == null
              ? transientReadRetryDelayMs(e, transientRetryAttempt)
              : null;
          const retryDelay = warmingRetryDelay ?? transientRetryDelay;
          if (!cancelled && !controller.signal.aborted && retryDelay != null) {
            if (transientRetryDelay != null) transientRetryAttempt += 1;
            cancelWarmingRetry?.();
            cancelWarmingRetry = scheduleTimeout(() => {
              cancelWarmingRetry = null;
              runFetch();
            }, retryDelay);
            return;
          }
          if (!cancelled && !controller.signal.aborted) {
            const canServeCachedData =
              method === "GET" && cacheGet<T>(requestUrl) !== null;
            setError(canServeCachedData ? null : e.message);
            setStatus(canServeCachedData ? null : e.status ?? null);
          }
        })
        .finally(() => {
          if (!cancelled && cancelWarmingRetry == null) setLoading(false);
        });
    };

    const canDeferInitialRevalidate =
      trigger === 0 && hasCachedPayload && revalidateIfCached !== "immediate";

    if (canDeferInitialRevalidate && revalidateIfCached === "never") {
      setLoading(false);
    } else if (canDeferInitialRevalidate) {
      cancelScheduledFetch = scheduleIdleRevalidate(runFetch, idleRevalidateMs);
    } else {
      runFetch();
    }

    return () => {
      cancelled = true;
      cancelScheduledFetch?.();
      cancelWarmingRetry?.();
      controller.abort();
    };
  }, [url, method, trigger, revalidateIfCached, idleRevalidateMs]);

  // Listen to SSE invalidation events — refetch when ANY matching scope fires.
  // The old code only refetched if cacheGet returned null, which let stale
  // localStorage entries prevent the refetch. Now we refetch unconditionally
  // whenever a scope that covers this URL is invalidated.
  useEffect(() => {
    if (!url || !reactive) return;
    const myScopes = scopesForUrl(url);
    if (!myScopes.length) return;
    return onCacheInvalidation((scope) => {
      if (myScopes.includes(scope)) {
        refetch();
      }
    });
  }, [reactive, url, refetch]);

  useEffect(() => {
    if (!url || !reactive || !revalidateOnReconnect) return;
    return onCacheReconnect(() => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      )
        return;
      if (
        typeof navigator !== "undefined" &&
        "onLine" in navigator &&
        !navigator.onLine
      )
        return;
      refetch();
    });
  }, [reactive, revalidateOnReconnect, url, refetch]);

  useEffect(() => {
    if (!url || safetyNetMs <= 0) return;
    const timer = window.setInterval(() => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      )
        return;
      if (
        typeof navigator !== "undefined" &&
        "onLine" in navigator &&
        !navigator.onLine
      )
        return;
      refetch();
    }, safetyNetMs);
    return () => window.clearInterval(timer);
  }, [safetyNetMs, url, refetch]);

  const stateMatchesCurrentUrl = dataUrlRef.current === url;
  const cachedForCurrentUrl =
    !stateMatchesCurrentUrl && url ? cacheGet<T>(url) : null;

  return {
    data: stateMatchesCurrentUrl ? data : cachedForCurrentUrl,
    loading: stateMatchesCurrentUrl ? loading : !cachedForCurrentUrl && !!url,
    error: stateMatchesCurrentUrl ? error : null,
    status: stateMatchesCurrentUrl ? status : null,
    refetch,
  };
}
