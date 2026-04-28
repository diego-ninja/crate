import { useRef, useCallback, useEffect } from "react";

import { waitForTask } from "@/lib/tasks";

interface TaskResult {
  status: string;
  result?: Record<string, unknown>;
  error?: string;
}

/**
 * Hook for task completion watching via SSE. Cleans up all in-flight waits on unmount.
 */
export function useTaskPoll() {
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  // Cleanup all on unmount
  useEffect(() => {
    return () => {
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
    };
  }, []);

  const stopPolling = useCallback((taskId: string) => {
    const controller = controllersRef.current.get(taskId);
    if (controller) {
      controller.abort();
      controllersRef.current.delete(taskId);
    }
  }, []);

  const pollTask = useCallback((
    taskId: string,
    onComplete: (result?: Record<string, unknown>) => void,
    onFailed?: (error?: string) => void,
    _intervalMs = 3000,
    timeoutMs = 120000,
  ) => {
    stopPolling(taskId);
    const controller = new AbortController();
    controllersRef.current.set(taskId, controller);
    void waitForTask(taskId, timeoutMs, controller.signal)
      .then((task: TaskResult) => {
        stopPolling(taskId);
        if (task.status === "completed") {
          onComplete(task.result);
        } else if (task.status === "failed") {
          onFailed?.(task.error);
        }
      })
      .catch((error: Error) => {
        stopPolling(taskId);
        if (error.name === "AbortError") return;
        onFailed?.("Timed out waiting for task completion");
      });
  }, [stopPolling]);

  return { pollTask, stopPolling };
}
