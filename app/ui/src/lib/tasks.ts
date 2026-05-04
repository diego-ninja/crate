export interface TaskCompletion {
  status: string;
  result?: Record<string, unknown>;
  error?: string;
}

interface TaskDetailResponse extends TaskCompletion {
  id: string;
}

const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "cancelled"]);

async function fetchTaskCompletion(taskId: string, signal?: AbortSignal): Promise<TaskCompletion | null> {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) return null;
  const payload = await response.json() as TaskDetailResponse;
  if (!TERMINAL_TASK_STATUSES.has(String(payload.status || ""))) return null;
  return {
    status: payload.status,
    result: payload.result,
    error: payload.error,
  };
}

export function waitForTask(taskId: string, timeoutMs = 120000, signal?: AbortSignal): Promise<TaskCompletion> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const source = new EventSource(`/api/events/task/${taskId}`);
    let pollTimer: number | null = null;
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for task completion"));
    }, timeoutMs);

    const abort = () => {
      cleanup();
      reject(new DOMException("The task wait was aborted", "AbortError"));
    };

    function cleanup() {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
       if (pollTimer != null) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
      }
      source.close();
      signal?.removeEventListener("abort", abort);
    }

    const poll = () => {
      if (settled) return;
      void fetchTaskCompletion(taskId, signal)
        .then((task) => {
          if (!task || settled) return;
          cleanup();
          resolve(task);
        })
        .catch((error: unknown) => {
          if (settled) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          // Ignore transient polling failures; SSE may still complete the flow.
        })
        .finally(() => {
          if (settled) return;
          pollTimer = window.setTimeout(poll, 2000);
        });
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    signal?.addEventListener("abort", abort);

    source.addEventListener("task_done", (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as TaskCompletion;
        cleanup();
        resolve(payload);
      } catch {
        cleanup();
        resolve({ status: "completed" });
      }
    });

    source.onerror = () => {
      // Keep the stream alive through transient SSE hiccups.
      // A parallel status poll resolves the task if the final task_done event is missed.
    };

    poll();
  });
}
