import { beforeEach, describe, expect, it, vi } from "vitest";

const createEqChain = vi.hoisted(() => vi.fn());
const isFlatGains = vi.hoisted(() => vi.fn());

vi.mock("@/lib/equalizer", () => ({
  createEqChain,
  isFlatGains,
}));

import {
  getEqualizerState,
  resetEqualizer,
  setEqualizer,
  setEqualizerHost,
} from "./gapless-player-equalizer";

function createHost() {
  return {
    context: {} as AudioContext,
    setOutputChain: vi.fn(),
  };
}

function createChain() {
  return {
    input: { id: "input" },
    output: { id: "output" },
    setGains: vi.fn(),
    dispose: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isFlatGains.mockReturnValue(false);
  createEqChain.mockImplementation(() => createChain());
  resetEqualizer();
  setEqualizerHost(null);
});

describe("gapless player equalizer", () => {
  it("creates and updates a chain for non-flat enabled gains", () => {
    const host = createHost();
    const chain = createChain();
    createEqChain.mockReturnValue(chain);
    setEqualizerHost(host);

    setEqualizer(true, [3, 0, -2]);

    expect(createEqChain).toHaveBeenCalledWith(host.context);
    expect(host.setOutputChain).toHaveBeenCalledWith(chain.input, chain.output);
    expect(chain.setGains).toHaveBeenCalledWith([3, 0, -2]);
    expect(getEqualizerState()).toEqual({
      enabled: true,
      gains: [3, 0, -2],
    });
  });

  it("removes the chain when disabled or flat", () => {
    const host = createHost();
    const chain = createChain();
    createEqChain.mockReturnValue(chain);
    setEqualizerHost(host);
    setEqualizer(true, [3, 0, -2]);

    isFlatGains.mockReturnValue(true);
    setEqualizer(true, [0, 0, 0]);

    expect(host.setOutputChain).toHaveBeenLastCalledWith(null, null);
    expect(chain.dispose).toHaveBeenCalledTimes(1);
    expect(getEqualizerState()).toEqual({
      enabled: true,
      gains: [0, 0, 0],
    });
  });

  it("resets state and disposes the active chain", () => {
    const host = createHost();
    const chain = createChain();
    createEqChain.mockReturnValue(chain);
    setEqualizerHost(host);
    setEqualizer(true, [3, 0, -2]);

    resetEqualizer();

    expect(chain.dispose).toHaveBeenCalledTimes(1);
    expect(host.setOutputChain).toHaveBeenLastCalledWith(null, null);
    expect(getEqualizerState()).toEqual({ enabled: false, gains: [] });
  });
});
