export interface TaskCompletion {
  status: string;
  result?: Record<string, unknown>;
  error?: string;
}

export function waitForTask(taskId: string, timeoutMs = 120000, signal?: AbortSignal): Promise<TaskCompletion> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const source = new EventSource(`/api/events/task/${taskId}`);
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
      source.close();
      signal?.removeEventListener("abort", abort);
    }

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
      // Keep the stream alive through transient SSE hiccups and only give up on timeout.
    };
  });
}
