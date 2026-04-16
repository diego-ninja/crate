import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Track } from "./player-types";
import { getStoredQueue, saveQueue, STORAGE_KEY } from "./player-utils";

const TRACK_A: Track = { id: "a", title: "A", artist: "X" };
const TRACK_B: Track = { id: "b", title: "B", artist: "Y" };

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("getStoredQueue / saveQueue round-trip", () => {
  it("returns empty defaults when nothing is persisted", () => {
    const stored = getStoredQueue();
    expect(stored.queue).toEqual([]);
    expect(stored.currentIndex).toBe(0);
    expect(stored.currentTime).toBe(0);
    expect(stored.wasPlaying).toBe(false);
    expect(stored.shuffle).toBe(false);
    expect(stored.unshuffledQueue).toBeNull();
  });

  it("persists basic playback state", () => {
    saveQueue([TRACK_A, TRACK_B], 1, { currentTime: 42, wasPlaying: true });
    const stored = getStoredQueue();
    expect(stored.queue).toEqual([TRACK_A, TRACK_B]);
    expect(stored.currentIndex).toBe(1);
    expect(stored.currentTime).toBe(42);
    expect(stored.wasPlaying).toBe(true);
  });

  it("persists shuffle flag + unshuffledQueue snapshot", () => {
    // User started with [A, B] then activated shuffle; current order
    // is [B, A]. The original [A, B] is preserved so toggling shuffle
    // off after reload restores the user's original sequence.
    saveQueue([TRACK_B, TRACK_A], 0, {
      shuffle: true,
      unshuffledQueue: [TRACK_A, TRACK_B],
    });
    const stored = getStoredQueue();
    expect(stored.queue).toEqual([TRACK_B, TRACK_A]);
    expect(stored.shuffle).toBe(true);
    expect(stored.unshuffledQueue).toEqual([TRACK_A, TRACK_B]);
  });

  it("defaults shuffle flag to false and snapshot to null when not passed", () => {
    saveQueue([TRACK_A], 0);
    const stored = getStoredQueue();
    expect(stored.shuffle).toBe(false);
    expect(stored.unshuffledQueue).toBeNull();
  });

  it("treats legacy payloads (pre-shuffle fields) as shuffle=false", () => {
    // Older app version shape.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      queue: [TRACK_A],
      currentIndex: 0,
      currentTime: 0,
      wasPlaying: false,
    }));
    const stored = getStoredQueue();
    expect(stored.shuffle).toBe(false);
    expect(stored.unshuffledQueue).toBeNull();
  });

  it("survives malformed JSON by returning defaults", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    const stored = getStoredQueue();
    expect(stored.queue).toEqual([]);
    expect(stored.shuffle).toBe(false);
  });

  it("returns defaults when stored queue is empty array", () => {
    saveQueue([], 0);
    const stored = getStoredQueue();
    expect(stored.queue).toEqual([]);
  });
});
