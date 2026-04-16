import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearQueue, enqueueEvent, flushQueue, postWithRetry, queueSize } from "./play-event-queue";

// Module-level mock of apiFetch so we can control every response.
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "@/lib/api";
const mockApiFetch = vi.mocked(apiFetch);

function mkResponse(status: number, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    body: null,
  } as unknown as Response;
}

beforeEach(() => {
  localStorage.clear();
  mockApiFetch.mockReset();
  vi.useRealTimers();
});

afterEach(() => {
  localStorage.clear();
});

describe("enqueueEvent", () => {
  it("persists events to localStorage", () => {
    enqueueEvent("/api/foo", { hello: "world" });
    expect(queueSize()).toBe(1);
  });

  it("caps queue at MAX_QUEUE_SIZE dropping oldest", () => {
    for (let i = 0; i < 505; i++) {
      enqueueEvent("/api/foo", { i });
    }
    expect(queueSize()).toBe(500);
    // First 5 should have been dropped.
    const raw = localStorage.getItem("listen-pending-play-events")!;
    const events = JSON.parse(raw);
    expect((events[0].payload as { i: number }).i).toBe(5);
  });

  it("survives localStorage write failures gracefully", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => enqueueEvent("/api/foo", {})).not.toThrow();
    setItemSpy.mockRestore();
  });
});

describe("flushQueue", () => {
  it("sends queued events and removes successful ones", async () => {
    enqueueEvent("/api/foo", { a: 1 });
    enqueueEvent("/api/bar", { b: 2 });
    mockApiFetch.mockResolvedValue(mkResponse(204));

    const result = await flushQueue();

    expect(result.sent).toBe(2);
    expect(queueSize()).toBe(0);
  });

  it("keeps events that fail with 5xx for retry", async () => {
    enqueueEvent("/api/foo", { a: 1 });
    mockApiFetch.mockResolvedValue(mkResponse(503));

    const result = await flushQueue();

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
    expect(queueSize()).toBe(1);
  });

  it("drops events that fail with 4xx (non-401)", async () => {
    enqueueEvent("/api/foo", { a: 1 });
    mockApiFetch.mockResolvedValue(mkResponse(400));

    const result = await flushQueue();

    expect(result.dropped).toBe(1);
    expect(queueSize()).toBe(0);
  });

  it("retries 401 (auth expired) instead of dropping", async () => {
    enqueueEvent("/api/foo", { a: 1 });
    mockApiFetch.mockResolvedValue(mkResponse(401));

    await flushQueue();

    expect(queueSize()).toBe(1);
  });

  it("401 does NOT increment attempts (auth gap shouldn't burn the budget)", async () => {
    enqueueEvent("/api/foo", { a: 1 });
    mockApiFetch.mockResolvedValue(mkResponse(401));

    // Flush 10 times with nothing but 401s.
    for (let i = 0; i < 10; i++) {
      await flushQueue();
    }

    // Event is still there, still with attempts=0. It would've been
    // dropped after MAX_ATTEMPTS=5 if 401 counted.
    expect(queueSize()).toBe(1);
    const events = JSON.parse(localStorage.getItem("listen-pending-play-events")!);
    expect(events[0].attempts).toBe(0);
  });

  it("401 does not delay the next retry (no backoff applied)", async () => {
    enqueueEvent("/api/foo", { a: 1 });
    mockApiFetch.mockResolvedValue(mkResponse(401));

    await flushQueue();

    const events = JSON.parse(localStorage.getItem("listen-pending-play-events")!);
    // nextRetryAt should still be "now-ish" (not pushed into the future)
    // so the next flush attempt fires immediately.
    const retryAt = Date.parse(events[0].nextRetryAt);
    expect(retryAt).toBeLessThanOrEqual(Date.now() + 100);
  });

  it("retries network errors with backoff", async () => {
    enqueueEvent("/api/foo", { a: 1 });
    mockApiFetch.mockRejectedValue(new Error("network down"));

    const result = await flushQueue();

    expect(result.failed).toBe(1);
    expect(queueSize()).toBe(1);

    const events = JSON.parse(localStorage.getItem("listen-pending-play-events")!);
    expect(events[0].attempts).toBe(1);
    // nextRetryAt should be in the future (~2s backoff on first attempt).
    expect(Date.parse(events[0].nextRetryAt)).toBeGreaterThan(Date.now());
  });

  it("drops events after MAX_ATTEMPTS retries", async () => {
    // Manually inject an event with 4 attempts already (one more will drop it).
    const oldEvent = {
      id: "x",
      endpoint: "/api/foo",
      payload: { a: 1 },
      queuedAt: new Date().toISOString(),
      attempts: 4,
      nextRetryAt: new Date(0).toISOString(), // due now
    };
    localStorage.setItem("listen-pending-play-events", JSON.stringify([oldEvent]));
    mockApiFetch.mockRejectedValue(new Error("still down"));

    const result = await flushQueue();

    expect(result.dropped).toBe(1);
    expect(queueSize()).toBe(0);
  });

  it("skips events whose nextRetryAt is in the future", async () => {
    const futureEvent = {
      id: "x",
      endpoint: "/api/foo",
      payload: { a: 1 },
      queuedAt: new Date().toISOString(),
      attempts: 1,
      nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
    };
    localStorage.setItem("listen-pending-play-events", JSON.stringify([futureEvent]));

    const result = await flushQueue();

    expect(result.sent).toBe(0);
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(queueSize()).toBe(1);
  });

  it("is idempotent on concurrent calls", async () => {
    enqueueEvent("/api/foo", { a: 1 });
    let resolveFirst: (v: Response) => void = () => {};
    mockApiFetch.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));

    const first = flushQueue();
    const second = await flushQueue(); // should early-return while first is in flight
    expect(second).toEqual({ sent: 0, failed: 0, dropped: 0 });

    resolveFirst(mkResponse(204));
    await first;
  });
});

describe("clearQueue", () => {
  it("removes all queued events", () => {
    enqueueEvent("/api/foo", { a: 1 });
    enqueueEvent("/api/bar", { b: 2 });
    expect(queueSize()).toBe(2);

    clearQueue();

    expect(queueSize()).toBe(0);
  });

  it("is a no-op when the queue is already empty", () => {
    expect(() => clearQueue()).not.toThrow();
    expect(queueSize()).toBe(0);
  });

  it("survives localStorage failures gracefully", () => {
    const spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => clearQueue()).not.toThrow();
    spy.mockRestore();
  });
});

describe("postWithRetry", () => {
  it("does not enqueue on 2xx", async () => {
    mockApiFetch.mockResolvedValue(mkResponse(200));
    await postWithRetry("/api/foo", { a: 1 });
    expect(queueSize()).toBe(0);
  });

  it("enqueues on 5xx", async () => {
    mockApiFetch.mockResolvedValue(mkResponse(500));
    await postWithRetry("/api/foo", { a: 1 });
    expect(queueSize()).toBe(1);
  });

  it("enqueues on 401", async () => {
    mockApiFetch.mockResolvedValue(mkResponse(401));
    await postWithRetry("/api/foo", { a: 1 });
    expect(queueSize()).toBe(1);
  });

  it("drops on 400 without enqueuing", async () => {
    mockApiFetch.mockResolvedValue(mkResponse(400));
    await postWithRetry("/api/foo", { a: 1 });
    expect(queueSize()).toBe(0);
  });

  it("enqueues on network error", async () => {
    mockApiFetch.mockRejectedValue(new Error("connection refused"));
    await postWithRetry("/api/foo", { a: 1 });
    expect(queueSize()).toBe(1);
  });
});
