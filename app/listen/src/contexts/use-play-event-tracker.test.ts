import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the retry queue so we can assert what would be posted without
// hitting the network layer.
vi.mock("@/lib/play-event-queue", () => ({
  postWithRetry: vi.fn(() => Promise.resolve()),
}));

import { postWithRetry } from "@/lib/play-event-queue";
import { usePlayEventTracker } from "./use-play-event-tracker";
import type { Track, PlaySource } from "./player-types";

const mockPost = vi.mocked(postWithRetry);

const TRACK_A: Track = { id: "a", title: "A", artist: "X", libraryTrackId: 1 };
const TRACK_B: Track = { id: "b", title: "B", artist: "Y", libraryTrackId: 2 };
const SRC: PlaySource = { type: "album", name: "Test" };

function setup() {
  const snapshotRef = { current: { currentTime: 0, duration: 180 } };
  const getPlaybackSnapshot = () => snapshotRef.current;
  const { result } = renderHook(() => usePlayEventTracker(getPlaybackSnapshot));
  return { result, snapshotRef };
}

beforeEach(() => {
  mockPost.mockClear();
});

afterEach(() => {
  // Nothing to clean up; localStorage untouched.
});

describe("usePlayEventTracker — explicit lifecycle", () => {
  it("flushCurrentPlayEvent is a no-op before any startSession", () => {
    const { result } = setup();
    act(() => { result.current.flushCurrentPlayEvent("skipped"); });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("startSession seeds a session from the playback snapshot", () => {
    const { result, snapshotRef } = setup();
    snapshotRef.current = { currentTime: 30, duration: 240 };

    act(() => { result.current.startSession(TRACK_A, SRC); });
    // Simulate 10s of playback as realistic small ticks (the delta
    // cap rejects jumps > 5s to prevent seeks from inflating stats).
    for (let t = 31; t <= 40; t++) {
      act(() => { result.current.recordProgress(t); });
    }
    act(() => { result.current.flushCurrentPlayEvent("skipped"); });

    expect(mockPost).toHaveBeenCalledTimes(1);
    const payload = mockPost.mock.calls[0]![1] as {
      client_event_id: string;
      played_seconds: number;
      track_duration_seconds: number;
      was_skipped: boolean;
    };
    expect(payload.client_event_id).toEqual(expect.any(String));
    expect(payload.client_event_id.length).toBeGreaterThan(0);
    expect(payload.played_seconds).toBeCloseTo(10, 5);
    expect(payload.track_duration_seconds).toBe(240);
    expect(payload.was_skipped).toBe(true);
  });

  it("startSession with same track only updates the source, preserves progress", () => {
    const { result } = setup();
    act(() => { result.current.startSession(TRACK_A, null); });
    for (let t = 1; t <= 5; t++) {
      act(() => { result.current.recordProgress(t); });
    }

    const otherSource: PlaySource = { type: "playlist", name: "Mix", id: 99 };
    act(() => { result.current.startSession(TRACK_A, otherSource); });
    for (let t = 6; t <= 7; t++) {
      act(() => { result.current.recordProgress(t); });
    }
    act(() => { result.current.flushCurrentPlayEvent("skipped"); });

    const payload = mockPost.mock.calls[0]![1] as { played_seconds: number; play_source_name: string };
    // 5s + 2s = 7s of progress.
    expect(payload.played_seconds).toBeCloseTo(7, 5);
    // Source was updated to the playlist.
    expect(payload.play_source_name).toBe("Mix");
  });

  it("startSession with a different track replaces the previous session without flushing", () => {
    const { result } = setup();
    act(() => { result.current.startSession(TRACK_A, null); });
    for (let t = 1; t <= 3; t++) {
      act(() => { result.current.recordProgress(t); });
    }

    // Manual replace — the caller is expected to flush separately if
    // they care about the previous event.
    act(() => { result.current.startSession(TRACK_B, null); });
    for (let t = 1; t <= 2; t++) {
      act(() => { result.current.recordProgress(t); });
    }
    act(() => { result.current.flushCurrentPlayEvent("skipped"); });

    expect(mockPost).toHaveBeenCalledTimes(1);
    const payload = mockPost.mock.calls[0]![1] as { title: string; played_seconds: number };
    expect(payload.title).toBe("B");
    expect(payload.played_seconds).toBeCloseTo(2, 5);
  });

  it("startSession(undefined) clears any active session", () => {
    const { result } = setup();
    act(() => { result.current.startSession(TRACK_A, null); });
    act(() => { result.current.startSession(undefined, null); });
    act(() => { result.current.flushCurrentPlayEvent("interrupted"); });

    expect(mockPost).not.toHaveBeenCalled();
  });

  it("expectedTrack guard drops flush when session is for a different track", () => {
    const { result } = setup();
    act(() => { result.current.startSession(TRACK_A, null); });
    for (let t = 1; t <= 10; t++) {
      act(() => { result.current.recordProgress(t); });
    }

    // Caller expected TRACK_B but the session is TRACK_A → drop.
    act(() => { result.current.flushCurrentPlayEvent("completed", TRACK_B); });

    expect(mockPost).not.toHaveBeenCalled();
    // Session is NOT cleared when expectedTrack mismatch — caller retains
    // the correct session so a subsequent correct flush still works.
    act(() => { result.current.flushCurrentPlayEvent("completed", TRACK_A); });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it("rotateSession flushes the outgoing track and immediately tracks the incoming one", () => {
    const { result } = setup();
    act(() => { result.current.startSession(TRACK_A, SRC); });
    for (let t = 1; t <= 5; t++) {
      act(() => { result.current.recordProgress(t); });
    }

    act(() => {
      result.current.rotateSession("completed", TRACK_A, TRACK_B, SRC);
    });
    act(() => { result.current.recordProgress(1); });
    act(() => { result.current.recordProgress(2); });
    act(() => { result.current.flushCurrentPlayEvent("skipped", TRACK_B); });

    expect(mockPost).toHaveBeenCalledTimes(2);
    const firstPayload = mockPost.mock.calls[0]![1] as { title: string; played_seconds: number; was_completed: boolean };
    const secondPayload = mockPost.mock.calls[1]![1] as { title: string; played_seconds: number; was_skipped: boolean };
    expect(firstPayload.title).toBe("A");
    expect(firstPayload.played_seconds).toBeCloseTo(5, 5);
    expect(firstPayload.was_completed).toBe(true);
    expect(secondPayload.title).toBe("B");
    expect(secondPayload.played_seconds).toBeCloseTo(2, 5);
    expect(secondPayload.was_skipped).toBe(true);
  });

  it("completed flush is posted even with 0 listened seconds", () => {
    const { result } = setup();
    act(() => { result.current.startSession(TRACK_A, null); });
    // No recordProgress — zero listened seconds.
    act(() => { result.current.flushCurrentPlayEvent("completed"); });

    expect(mockPost).toHaveBeenCalledTimes(1);
    const payload = mockPost.mock.calls[0]![1] as { was_completed: boolean; played_seconds: number };
    expect(payload.was_completed).toBe(true);
    expect(payload.played_seconds).toBe(0);
  });

  it("skipped flush with <2s listened is dropped", () => {
    const { result } = setup();
    act(() => { result.current.startSession(TRACK_A, null); });
    act(() => { result.current.recordProgress(1); });
    act(() => { result.current.flushCurrentPlayEvent("skipped"); });

    expect(mockPost).not.toHaveBeenCalled();
  });

  it("recordProgress caps large forward jumps to prevent seek-inflation", () => {
    const { result } = setup();
    act(() => { result.current.startSession(TRACK_A, null); });
    act(() => { result.current.recordProgress(1); });
    // 20-second jump (e.g. a seek). Should be ignored — delta cap = 5s.
    act(() => { result.current.recordProgress(21); });
    act(() => { result.current.flushCurrentPlayEvent("completed"); });

    const payload = mockPost.mock.calls[0]![1] as { played_seconds: number };
    // 1s of accumulated progress (0→1), then the 20s jump is rejected
    // because delta > cap. lastKnownTime moves but listenedSeconds doesn't grow.
    expect(payload.played_seconds).toBeCloseTo(1, 5);
  });
});

describe("ensureSession", () => {
  it("starts a session when none is active", () => {
    const { result } = setup();
    act(() => { result.current.ensureSession(TRACK_A, null); });
    for (let t = 1; t <= 3; t++) {
      act(() => { result.current.recordProgress(t); });
    }
    act(() => { result.current.flushCurrentPlayEvent("completed"); });

    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it("does not replace an active session of a different track", () => {
    const { result } = setup();
    act(() => { result.current.startSession(TRACK_A, null); });
    for (let t = 1; t <= 5; t++) {
      act(() => { result.current.recordProgress(t); });
    }

    // ensureSession with a different track should be a no-op.
    act(() => { result.current.ensureSession(TRACK_B, null); });
    act(() => { result.current.flushCurrentPlayEvent("completed"); });

    const payload = mockPost.mock.calls[0]![1] as { title: string };
    expect(payload.title).toBe("A");
  });

  it("is a no-op when called with undefined track and no session", () => {
    const { result } = setup();
    act(() => { result.current.ensureSession(undefined, null); });
    act(() => { result.current.flushCurrentPlayEvent("completed"); });
    expect(mockPost).not.toHaveBeenCalled();
  });
});
