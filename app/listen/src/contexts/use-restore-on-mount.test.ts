import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";

vi.mock("@/lib/gapless-player", () => ({
  fadeInAndPlay: vi.fn(() => Promise.resolve()),
  loadQueue: vi.fn(),
  play: vi.fn(),
  restoreVolume: vi.fn(),
  seekTo: vi.fn(),
  setLoop: vi.fn(),
  setSingleMode: vi.fn(),
}));

import * as gaplessPlayer from "@/lib/gapless-player";
import { useRestoreOnMount } from "./use-restore-on-mount";
import type { RepeatMode, Track } from "./player-types";

const mockFadeInAndPlay = vi.mocked(gaplessPlayer.fadeInAndPlay);
const mockLoadQueue = vi.mocked(gaplessPlayer.loadQueue);
const mockSeekTo = vi.mocked(gaplessPlayer.seekTo);

const TRACK_A: Track = { id: "a", title: "A", artist: "X" };
const TRACK_B: Track = { id: "b", title: "B", artist: "Y" };

function setStored(
  queue: Track[],
  currentIndex = 0,
  currentTime = 0,
  wasPlaying = false,
  extras: { shuffle?: boolean; unshuffledQueue?: Track[] | null } = {},
) {
  localStorage.setItem("listen-player-state", JSON.stringify({
    queue,
    currentIndex,
    currentTime,
    wasPlaying,
    shuffle: extras.shuffle ?? false,
    unshuffledQueue: extras.unshuffledQueue ?? null,
  }));
}

interface TestOptions {
  queue?: Track[];
  isPlaying?: boolean;
  repeat?: RepeatMode;
}

function createOptions(opts: TestOptions = {}) {
  return {
    isPlayingRef: { current: opts.isPlaying ?? false } as MutableRefObject<boolean>,
    queueRef: { current: opts.queue ?? [] } as MutableRefObject<Track[]>,
    repeatRef: { current: opts.repeat ?? "off" as RepeatMode } as MutableRefObject<RepeatMode>,
    bufferingIntentRef: { current: false } as MutableRefObject<boolean>,
    buildEngineUrls: vi.fn((tracks: Track[]) => tracks.map((t) => `/stream/${t.id}`)),
    pullFromEngine: vi.fn(),
    commitIsBuffering: vi.fn(),
    commitCurrentTime: vi.fn(),
    markSeekPosition: vi.fn(),
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  Object.values(gaplessPlayer).forEach((fn) => {
    if (typeof fn === "function" && "mockClear" in fn) (fn as { mockClear: () => void }).mockClear();
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("useRestoreOnMount", () => {
  it("is a no-op when there's no stored queue", () => {
    const opts = createOptions();
    renderHook(() => useRestoreOnMount(opts));

    expect(mockLoadQueue).not.toHaveBeenCalled();
    expect(opts.pullFromEngine).not.toHaveBeenCalled();
  });

  it("loads the stored queue into the engine on mount", () => {
    setStored([TRACK_A, TRACK_B], 1);
    const opts = createOptions();

    renderHook(() => useRestoreOnMount(opts));

    expect(opts.buildEngineUrls).toHaveBeenCalledWith([TRACK_A, TRACK_B]);
    expect(mockLoadQueue).toHaveBeenCalledWith(["/stream/a", "/stream/b"], 1);
    expect(opts.pullFromEngine).toHaveBeenCalledWith([TRACK_A, TRACK_B]);
  });

  it("seeks to stored position and reflects it in React state", () => {
    setStored([TRACK_A], 0, 42);
    const opts = createOptions();

    renderHook(() => useRestoreOnMount(opts));

    expect(mockSeekTo).toHaveBeenCalledWith(42_000);
    expect(opts.commitCurrentTime).toHaveBeenCalledWith(42);
    expect(opts.markSeekPosition).toHaveBeenCalledWith(42);
  });

  it("exposes pendingRestoreTimeRef with the stored position", () => {
    setStored([TRACK_A], 0, 17);
    const opts = createOptions();

    const { result } = renderHook(() => useRestoreOnMount(opts));
    expect(result.current.pendingRestoreTimeRef.current).toBe(17);
  });

  it("exposes resumeAfterReloadRef matching wasPlaying", () => {
    setStored([TRACK_A], 0, 0, true);
    const opts = createOptions();

    const { result } = renderHook(() => useRestoreOnMount(opts));
    expect(result.current.resumeAfterReloadRef.current).toBe(true);
  });

  it("tryRestoreAutoplay is a no-op when wasPlaying=false", () => {
    setStored([TRACK_A], 0, 0, false);
    const opts = createOptions({ queue: [TRACK_A] });

    const { result } = renderHook(() => useRestoreOnMount(opts));

    act(() => { result.current.tryRestoreAutoplay(); });
    expect(mockFadeInAndPlay).not.toHaveBeenCalled();
  });

  it("tryRestoreAutoplay fires once when wasPlaying=true", () => {
    setStored([TRACK_A], 0, 0, true);
    const opts = createOptions({ queue: [TRACK_A] });

    const { result } = renderHook(() => useRestoreOnMount(opts));

    act(() => { result.current.tryRestoreAutoplay(); });
    expect(mockFadeInAndPlay).toHaveBeenCalledTimes(1);

    // Second call should not re-trigger.
    act(() => { result.current.tryRestoreAutoplay(); });
    expect(mockFadeInAndPlay).toHaveBeenCalledTimes(1);
  });

  it("tryRestoreAutoplay gives up after timeout if isPlaying never flips", async () => {
    setStored([TRACK_A], 0, 0, true);
    const opts = createOptions({ queue: [TRACK_A] });

    const { result } = renderHook(() => useRestoreOnMount(opts));

    act(() => { result.current.tryRestoreAutoplay(); });
    expect(opts.commitIsBuffering).toHaveBeenCalledWith(true);

    // Advance past the 2.5s safety timeout with isPlayingRef still false.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    expect(opts.commitIsBuffering).toHaveBeenCalledWith(false);
    expect(result.current.resumeAfterReloadRef.current).toBe(false);
  });

  it("cancelRestoreAutoplay cancels a pending timeout", async () => {
    setStored([TRACK_A], 0, 0, true);
    const opts = createOptions({ queue: [TRACK_A] });

    const { result } = renderHook(() => useRestoreOnMount(opts));

    act(() => { result.current.tryRestoreAutoplay(); });
    const beforeCalls = opts.commitIsBuffering.mock.calls.length;

    act(() => { result.current.cancelRestoreAutoplay(); });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // commitIsBuffering should not have been called again after cancel.
    expect(opts.commitIsBuffering.mock.calls.length).toBe(beforeCalls);
  });

  it("sets the loop/single mode flags based on repeat", () => {
    setStored([TRACK_A], 0, 0, false);
    const opts = createOptions({ repeat: "all" });

    renderHook(() => useRestoreOnMount(opts));

    expect(gaplessPlayer.setLoop).toHaveBeenCalledWith(true);
    expect(gaplessPlayer.setSingleMode).toHaveBeenCalledWith(false);
  });

  it("exposes restoredShuffle=false for sessions that didn't persist shuffle", () => {
    setStored([TRACK_A], 0, 0, false);
    const opts = createOptions();

    const { result } = renderHook(() => useRestoreOnMount(opts));
    expect(result.current.restoredShuffle).toBe(false);
    expect(result.current.restoredUnshuffledQueue).toBeNull();
  });

  it("exposes restoredShuffle + restoredUnshuffledQueue when shuffle was active", () => {
    const unshuffled = [TRACK_A, TRACK_B];
    // Persisted queue is shuffled order [B, A]; original was [A, B].
    setStored([TRACK_B, TRACK_A], 0, 0, false, {
      shuffle: true,
      unshuffledQueue: unshuffled,
    });
    const opts = createOptions();

    const { result } = renderHook(() => useRestoreOnMount(opts));
    expect(result.current.restoredShuffle).toBe(true);
    expect(result.current.restoredUnshuffledQueue).toEqual(unshuffled);
  });

  it("is tolerant to legacy stored sessions missing shuffle fields", () => {
    // Simulate a session persisted by an older version of the app.
    localStorage.setItem("listen-player-state", JSON.stringify({
      queue: [TRACK_A], currentIndex: 0, currentTime: 0, wasPlaying: false,
    }));
    const opts = createOptions();

    const { result } = renderHook(() => useRestoreOnMount(opts));
    expect(result.current.restoredShuffle).toBe(false);
    expect(result.current.restoredUnshuffledQueue).toBeNull();
  });
});
