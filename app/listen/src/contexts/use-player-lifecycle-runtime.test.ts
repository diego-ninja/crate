import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTH_RUNTIME_RESET_EVENT } from "@/contexts/auth-runtime";
import { PLAYBACK_NEEDS_USER_GESTURE_EVENT } from "@/contexts/use-soft-interruption";

import { usePlayerLifecycleRuntime } from "./use-player-lifecycle-runtime";

describe("usePlayerLifecycleRuntime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes a resume action after an autoplay gesture is requested", () => {
    const resume = vi.fn();
    const { result } = renderHook(() =>
      usePlayerLifecycleRuntime({
        clearQueueRef: { current: vi.fn() },
        clearTransferPlaybackGuard: vi.fn(),
        currentTrack: undefined,
        isPlaying: false,
        resume,
      }),
    );

    act(() => {
      window.dispatchEvent(new CustomEvent(PLAYBACK_NEEDS_USER_GESTURE_EVENT));
    });

    expect(result.current.playbackNeedsUserGesture).toBe(true);

    act(() => {
      result.current.resumeAfterUserGesture();
    });

    expect(result.current.playbackNeedsUserGesture).toBe(false);
    expect(resume).toHaveBeenCalledOnce();
  });

  it("clears the gesture prompt when playback becomes active or has no track", () => {
    const { result, rerender } = renderHook(
      ({ currentTrack, isPlaying }) =>
        usePlayerLifecycleRuntime({
          clearQueueRef: { current: vi.fn() },
          clearTransferPlaybackGuard: vi.fn(),
          currentTrack,
          isPlaying,
          resume: vi.fn(),
        }),
      {
        initialProps: {
          currentTrack: undefined,
          isPlaying: false,
        },
      },
    );

    act(() => {
      window.dispatchEvent(new CustomEvent(PLAYBACK_NEEDS_USER_GESTURE_EVENT));
    });
    expect(result.current.playbackNeedsUserGesture).toBe(true);

    rerender({ currentTrack: undefined, isPlaying: true });
    expect(result.current.playbackNeedsUserGesture).toBe(false);

    act(() => {
      window.dispatchEvent(new CustomEvent(PLAYBACK_NEEDS_USER_GESTURE_EVENT));
    });
    rerender({ currentTrack: undefined, isPlaying: false });
    expect(result.current.playbackNeedsUserGesture).toBe(false);
  });

  it("forwards auth reset events to the queue ref", () => {
    const clearQueue = vi.fn();
    renderHook(() =>
      usePlayerLifecycleRuntime({
        clearQueueRef: { current: clearQueue },
        clearTransferPlaybackGuard: vi.fn(),
        currentTrack: undefined,
        isPlaying: false,
        resume: vi.fn(),
      }),
    );

    act(() => {
      window.dispatchEvent(new CustomEvent(AUTH_RUNTIME_RESET_EVENT));
    });

    expect(clearQueue).toHaveBeenCalledOnce();
  });
});
