import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  useJamSessionPlayerRefs,
  type JamSessionPlayerActions,
} from "@/hooks/use-jam-session-player-refs";

function createActions(
  overrides: Partial<JamSessionPlayerActions> = {},
): JamSessionPlayerActions {
  return {
    play: vi.fn(),
    playAll: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    seek: vi.fn(),
    setPlaybackRate: vi.fn(),
    syncJamQueue: vi.fn(),
    currentTrack: undefined,
    playSource: null,
    isPlaying: false,
    ...overrides,
  };
}

describe("useJamSessionPlayerRefs", () => {
  it("keeps the latest player snapshot available to asynchronous effects", () => {
    const firstActions = createActions();
    const nextActions = createActions({ isPlaying: true });
    const { result, rerender } = renderHook(
      ({ actions, currentTime }) =>
        useJamSessionPlayerRefs({ actions, currentTime }),
      {
        initialProps: { actions: firstActions, currentTime: 12 },
      },
    );

    expect(result.current.currentTimeRef.current).toBe(12);
    expect(result.current.playerActionsRef.current.isPlaying).toBe(false);

    rerender({ actions: nextActions, currentTime: 18 });

    expect(result.current.currentTimeRef.current).toBe(18);
    expect(result.current.playerActionsRef.current.isPlaying).toBe(true);
  });
});
