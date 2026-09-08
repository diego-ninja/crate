import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PlaySource, Track } from "@/contexts/player-types";
import { useJamQueueSession } from "./use-jam-queue-session";

const FIRST: Track = { id: "first", title: "First", artist: "Artist" };
const SECOND: Track = { id: "second", title: "Second", artist: "Artist" };

function createOptions() {
  const queueRef = { current: [FIRST, SECOND] };
  const jamQueueLockedRef = { current: false };
  const options = {
    commitCurrentTime: vi.fn(),
    commitJamQueueLocked: vi.fn((locked: boolean) => {
      jamQueueLockedRef.current = locked;
    }),
    currentIndexRef: { current: 1 },
    currentTimeRef: { current: 42 },
    ensureJamQueueLockedRef: {
      current: null as (() => void) | null,
    },
    isPlayingRef: { current: true },
    jamQueueLockedRef,
    playSourceRef: {
      current: { type: "album", name: "Original" } as PlaySource,
    },
    pushToEngine: vi.fn(),
    queueRef,
    repeatRef: { current: "all" as const },
    setPlaySource: vi.fn(),
    setRepeatState: vi.fn(),
    setShuffleState: vi.fn(),
    shuffleRef: { current: true },
    unshuffledQueueRef: { current: [FIRST, SECOND] },
  };
  return options;
}

describe("useJamQueueSession", () => {
  it("captures and restores the playback snapshot around a Jam session", () => {
    const options = createOptions();
    const { result } = renderHook(() => useJamQueueSession(options));

    act(() => options.ensureJamQueueLockedRef.current?.());
    expect(options.commitJamQueueLocked).toHaveBeenCalledWith(true);

    options.queueRef.current = [SECOND];
    options.currentIndexRef.current = 0;
    options.currentTimeRef.current = 3;

    act(() => result.current.leaveJamSession());

    expect(options.pushToEngine).toHaveBeenCalledWith([FIRST, SECOND], 1, {
      autoplay: true,
      positionMs: 42_000,
      preservePlayback: true,
    });
    expect(options.commitCurrentTime).toHaveBeenCalledWith(42);
    expect(options.commitJamQueueLocked).toHaveBeenLastCalledWith(false);
  });

  it("does not replace the queue when leaving without an active snapshot", () => {
    const options = createOptions();
    const { result } = renderHook(() => useJamQueueSession(options));

    act(() => result.current.leaveJamSession());

    expect(options.pushToEngine).not.toHaveBeenCalled();
    expect(options.commitJamQueueLocked).toHaveBeenCalledWith(false);
  });
});
