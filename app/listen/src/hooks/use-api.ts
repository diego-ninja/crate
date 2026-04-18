import { useState, useEffect, useCallback, useRef } from "react";

import { api } from "@/lib/api";
import { cacheGet, cacheSet, onCacheInvalidation, scopesForUrl } from "@/lib/cache";

export interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
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
): UseApiState<T> {
  const cached = url ? cacheGet<T>(url) : null;
  const [data, setData] = useState<T | null>(cached);
  const [loading, setLoading] = useState(!cached && !!url);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);
  const urlRef = useRef(url);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  // Reset on URL change
  useEffect(() => {
    if (url !== urlRef.current) {
      urlRef.current = url;
      const freshCache = url ? cacheGet<T>(url) : null;
      setData(freshCache);
      setLoading(!freshCache && !!url);
      setError(null);
    }
  }, [url]);

  // Fetch + SWR
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let cancelled = false;

    // Only show loading if no cached data
    if (!data) setLoading(true);
    setError(null);

    api<T>(url, method, body, { signal: controller.signal })
      .then((freshData) => {
        if (cancelled) return;
        cacheSet(url, freshData);
        setData(freshData);
      })
      .catch((e: Error) => {
        if (!cancelled && !controller.signal.aborted) {
          setError(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, method, trigger]);

  // Listen to SSE invalidation events — refetch when ANY matching scope fires.
  // The old code only refetched if cacheGet returned null, which let stale
  // localStorage entries prevent the refetch. Now we refetch unconditionally
  // whenever a scope that covers this URL is invalidated.
  useEffect(() => {
    if (!url) return;
    const myScopes = scopesForUrl(url);
    if (!myScopes.length) return;
    return onCacheInvalidation((scope) => {
      if (myScopes.includes(scope)) {
        refetch();
      }
    });
  }, [url, refetch]);

  return { data, loading, error, refetch };
}
