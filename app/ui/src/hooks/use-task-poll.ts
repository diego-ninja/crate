import { useRef, useCallback, useEffect } from "react";
import { api } from "@/lib/api";

interface TaskResult {
  status: string;
  result?: Record<string, unknown>;
  error?: string;
}

/**
 * Hook for polling task status. Cleans up all intervals on unmount.
 */
export function useTaskPoll() {
  const intervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Cleanup all on unmount
  useEffect(() => {
    return () => {
      intervalsRef.current.forEach((timer) => clearInterval(timer));
      intervalsRef.current.clear();
    };
  }, []);

  const stopPolling = useCallback((taskId: string) => {
    const timer = intervalsRef.current.get(taskId);
    if (timer) {
      clearInterval(timer);
      intervalsRef.current.delete(taskId);
    }
  }, []);

  const pollTask = useCallback((
    taskId: string,
    onComplete: (result?: Record<string, unknown>) => void,
    onFailed?: (error?: string) => void,
    intervalMs = 3000,
    timeoutMs = 120000,
  ) => {
    stopPolling(taskId);

    const timer = setInterval(async () => {
      try {
        const task = await api<TaskResult>(`/api/tasks/${taskId}`);
        if (task.status === "completed") {
          stopPolling(taskId);
          onComplete(task.result);
        } else if (task.status === "failed") {
          stopPolling(taskId);
          onFailed?.(task.error);
        }
      } catch {
        // Network error — keep polling
      }
    }, intervalMs);

    intervalsRef.current.set(taskId, timer);
    setTimeout(() => stopPolling(taskId), timeoutMs);
  }, [stopPolling]);

  return { pollTask, stopPolling };
}
