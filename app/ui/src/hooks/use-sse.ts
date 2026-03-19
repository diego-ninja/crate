import { useState, useEffect, useRef } from "react";

interface UseSseOptions {
  enabled?: boolean;
}

export function useSse<T = string>(
  url: string,
  options: UseSseOptions = {},
): { data: T | null; connected: boolean } {
  const { enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) {
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
      return;
    }

    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        setData(JSON.parse(e.data) as T);
      } catch {
        setData(e.data as unknown as T);
      }
    };
    es.onerror = () => setConnected(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [url, enabled]);

  return { data, connected };
}
