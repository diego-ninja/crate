import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock gapless-player — the hook only touches these exports.
vi.mock("@/lib/gapless-player", () => ({
  fadeInAndPlay: vi.fn(() => Promise.resolve()),
  fadeOutAndPause: vi.fn(() => Promise.resolve()),
  getPosition: vi.fn(() => 0),
  play: vi.fn(),
  pause: vi.fn(),
  restoreVolume: vi.fn(),
  // Default: track is NOT fully buffered in RAM, so interruption paths
  // proceed normally. Tests that want to exercise the "fully buffered"
  // short-circuit override this per-case.
  isCurrentTrackFullyBuffered: vi.fn(() => false),
}));

// Mock capacitor online check while keeping the rest of the module shape
// intact for consumers that depend on isNative/platform helpers.
vi.mock(import("@/lib/capacitor"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isOnline: vi.fn(() => Promise.resolve(true)),
  };
});

import * as gaplessPlayer from "@/lib/gapless-player";
import * as capacitor from "@/lib/capacitor";
import { useSoftInterruption } from "./use-soft-interruption";
import type { MutableRefObject } from "react";
import type { Track } from "./player-types";

const mockFadeOutAndPause = vi.mocked(gaplessPlayer.fadeOutAndPause);
const mockGetPosition = vi.mocked(gaplessPlayer.getPosition);
const mockIsOnline = vi.mocked(capacitor.isOnline);
const globalFetch = global.fetch;

const TRACK: Track = { id: "t1", title: "Test", artist: "Artist" };

function createRefs(overrides: {
  currentTrack?: Track | undefined;
  isPlaying?: boolean;
  isBuffering?: boolean;
  bufferingIntent?: boolean;
} = {}) {
  const has = (k: keyof typeof overrides) => Object.prototype.hasOwnProperty.call(overrides, k);
  const refs = {
    currentTrackRef: {
      current: has("currentTrack") ? overrides.currentTrack : TRACK,
    } as MutableRefObject<Track | undefined>,
    isPlayingRef: { current: overrides.isPlaying ?? true } as MutableRefObject<boolean>,
    isBufferingRef: { current: overrides.isBuffering ?? false } as MutableRefObject<boolean>,
    bufferingIntentRef: { current: overrides.bufferingIntent ?? false } as MutableRefObject<boolean>,
    commitIsPlaying: vi.fn(),
    commitIsBuffering: vi.fn(),
  };
  return refs;
}

beforeEach(() => {
  vi.useFakeTimers();
  mockFadeOutAndPause.mockClear();
  mockGetPosition.mockReset();
  mockGetPosition.mockReturnValue(0);
  mockIsOnline.mockClear();
  mockIsOnline.mockResolvedValue(true);
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, body: null } as Response)) as typeof fetch;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  global.fetch = globalFetch;
  // Clear call histories first, then restore default behavior for
  // stateful mocks so each test starts with a clean slate.
  vi.clearAllMocks();
  vi.mocked(gaplessPlayer.isCurrentTrackFullyBuffered).mockReturnValue(false);
});

describe("useSoftInterruption", () => {
  it("exposes an initial not-interrupted state", () => {
    const refs = createRefs();
    const { result } = renderHook(() => useSoftInterruption(refs));
    expect(result.current.isSoftInterrupted()).toBe(false);
  });

  it("beginSoftInterruption pauses with fade when playing", async () => {
    const refs = createRefs({ isPlaying: true });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.beginSoftInterruption("stream");
    });

    expect(result.current.isSoftInterrupted()).toBe(true);
    expect(refs.commitIsBuffering).toHaveBeenCalledWith(true);
    expect(mockFadeOutAndPause).toHaveBeenCalled();
    expect(refs.bufferingIntentRef.current).toBe(false);
  });

  it("beginSoftInterruption hard-pauses when not playing", () => {
    const refs = createRefs({ isPlaying: false });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.beginSoftInterruption("offline");
    });

    expect(gaplessPlayer.pause).toHaveBeenCalled();
    expect(mockFadeOutAndPause).not.toHaveBeenCalled();
  });

  it("beginSoftInterruption is a no-op when there's no current track", () => {
    const refs = createRefs({ currentTrack: undefined });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.beginSoftInterruption("stream");
    });

    expect(result.current.isSoftInterrupted()).toBe(false);
    expect(refs.commitIsBuffering).not.toHaveBeenCalled();
  });

  it("cancelSoftInterruption resets state", () => {
    const refs = createRefs();
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => { result.current.beginSoftInterruption("stream"); });
    expect(result.current.isSoftInterrupted()).toBe(true);

    act(() => { result.current.cancelSoftInterruption(); });
    expect(result.current.isSoftInterrupted()).toBe(false);
  });

  it("requireUserGestureToResume stops automatic recovery and emits a resume event", () => {
    const refs = createRefs();
    const listener = vi.fn();
    window.addEventListener("crate:playback-needs-user-gesture", listener);
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => { result.current.beginSoftInterruption("stream"); });
    act(() => { result.current.requireUserGestureToResume(); });
    act(() => { vi.advanceTimersByTime(3100); });

    expect(listener).toHaveBeenCalledOnce();
    expect(refs.commitIsPlaying).toHaveBeenCalledWith(false);
    expect(refs.commitIsBuffering).toHaveBeenLastCalledWith(false);
    expect(gaplessPlayer.fadeInAndPlay).not.toHaveBeenCalled();

    window.removeEventListener("crate:playback-needs-user-gesture", listener);
  });

  it("upgrades stream interruption to offline if detected later", () => {
    const refs = createRefs();
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => { result.current.beginSoftInterruption("stream"); });
    act(() => { result.current.beginSoftInterruption("offline"); });

    // Both calls succeed; second call doesn't re-pause but does upgrade
    // the reason internally. We can't inspect the reason from outside,
    // but the state is still interrupted.
    expect(result.current.isSoftInterrupted()).toBe(true);
  });

  it("scheduleStallProtection arms a timer that triggers on stall", async () => {
    const refs = createRefs({ isPlaying: true });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => { result.current.scheduleStallProtection(); });
    expect(result.current.isSoftInterrupted()).toBe(false);

    // Fast-forward past STREAM_STALL_GRACE_MS (2500ms).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    expect(result.current.isSoftInterrupted()).toBe(true);
  });

  it("scheduleStallProtection skips when bufferingIntent is active", () => {
    const refs = createRefs({ isPlaying: true, bufferingIntent: true });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => { result.current.scheduleStallProtection(); });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.isSoftInterrupted()).toBe(false);
  });

  it("scheduleStallProtection skips when not playing", () => {
    const refs = createRefs({ isPlaying: false });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => { result.current.scheduleStallProtection(); });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.isSoftInterrupted()).toBe(false);
  });

  it("clearStallTimer cancels a pending stall", () => {
    const refs = createRefs({ isPlaying: true });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => { result.current.scheduleStallProtection(); });
    act(() => { result.current.clearStallTimer(); });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.isSoftInterrupted()).toBe(false);
  });

  it("responds to browser offline event while playing", async () => {
    const refs = createRefs({ isPlaying: true });
    renderHook(() => useSoftInterruption(refs));

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    // beginSoftInterruption is called, which triggers commitIsBuffering.
    expect(refs.commitIsBuffering).toHaveBeenCalledWith(true);
  });

  it("ignores offline event when not playing and not buffering", () => {
    const refs = createRefs({ isPlaying: false, isBuffering: false });
    renderHook(() => useSoftInterruption(refs));

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(refs.commitIsBuffering).not.toHaveBeenCalled();
  });

  it("does NOT pause on offline when the current track is fully buffered in RAM", () => {
    vi.mocked(gaplessPlayer.isCurrentTrackFullyBuffered).mockReturnValue(true);
    const refs = createRefs({ isPlaying: true });
    renderHook(() => useSoftInterruption(refs));

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    // No interruption triggered — audio keeps playing from RAM.
    expect(refs.commitIsBuffering).not.toHaveBeenCalled();
    expect(gaplessPlayer.fadeOutAndPause).not.toHaveBeenCalled();
    expect(gaplessPlayer.pause).not.toHaveBeenCalled();
  });

  it("beginSoftInterruption short-circuits when fully buffered", () => {
    vi.mocked(gaplessPlayer.isCurrentTrackFullyBuffered).mockReturnValue(true);
    const refs = createRefs({ isPlaying: true });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => { result.current.beginSoftInterruption("stream"); });

    expect(result.current.isSoftInterrupted()).toBe(false);
    expect(gaplessPlayer.fadeOutAndPause).not.toHaveBeenCalled();
    expect(refs.commitIsBuffering).not.toHaveBeenCalled();
  });

  it("cleans up timers on unmount", () => {
    const refs = createRefs({ isPlaying: true });
    const { result, unmount } = renderHook(() => useSoftInterruption(refs));

    act(() => { result.current.scheduleStallProtection(); });
    unmount();

    // After unmount, advancing timers should not invoke anything
    // — refs.commitIsBuffering stays at whatever it was.
    const before = refs.commitIsBuffering.mock.calls.length;
    act(() => { vi.advanceTimersByTime(5000); });
    expect(refs.commitIsBuffering.mock.calls.length).toBe(before);
  });

  it("retries playback after a background resume leaves playback stalled", async () => {
    const refs = createRefs({ isPlaying: true, isBuffering: true });
    mockGetPosition
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(10_000)
      .mockReturnValue(10_000);
    renderHook(() => useSoftInterruption(refs));

    act(() => {
      window.dispatchEvent(new CustomEvent("crate:app-paused"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
      window.dispatchEvent(new CustomEvent("crate:app-resumed"));
    });

    expect(gaplessPlayer.play).toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_600);
    });

    expect(refs.commitIsBuffering).toHaveBeenCalledWith(true);
    expect(mockFadeOutAndPause).toHaveBeenCalled();
  });
});
