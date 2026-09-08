import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthUser } from "@/contexts/auth-context";
import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import { usePlayerConnectState } from "./use-player-connect-state";

const { connectEnabled, publishStructuralNow } = vi.hoisted(() => ({
  connectEnabled: vi.fn(() => true),
  publishStructuralNow: vi.fn(async () => undefined),
}));

vi.mock("@/hooks/use-crate-connect-enabled", () => ({
  useCrateConnectEnabled: connectEnabled,
}));

vi.mock("@/contexts/use-player-auth-sync", () => ({
  usePlayerAuthSync: vi.fn(),
}));

vi.mock("@/contexts/use-remote-playback-state", () => ({
  useRemotePlaybackState: vi.fn(() => ({ publishStructuralNow })),
}));

const user: AuthUser = {
  id: 1,
  email: "user@example.com",
  name: "User",
  role: "user",
};

const track: Track = {
  id: "track-1",
  title: "Track one",
  artist: "Artist one",
};

function createOptions() {
  return {
    authUser: user,
    currentTrack: track,
    isPlaying: true,
    queue: [track],
    currentIndex: 0,
    shuffle: false,
    repeat: "off" as RepeatMode,
    playSource: { type: "track", name: track.title } as PlaySource,
    queueRef: { current: [track] },
    currentIndexRef: { current: 0 },
    currentTimeRef: { current: 12 },
    durationRef: { current: 180 },
    isPlayingRef: { current: true },
    shuffleRef: { current: false },
    repeatRef: { current: "off" as RepeatMode },
    playSourceRef: { current: null as PlaySource | null },
    unshuffledQueueRef: { current: null as Track[] | null },
  };
}

describe("usePlayerConnectState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes through the enabled transport and exposes the v2 mode", async () => {
    const { result } = renderHook(() => usePlayerConnectState(createOptions()));

    expect(result.current.connectEnabled).toBe(true);
    expect(result.current.connectV2Enabled).toBe(true);
    expect(result.current.connectV1Enabled).toBe(false);

    await act(async () => {
      await result.current.publishConnectState({ claimActive: true });
    });

    expect(result.current.connectV2PublishRef.current).toBeNull();
    expect(publishStructuralNow).not.toHaveBeenCalled();
  });
});
