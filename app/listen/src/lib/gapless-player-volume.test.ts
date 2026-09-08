import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  animateVolume,
  applyVolume,
  getAppliedVolume,
  getLastVolume,
  setLastVolume,
  setVolumeSink,
} from "./gapless-player-volume";

describe("gapless player volume controller", () => {
  let callbacks: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  beforeEach(() => {
    callbacks = new Map();
    nextFrameId = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      callbacks.delete(id);
    });
    setVolumeSink(null);
    setLastVolume(1);
  });

  afterEach(() => {
    setVolumeSink(null);
    vi.unstubAllGlobals();
  });

  it("clamps applied volume while preserving the user's requested volume", () => {
    const sink = vi.fn();
    setVolumeSink(sink);
    setLastVolume(1.25);

    applyVolume(-0.25);

    expect(getLastVolume()).toBe(1.25);
    expect(getAppliedVolume()).toBe(0);
    expect(sink).toHaveBeenLastCalledWith(0);
  });

  it("settles a previous fade when a new fade replaces it", () => {
    const sink = vi.fn();
    const firstDone = vi.fn();
    const secondDone = vi.fn();
    setVolumeSink(sink);

    animateVolume(1, 0, 100, firstDone);
    animateVolume(0, 1, 100, secondDone);

    expect(firstDone).toHaveBeenCalledTimes(1);
    expect(secondDone).not.toHaveBeenCalled();

    const activeFrame = [...callbacks.values()][0];
    activeFrame?.(performance.now() + 100);

    expect(secondDone).toHaveBeenCalledTimes(1);
    expect(getAppliedVolume()).toBe(1);
    expect(sink).toHaveBeenLastCalledWith(1);
  });

  it("applies the target immediately for a zero-duration fade", () => {
    const sink = vi.fn();
    const done = vi.fn();
    setVolumeSink(sink);

    animateVolume(1, 0.35, 0, done);

    expect(getAppliedVolume()).toBe(0.35);
    expect(sink).toHaveBeenLastCalledWith(0.35);
    expect(done).toHaveBeenCalledTimes(1);
    expect(callbacks.size).toBe(0);
  });
});
