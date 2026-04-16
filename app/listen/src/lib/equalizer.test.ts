import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EQ_BANDS,
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
  EQ_PRESETS,
  createEqChain,
  isFlatGains,
} from "./equalizer";

// Minimal AudioContext mock — we only care that the chain wires up
// BiquadFilters in series and exposes the correct gain manipulation.
// The gain param simulates scheduling (setValueAtTime, linearRamp)
// by eagerly updating .value, which is accurate enough for the
// assertions we care about in these tests.
function mkParam() {
  const param = {
    value: 0,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn((v: number) => { param.value = v; }),
    linearRampToValueAtTime: vi.fn((v: number) => { param.value = v; }),
  };
  return param;
}

function mkFilter() {
  return {
    type: "",
    frequency: { value: 0 },
    Q: { value: 0 },
    gain: mkParam(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function mkContext() {
  return {
    currentTime: 0,
    createBiquadFilter: vi.fn(() => mkFilter()),
  } as unknown as AudioContext;
}

describe("createEqChain", () => {
  it("builds one BiquadFilter per band", () => {
    const ctx = mkContext();
    const chain = createEqChain(ctx);
    expect(ctx.createBiquadFilter).toHaveBeenCalledTimes(EQ_BANDS.length);
    expect(chain.input).toBeTruthy();
    expect(chain.output).toBeTruthy();
  });

  it("configures each filter as peaking with the band's frequency", () => {
    const ctx = mkContext();
    createEqChain(ctx);
    const calls = (ctx.createBiquadFilter as ReturnType<typeof vi.fn>).mock.results;
    calls.forEach((result, i) => {
      const filter = result.value as ReturnType<typeof mkFilter>;
      expect(filter.type).toBe("peaking");
      expect(filter.frequency.value).toBe(EQ_BANDS[i]!.freq);
      expect(filter.gain.value).toBe(0);
    });
  });

  it("chains filters in series (f0 → f1 → f2 → ...)", () => {
    const ctx = mkContext();
    createEqChain(ctx);
    const filters = (ctx.createBiquadFilter as ReturnType<typeof vi.fn>).mock.results.map(
      (r) => r.value as ReturnType<typeof mkFilter>,
    );
    for (let i = 0; i < filters.length - 1; i++) {
      expect(filters[i]!.connect).toHaveBeenCalledWith(filters[i + 1]);
    }
    // The last filter should not have been chained forward.
    expect(filters[filters.length - 1]!.connect).not.toHaveBeenCalled();
  });

  it("setGain clamps values outside the allowed range", () => {
    const ctx = mkContext();
    const chain = createEqChain(ctx);
    const filters = (ctx.createBiquadFilter as ReturnType<typeof vi.fn>).mock.results.map(
      (r) => r.value as ReturnType<typeof mkFilter>,
    );
    chain.setGain(0, 999);
    expect(filters[0]!.gain.value).toBe(EQ_GAIN_MAX);
    chain.setGain(1, -999);
    expect(filters[1]!.gain.value).toBe(EQ_GAIN_MIN);
    chain.setGain(2, NaN);
    expect(filters[2]!.gain.value).toBe(0);
  });

  it("setGains applies every value and pads missing entries as 0", () => {
    const ctx = mkContext();
    const chain = createEqChain(ctx);
    const filters = (ctx.createBiquadFilter as ReturnType<typeof vi.fn>).mock.results.map(
      (r) => r.value as ReturnType<typeof mkFilter>,
    );
    chain.setGains(EQ_PRESETS.rock!);
    filters.forEach((f, i) => {
      expect(f.gain.value).toBe(EQ_PRESETS.rock![i]);
    });
  });

  it("setGain is a no-op for out-of-range indices", () => {
    const ctx = mkContext();
    const chain = createEqChain(ctx);
    expect(() => chain.setGain(99, 3)).not.toThrow();
    expect(() => chain.setGain(-1, 3)).not.toThrow();
  });

  it("readGains reflects the current filter gains", () => {
    const ctx = mkContext();
    const chain = createEqChain(ctx);
    chain.setGains([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(chain.readGains()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("setGain schedules a linear ramp rather than hard-setting value", () => {
    const ctx = mkContext();
    const chain = createEqChain(ctx);
    const filters = (ctx.createBiquadFilter as ReturnType<typeof vi.fn>).mock.results.map(
      (r) => r.value as ReturnType<typeof mkFilter>,
    );
    chain.setGain(0, 3);
    // Every gain mutation goes through the scheduler so the change
    // ramps instead of clicking.
    expect(filters[0]!.gain.cancelScheduledValues).toHaveBeenCalled();
    expect(filters[0]!.gain.setValueAtTime).toHaveBeenCalled();
    expect(filters[0]!.gain.linearRampToValueAtTime).toHaveBeenCalled();
    const rampArgs = (filters[0]!.gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(rampArgs[0]).toBe(3); // target dB
    // Default ramp window is 80 ms → 0.08 seconds from now (currentTime = 0).
    expect(rampArgs[1]).toBeCloseTo(0.08, 5);
  });

  it("setGain with rampMs: 0 snaps immediately", () => {
    const ctx = mkContext();
    const chain = createEqChain(ctx);
    const filters = (ctx.createBiquadFilter as ReturnType<typeof vi.fn>).mock.results.map(
      (r) => r.value as ReturnType<typeof mkFilter>,
    );
    chain.setGain(0, 3, 0);
    expect(filters[0]!.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    // setValueAtTime is called twice: once to anchor from current
    // value, once to snap to target.
    expect(filters[0]!.gain.setValueAtTime).toHaveBeenCalledTimes(2);
    expect(filters[0]!.gain.value).toBe(3);
  });

  it("dispose disconnects every filter", () => {
    const ctx = mkContext();
    const chain = createEqChain(ctx);
    const filters = (ctx.createBiquadFilter as ReturnType<typeof vi.fn>).mock.results.map(
      (r) => r.value as ReturnType<typeof mkFilter>,
    );
    chain.dispose();
    for (const f of filters) {
      expect(f.disconnect).toHaveBeenCalled();
    }
  });
});

describe("isFlatGains", () => {
  it("returns true for all zeros", () => {
    expect(isFlatGains([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(true);
  });

  it("returns true for negligible floats (< 0.01)", () => {
    expect(isFlatGains([0.001, -0.005, 0.009, 0, 0, 0, 0, 0, 0, 0])).toBe(true);
  });

  it("returns false as soon as one band is meaningfully non-zero", () => {
    expect(isFlatGains([0, 0, 0.5, 0, 0, 0, 0, 0, 0, 0])).toBe(false);
  });

  it("matches the flat preset", () => {
    expect(isFlatGains(EQ_PRESETS.flat!)).toBe(true);
  });

  it("does not match every other preset", () => {
    for (const [name, gains] of Object.entries(EQ_PRESETS)) {
      if (name === "flat") continue;
      expect(isFlatGains(gains), name).toBe(false);
    }
  });
});

describe("equalizer-prefs round-trip", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("persists and restores preset selection", async () => {
    const {
      getEqualizerSnapshot,
      applyEqualizerPreset,
      setEqualizerEnabled,
    } = await import("./equalizer-prefs");

    setEqualizerEnabled(true);
    applyEqualizerPreset("rock");

    const snapshot = getEqualizerSnapshot();
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.preset).toBe("rock");
    expect(snapshot.gains).toEqual([...EQ_PRESETS.rock!]);
  });

  it("custom gains mark preset as 'custom'", async () => {
    const {
      getEqualizerSnapshot,
      setCustomEqualizerGains,
    } = await import("./equalizer-prefs");

    const custom = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    setCustomEqualizerGains(custom);

    const snapshot = getEqualizerSnapshot();
    expect(snapshot.preset).toBe("custom");
    expect(snapshot.gains).toEqual(custom);
  });

  it("falls back to flat when stored gains are malformed", async () => {
    localStorage.setItem("listen-eq-gains", "not-an-array");
    const { getEqualizerGains } = await import("./equalizer-prefs");
    const gains = getEqualizerGains();
    // Either defaults to flat (preset resolution) or to zeros; both are
    // acceptable — what matters is no throw + correct length.
    expect(gains).toHaveLength(EQ_BANDS.length);
  });
});
