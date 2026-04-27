/**
 * Local retry queue for play-event writes.
 *
 * When `apiFetch` fails (auth expired, server down, offline), these
 * events are best-effort — losing them silently erodes stats/scrobble
 * fidelity. We persist failed events to localStorage and retry with
 * exponential backoff on mount, on `online`, and periodically.
 *
 * Rules:
 *  - max queue size: 500 events (circular, oldest dropped first)
 *  - max retries per event: 5
 *  - backoff: 2s, 4s, 8s, 16s, 32s (capped at 60s)
 *  - single in-flight flush at a time to avoid duplicate deliveries
 */
import { apiFetch } from "@/lib/api";

const QUEUE_KEY = "listen-pending-play-events";
const MAX_QUEUE_SIZE = 500;
const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60000;

interface QueuedEvent {
  id: string;
  endpoint: string;
  payload: unknown;
  queuedAt: string;
  attempts: number;
  nextRetryAt: string;
}

function generateId(): string {
  // Small random id; no need for crypto-grade uniqueness, just dedup in
  // local state. Time-based component keeps ordering sensible on inspect.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readQueue(): QueuedEvent[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(events: QueuedEvent[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(events));
  } catch {
    /* quota exceeded or storage disabled — drop silently */
  }
}

function backoffFor(attempts: number): number {
  const ms = RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(ms, RETRY_MAX_MS);
}

let flushInFlight = false;

/**
 * Enqueue a failed API write for later retry. Oldest entries are dropped
 * when the queue exceeds MAX_QUEUE_SIZE.
 */
export function enqueueEvent(endpoint: string, payload: unknown): void {
  const now = new Date();
  const event: QueuedEvent = {
    id: generateId(),
    endpoint,
    payload,
    queuedAt: now.toISOString(),
    attempts: 0,
    // Send immediately on the next flush; backoff only applies after
    // an actual delivery attempt fails.
    nextRetryAt: now.toISOString(),
  };
  const queue = readQueue();
  queue.push(event);
  // Trim oldest if over capacity.
  while (queue.length > MAX_QUEUE_SIZE) {
    queue.shift();
  }
  writeQueue(queue);
}

/**
 * Attempt to resend every queued event whose nextRetryAt has passed.
 * Returns counts for observability. Skipped if another flush is in
 * flight (concurrent calls coalesce).
 */
export async function flushQueue(): Promise<{ sent: number; failed: number; dropped: number }> {
  if (flushInFlight) return { sent: 0, failed: 0, dropped: 0 };
  flushInFlight = true;
  try {
    const queue = readQueue();
    if (queue.length === 0) return { sent: 0, failed: 0, dropped: 0 };

    const now = Date.now();
    let sent = 0;
    let failed = 0;
    let dropped = 0;
    const remaining: QueuedEvent[] = [];

    for (const event of queue) {
      const dueAt = Date.parse(event.nextRetryAt);
      if (!Number.isNaN(dueAt) && dueAt > now) {
        // Not yet due.
        remaining.push(event);
        continue;
      }

      try {
        const response = await apiFetch(event.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(event.payload),
        });
        if (response && (response.ok || response.status === 204)) {
          sent += 1;
          continue;
        }
        // 401 is an auth issue, not a request issue. Preserve the event
        // untouched (no attempt counter bump, no backoff) so we don't
        // burn the retry budget while the user is signed out or before
        // auth has hydrated. It'll re-flush once auth becomes ready.
        if (response && response.status === 401) {
          failed += 1;
          remaining.push(event);
          continue;
        }
        // Other 4xx — malformed payload / missing resource → unrecoverable.
        if (response && response.status >= 400 && response.status < 500) {
          dropped += 1;
          continue;
        }
        throw new Error(`HTTP ${response?.status ?? "unknown"}`);
      } catch {
        const attempts = event.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          dropped += 1;
          continue;
        }
        failed += 1;
        remaining.push({
          ...event,
          attempts,
          nextRetryAt: new Date(Date.now() + backoffFor(attempts)).toISOString(),
        });
      }
    }

    writeQueue(remaining);
    return { sent, failed, dropped };
  } finally {
    flushInFlight = false;
  }
}

export function queueSize(): number {
  return readQueue().length;
}

/**
 * Discard every queued event. Call on logout / account switch so
 * telemetry from the previous user doesn't flush under another user's
 * authenticated session.
 */
export function clearQueue(): void {
  try {
    localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * POST with automatic retry-on-failure. If the request fails (network
 * error, 5xx, or 401) the payload is enqueued for later retry. 4xx
 * other than 401 are treated as unrecoverable and logged.
 *
 * Fire-and-forget; never throws.
 */
export async function postWithRetry(endpoint: string, payload: unknown): Promise<void> {
  try {
    const response = await apiFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (response.ok || response.status === 204) return;

    // 4xx non-401 → request is shaped wrong / resource invalid; don't retry.
    if (response.status >= 400 && response.status < 500 && response.status !== 401) {
      console.warn(`[${endpoint}] rejected ${response.status}`, payload);
      return;
    }

    // 401 (token expired) + 5xx → enqueue and retry later.
    enqueueEvent(endpoint, payload);
  } catch (err) {
    // Network error, timeout, etc.
    enqueueEvent(endpoint, payload);
    console.warn(`[${endpoint}] network error, queued`, err);
  }
}
