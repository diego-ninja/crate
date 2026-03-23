import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useTaskEvents } from "@/hooks/use-task-events";

export function useProgressToast(taskId: string | null, label: string) {
  const toastIdRef = useRef<string | number | null>(null);
  const { events, done } = useTaskEvents(taskId);

  useEffect(() => {
    if (!taskId) return;

    // Create persistent toast
    if (!toastIdRef.current) {
      toastIdRef.current = toast.loading(label, {
        description: "Starting...",
        duration: Infinity,
      });
    }

    // Update based on latest event
    const lastEvent = events[events.length - 1];
    if (lastEvent) {
      const data = lastEvent.data || {};
      if (lastEvent.type === "step_done") {
        toast.loading(label, {
          id: toastIdRef.current!,
          description: `${(data.step as string)?.replace(/_/g, " ") || "Processing"}...`,
        });
      } else if (lastEvent.type === "info") {
        toast.loading(label, {
          id: toastIdRef.current!,
          description: (data.message as string) || "Processing...",
        });
      }
    }
  }, [taskId, label, events]);

  // Handle completion separately
  useEffect(() => {
    if (!done || !toastIdRef.current) return;

    if (done.status === "completed") {
      toast.success(label, {
        id: toastIdRef.current,
        description: "Completed successfully",
        duration: 4000,
      });
    } else {
      toast.error(label, {
        id: toastIdRef.current,
        description: done.error || "Failed",
        duration: 6000,
      });
    }
    toastIdRef.current = null;
  }, [done, label]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (toastIdRef.current) {
        toast.dismiss(toastIdRef.current);
      }
    };
  }, []);
}
