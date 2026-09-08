import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Track } from "@/contexts/player-types";

import { usePlayerPlatformIntegrations } from "./use-player-platform-integrations";

const {
  useDesktopTrayCommands,
  useDesktopTrayNowPlaying,
  useMediaSession,
  usePlayerShortcuts,
} = vi.hoisted(() => ({
  useDesktopTrayCommands: vi.fn(),
  useDesktopTrayNowPlaying: vi.fn(),
  useMediaSession: vi.fn(),
  usePlayerShortcuts: vi.fn(),
}));

vi.mock("./use-desktop-tray-commands", () => ({
  useDesktopTrayCommands,
  useDesktopTrayNowPlaying,
}));
vi.mock("./use-media-session", () => ({ useMediaSession }));
vi.mock("./use-player-shortcuts", () => ({ usePlayerShortcuts }));

function createTrack(): Track {
  return {
    album: "Album",
    albumCover: "cover.jpg",
    artist: "Artist",
    duration: 180,
    id: "track-1",
    path: "track.mp3",
    title: "Track",
  };
}

describe("usePlayerPlatformIntegrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wires player state and actions to platform integrations", () => {
    const actions = {
      next: vi.fn(),
      pause: vi.fn(),
      prev: vi.fn(),
      resume: vi.fn(),
      seek: vi.fn(),
      setVolume: vi.fn(),
    };
    const isPlayingRef = { current: true };
    const currentTrack = createTrack();

    renderHook(() =>
      usePlayerPlatformIntegrations({
        ...actions,
        currentTime: 12,
        currentTrack,
        duration: 180,
        isPlaying: true,
        isPlayingRef,
        lastNonZeroVolume: 0.8,
        volume: 0.5,
      }),
    );

    expect(usePlayerShortcuts).toHaveBeenCalledWith({
      currentTime: 12,
      duration: 180,
      hasCurrentTrack: true,
      isPlaying: true,
      lastNonZeroVolume: 0.8,
      next: actions.next,
      pause: actions.pause,
      prev: actions.prev,
      resume: actions.resume,
      seek: actions.seek,
      setVolume: actions.setVolume,
      volume: 0.5,
    });
    expect(useDesktopTrayCommands).toHaveBeenCalledWith({
      isPlayingRef,
      next: actions.next,
      pause: actions.pause,
      previous: actions.prev,
      resume: actions.resume,
    });
    expect(useDesktopTrayNowPlaying).toHaveBeenCalledWith({
      currentTrack,
      isPlaying: true,
    });
    expect(useMediaSession).toHaveBeenCalledWith({
      currentTime: 12,
      currentTrack,
      duration: 180,
      isPlaying: true,
      next: actions.next,
      pause: actions.pause,
      prev: actions.prev,
      resume: actions.resume,
      seek: actions.seek,
    });
  });
});
