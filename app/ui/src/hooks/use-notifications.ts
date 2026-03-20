import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useSse } from "./use-sse";

interface TaskEvent {
  id: string;
  type: string;
  status: string;
  [key: string]: unknown;
}

const TYPE_LABELS: Record<string, string> = {
  scan: "Library Scan",
  compute_analytics: "Compute Analytics",
  enrich_artists: "Artist Enrichment",
  fetch_artwork_all: "Fetch All Artwork",
  batch_retag: "Batch Retag",
  batch_covers: "Batch Fetch Covers",
};

export function useNotifications() {
  const permissionAsked = useRef(false);

  const notify = useCallback((title: string, body: string) => {
    if (Notification.permission === "granted" && document.hidden) {
      new Notification(title, { body, icon: "/favicon.ico" });
    }
  }, []);

  // Ask for permission once via toast
  useEffect(() => {
    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "default" ||
      permissionAsked.current
    ) {
      return;
    }
    permissionAsked.current = true;

    const timer = setTimeout(() => {
      toast("Enable notifications?", {
        description: "Get notified when background tasks complete.",
        action: {
          label: "Enable",
          onClick: () => {
            Notification.requestPermission();
          },
        },
        duration: 8000,
      });
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  // Listen for task completion via SSE
  const { data } = useSse<TaskEvent>("/api/events", {
    enabled: typeof Notification !== "undefined" && Notification.permission === "granted",
  });

  const lastEventRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data || data.status !== "completed") return;
    if (lastEventRef.current === data.id) return;
    lastEventRef.current = data.id;

    const label = TYPE_LABELS[data.type] ?? data.type;
    notify("Task Completed", `${label} finished successfully.`);
  }, [data, notify]);
}
