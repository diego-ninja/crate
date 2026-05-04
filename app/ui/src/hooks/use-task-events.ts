import { useState, useEffect, useRef, useCallback } from "react";

interface TaskEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface TaskDone {
  status: string;
  result?: Record<string, unknown>;
  error?: string;
}

/**
 * Hook that connects to a task's SSE stream and accumulates events.
 * Returns events array + done status. Auto-closes when task completes.
 */
export function useTaskEvents(taskId: string | null) {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [done, setDone] = useState<TaskDone | null>(null);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  const reset = useCallback(() => {
    setEvents([]);
    setDone(null);
    setConnected(false);
  }, []);

  useEffect(() => {
    if (!taskId) {
      reset();
      return;
    }

    reset();
    const source = new EventSource(`/api/events/task/${taskId}`);
    sourceRef.current = source;

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    // Listen to all named events
    const handleEvent = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        setEvents((prev) => {
          const next = [...prev, payload];
          return next.length > 200 ? next.slice(-200) : next;
        });
      } catch {
        // Ignore parse errors
      }
    };

    // All event types tasks can emit
    const eventTypes = [
      "info", "progress", "warning", "warn", "error", "item",
      "cover_found", "cover_applied",
      "artist_enriched", "artist_skipped", "artist_analyzed",
      "track_analyzed", "album_matched",
      "lyrics_track",
      "step_done", "new_release_found",
      "item_processed", "match_found",
    ];
    for (const type of eventTypes) {
      source.addEventListener(type, handleEvent);
    }

    // Task completion
    source.addEventListener("task_done", (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        setDone(payload);
      } catch {
        setDone({ status: "completed" });
      }
      source.close();
      setConnected(false);
    });

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [taskId, reset]);

  return { events, done, connected, reset };
}
