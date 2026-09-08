import { describe, expect, it, vi } from "vitest";

import type { AudioRecoveryController } from "./gapless-player-audio-recovery";
import { createGaplessPlayerControls } from "./gapless-player-controls";
import type { Gapless5 } from "@/lib/gapless5/gapless5";

function createPlayer() {
  return {
    currentLength: vi.fn(() => 180_000),
    getCurrentBufferedAheadSeconds: vi.fn(() => 7.5),
    getIndex: vi.fn(() => 1),
    getPosition: vi.fn(() => 42_000),
    getTrack: vi.fn(() => "/tracks/current.flac"),
    getTracks: vi.fn(() => ["/tracks/a.flac", "/tracks/b.flac"]),
    getVolume: vi.fn(),
    gotoTrack: vi.fn(),
    isShuffled: vi.fn(() => false),
    next: vi.fn(),
    pause: vi.fn(),
    prev: vi.fn(),
    play: vi.fn(),
    setCrossfade: vi.fn(),
    setPlaybackRate: vi.fn(),
    setPosition: vi.fn(),
    setVolume: vi.fn(),
    shuffle: vi.fn(),
    stop: vi.fn(),
    toggleShuffle: vi.fn(),
    loop: false,
    singleMode: false,
  };
}

function createControls() {
  const player = createPlayer();
  const typedPlayer = player as unknown as Gapless5;
  const prepare = vi.fn(async () => undefined);
  const host = {
    audioRecovery: {
      prepare,
    } as unknown as AudioRecoveryController,
    getAudioContext: vi.fn(() => null),
    getCrossfadeDurationMs: vi.fn(() => 4_000),
    getLastPlaybackRate: vi.fn(() => 1),
    getLastVolume: vi.fn(() => 0.8),
    getPlayer: vi.fn(() => typedPlayer),
    isTauriDesktopRuntime: vi.fn(() => false),
    setLastPlaybackRate: vi.fn(),
    setPlaybackActive: vi.fn(),
  };

  return { controls: createGaplessPlayerControls(host), host, player };
}

describe("gapless player controls", () => {
  it("delegates playback commands through the recovery boundary", async () => {
    const { controls, host, player } = createControls();

    await controls.play();
    controls.next();
    controls.gotoTrack(0, true);

    expect(host.audioRecovery.prepare).toHaveBeenCalledWith("play", {
      rebuildIfTauriOutputMayBeStale: true,
    });
    expect(host.audioRecovery.prepare).toHaveBeenCalledWith("next", {
      rebuildIfTauriOutputMayBeStale: true,
    });
    expect(host.audioRecovery.prepare).toHaveBeenCalledWith("gotoTrack", {
      rebuildIfTauriOutputMayBeStale: true,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.next).toHaveBeenCalledWith(undefined, true, true);
    expect(player.gotoTrack).toHaveBeenCalledWith(0, true);
  });

  it("keeps player state reads and playback settings behind the host", () => {
    const { controls, host, player } = createControls();

    expect(controls.getPosition()).toBe(42_000);
    expect(controls.getCurrentTrackDuration()).toBe(180_000);
    expect(controls.getCurrentTrackUrl()).toBe("/tracks/current.flac");
    expect(controls.getTrackIndex()).toBe(1);
    expect(controls.getTracks()).toEqual(["/tracks/a.flac", "/tracks/b.flac"]);
    expect(controls.getCurrentBufferedAheadSeconds()).toBe(7.5);

    controls.setPlaybackRate(1.5);
    controls.setCrossfadeDuration(1_250);

    expect(host.setLastPlaybackRate).toHaveBeenCalledWith(1.5);
    expect(player.setPlaybackRate).toHaveBeenCalledWith(1.5);
    expect(player.setCrossfade).toHaveBeenCalledWith(1_250);
  });
});
