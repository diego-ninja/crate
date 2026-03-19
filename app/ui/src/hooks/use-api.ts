import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useApi<T>(
  url: string | null,
  method: "GET" | "POST" | "PUT" = "GET",
  body?: unknown,
): UseApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);
  const hasFetched = useRef(false);

  const refetch = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    // Only show loading spinner on initial fetch, not on background refetch
    if (!hasFetched.current) {
      setLoading(true);
    }
    setError(null);

    api<T>(url, method, body)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          hasFetched.current = true;
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url, method, trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset hasFetched when URL changes (new resource)
  useEffect(() => {
    hasFetched.current = false;
  }, [url]);

  return { data, loading, error, refetch };
}
