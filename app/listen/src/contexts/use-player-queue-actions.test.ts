import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerQueueActions } from "@/contexts/use-player-queue-actions";
import type { Track } from "@/contexts/player-types";
import * as gaplessPlayer from "@/lib/gapless-player";

vi.mock("@/lib/gapless-player", () => ({
  addTrack: vi.fn(),
  fadeInAndPlay: vi.fn(),
  fadeOutAndPause: vi.fn(),
  getPosition: vi.fn(() => 0),
  gotoTrack: vi.fn(),
  insertTrack: vi.fn(),
  loadQueue: vi.fn(),
  next: vi.fn(),
  pause: vi.fn(),
  play: vi.fn(),
  removeTrack: vi.fn(),
  restoreVolume: vi.fn(),
  seekTo: vi.fn(),
  setLoop: vi.fn(),
  setSingleMode: vi.fn(),
  setVolume: vi.fn(),
}));

const TRACK: Track = {
  id: "track-1",
  title: "Track One",
  artist: "Artist",
  album: "Album",
  path: "/music/Artist/Album/01-track.flac",
};

function createParams() {
  return {
    queueRef: { current: [] as Track[] },
    currentIndexRef: { current: 0 },
    currentTimeRef: { current: 0 },
    isPlayingRef: { current: false },
    repeatRef: { current: "off" as const },
    shuffleRef: { current: false },
    playSourceRef: { current: null },
    unshuffledQueueRef: { current: null as Track[] | null },
    bufferingIntentRef: { current: false },
    pendingRestoreTimeRef: { current: 0 },
    resumeAfterReloadRef: { current: false },
    lastNonZeroVolumeRef: { current: 1 },
    prevRestartTrackKeyRef: { current: null as string | null },
    prevRestartedAtRef: { current: 0 },
    activatedTrackKeyRef: { current: null as string | null },
    setPlaySource: vi.fn(),
    setShuffleState: vi.fn(),
    setRepeatState: vi.fn(),
    setVolumeState: vi.fn(),
    buildEngineUrls: vi.fn((tracks: Track[]) => tracks.map((track) => track.path || track.id)),
    registerEngineTrack: vi.fn((track: Track) => track.path || track.id),
    unregisterEngineTrack: vi.fn(),
    resetEngineTrackMap: vi.fn(),
    rememberActiveTrack: vi.fn(),
    startTrackerSession: vi.fn(),
    flushCurrentPlayEvent: vi.fn(),
    markSeekPosition: vi.fn(),
    cancelSoftInterruption: vi.fn(),
    cancelRestoreAutoplay: vi.fn(),
    resetPlaybackIntelligence: vi.fn(),
    continueInfinitePlayback: vi.fn(() => false),
    clearPrevRestartLatch: vi.fn(),
    commitQueue: vi.fn(),
    commitCurrentIndex: vi.fn(),
    commitCurrentTime: vi.fn(),
    commitDuration: vi.fn(),
    commitIsPlaying: vi.fn(),
    commitIsBuffering: vi.fn(),
    pullFromEngine: vi.fn(() => ({ resolvedTrack: TRACK })),
    pushToEngine: vi.fn(),
    advanceCursorTo: vi.fn(),
    playbackDeliveryPolicy: "original" as const,
  };
}

describe("usePlayerQueueActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("forces a restart when playAll is invoked for the same queue/index", () => {
    const params = createParams();
    params.queueRef.current = [TRACK];
    params.currentIndexRef.current = 0;
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.playAll([TRACK], 0, { type: "album", name: "Album" });

    expect(gaplessPlayer.loadQueue).toHaveBeenCalledWith(
      ["/music/Artist/Album/01-track.flac"],
      0,
      { restartIfSameIndex: true },
    );
    expect(params.commitIsBuffering).toHaveBeenCalledWith(false);
    expect(gaplessPlayer.play).toHaveBeenCalledTimes(1);
  });

  it("pauses immediately when the app is hidden", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    const params = createParams();
    params.queueRef.current = [TRACK];
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.pause();

    expect(gaplessPlayer.pause).toHaveBeenCalledTimes(1);
    expect(gaplessPlayer.fadeOutAndPause).not.toHaveBeenCalled();
  });

  it("resumes immediately when the app is hidden", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    const params = createParams();
    params.queueRef.current = [TRACK];
    const { result } = renderHook(() => usePlayerQueueActions(params));

    result.current.resume();

    expect(gaplessPlayer.restoreVolume).toHaveBeenCalledTimes(1);
    expect(gaplessPlayer.play).toHaveBeenCalledTimes(1);
    expect(gaplessPlayer.fadeInAndPlay).not.toHaveBeenCalled();
  });
});
