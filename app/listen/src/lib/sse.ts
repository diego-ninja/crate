export interface SseChannelState {
  name: string;
  connected: boolean;
  degraded: boolean;
  hasEverConnected: boolean;
  reconnectCount: number;
  degradeAfterMs: number;
  lastOpenAt: number | null;
  lastEventAt: number | null;
  lastReconnectAt: number | null;
  lastErrorAt: number | null;
  lastCloseAt: number | null;
}

type SseChannelListener = (state: SseChannelState) => void;
type SseReconnectListener = (state: SseChannelState) => void;

const DEFAULT_DEGRADE_AFTER_MS = 75_000;
const HEALTH_CHECK_INTERVAL_MS = 5_000;

const channelStates = new Map<string, SseChannelState>();
const channelListeners = new Map<string, Set<SseChannelListener>>();
const reconnectListeners = new Map<string, Set<SseReconnectListener>>();

let healthTimer: number | null = null;

function createInitialState(name: string, degradeAfterMs = DEFAULT_DEGRADE_AFTER_MS): SseChannelState {
  return {
    name,
    connected: false,
    degraded: false,
    hasEverConnected: false,
    reconnectCount: 0,
    degradeAfterMs,
    lastOpenAt: null,
    lastEventAt: null,
    lastReconnectAt: null,
    lastErrorAt: null,
    lastCloseAt: null,
  };
}

function cloneState(state: SseChannelState): SseChannelState {
  return { ...state };
}

function emitState(state: SseChannelState): void {
  const snapshot = cloneState(state);
  for (const listener of channelListeners.get(state.name) || []) {
    try {
      listener(snapshot);
    } catch {
      // Ignore listener failures to keep the stream runtime healthy.
    }
  }
}

function emitReconnect(state: SseChannelState): void {
  const snapshot = cloneState(state);
  for (const listener of reconnectListeners.get(state.name) || []) {
    try {
      listener(snapshot);
    } catch {
      // Ignore listener failures to keep the stream runtime healthy.
    }
  }
}

function ensureState(name: string, degradeAfterMs = DEFAULT_DEGRADE_AFTER_MS): SseChannelState {
  const existing = channelStates.get(name);
  if (existing) {
    existing.degradeAfterMs = degradeAfterMs;
    return existing;
  }
  const created = createInitialState(name, degradeAfterMs);
  channelStates.set(name, created);
  ensureHealthMonitor();
  return created;
}

function ensureHealthMonitor(): void {
  if (healthTimer != null || typeof window === "undefined") return;
  healthTimer = window.setInterval(() => {
    const now = Date.now();
    for (const state of channelStates.values()) {
      if (!state.connected) continue;
      const lastActivityAt = state.lastEventAt ?? state.lastOpenAt;
      const nextDegraded = lastActivityAt == null
        ? true
        : now - lastActivityAt > state.degradeAfterMs;
      if (nextDegraded !== state.degraded) {
        state.degraded = nextDegraded;
        emitState(state);
      }
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

export function getSseChannelState(name: string): SseChannelState | null {
  const state = channelStates.get(name);
  return state ? cloneState(state) : null;
}

export function onSseChannelState(name: string, listener: SseChannelListener): () => void {
  const listeners = channelListeners.get(name) || new Set<SseChannelListener>();
  listeners.add(listener);
  channelListeners.set(name, listeners);
  const state = channelStates.get(name);
  if (state) {
    listener(cloneState(state));
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      channelListeners.delete(name);
    }
  };
}

export function onSseReconnect(name: string, listener: SseReconnectListener): () => void {
  const listeners = reconnectListeners.get(name) || new Set<SseReconnectListener>();
  listeners.add(listener);
  reconnectListeners.set(name, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      reconnectListeners.delete(name);
    }
  };
}

export function markSseChannelOpen(
  name: string,
  options: { degradeAfterMs?: number } = {},
): { reconnected: boolean; state: SseChannelState } {
  const state = ensureState(name, options.degradeAfterMs);
  const now = Date.now();
  const reconnected = state.hasEverConnected;
  state.connected = true;
  state.degraded = false;
  state.hasEverConnected = true;
  state.lastOpenAt = now;
  state.lastEventAt = now;
  state.lastCloseAt = null;
  if (reconnected) {
    state.reconnectCount += 1;
    state.lastReconnectAt = now;
  }
  emitState(state);
  if (reconnected) {
    emitReconnect(state);
  }
  return { reconnected, state: cloneState(state) };
}

export function markSseChannelEvent(
  name: string,
  options: { degradeAfterMs?: number } = {},
): SseChannelState {
  const state = ensureState(name, options.degradeAfterMs);
  const now = Date.now();
  state.connected = true;
  state.degraded = false;
  state.lastEventAt = now;
  emitState(state);
  return cloneState(state);
}

export function markSseChannelError(
  name: string,
  options: { degradeAfterMs?: number } = {},
): SseChannelState {
  const state = ensureState(name, options.degradeAfterMs);
  state.connected = false;
  state.degraded = true;
  state.lastErrorAt = Date.now();
  emitState(state);
  return cloneState(state);
}

export function markSseChannelClosed(
  name: string,
  options: { degradeAfterMs?: number } = {},
): SseChannelState {
  const state = ensureState(name, options.degradeAfterMs);
  state.connected = false;
  state.lastCloseAt = Date.now();
  emitState(state);
  return cloneState(state);
}
