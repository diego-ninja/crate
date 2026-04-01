import type { ApiMethod } from "./api";
import type { ApiRequestOptions } from "./api";

export interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

type ApiFn = <T = unknown>(
  url: string,
  method?: ApiMethod,
  body?: unknown,
  options?: ApiRequestOptions,
) => Promise<T>;

interface ReactHookDeps {
  useState: <T>(
    initial: T | (() => T),
  ) => [T, (value: T | ((prev: T) => T)) => void];
  useEffect: (
    effect: () => void | (() => void),
    deps: readonly unknown[],
  ) => void;
  useCallback: <T extends (...args: never[]) => unknown>(
    fn: T,
    deps: readonly unknown[],
  ) => T;
  useRef: <T>(initial: T) => { current: T };
}

export function createUseApi(reactHooks: ReactHookDeps, apiFn: ApiFn) {
  const { useState, useEffect, useCallback, useRef } = reactHooks;

  return function useApi<T>(
    url: string | null,
    method: ApiMethod = "GET",
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
      const controller = new AbortController();
      let cancelled = false;

      if (!hasFetched.current) {
        setLoading(true);
      }
      setError(null);

      apiFn<T>(url, method, body, { signal: controller.signal })
        .then((nextData) => {
          if (!cancelled) {
            setData(nextData);
            hasFetched.current = true;
          }
        })
        .catch((e: Error) => {
          if (!cancelled && controller.signal.aborted !== true) {
            setError(e.message);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });

      return () => {
        cancelled = true;
        controller.abort();
      };
    }, [url, method, trigger]);

    useEffect(() => {
      hasFetched.current = false;
    }, [url]);

    return { data, loading, error, refetch };
  };
}
