import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockGetAnalyserNode } = vi.hoisted(() => ({
  mockGetAnalyserNode: vi.fn(),
}));

vi.mock("@/lib/gapless-player", () => ({
  getAnalyserNode: mockGetAnalyserNode,
}));

import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";

function createAnalyser(): AnalyserNode {
  return {
    fftSize: 8,
    frequencyBinCount: 4,
    smoothingTimeConstant: 0.8,
    minDecibels: -100,
    maxDecibels: -30,
    context: { sampleRate: 48_000 } as BaseAudioContext,
    getFloatFrequencyData: vi.fn((data: Float32Array) => {
      data.fill(-24);
    }),
    getByteTimeDomainData: vi.fn((data: Uint8Array) => {
      data.fill(128);
    }),
  } as unknown as AnalyserNode;
}

describe("useAudioVisualizer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("clears frames from the previous track before sampling the next one", () => {
    const analyser = createAnalyser();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;

    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
    mockGetAnalyserNode.mockReturnValue(analyser);

    const { result, rerender } = renderHook(
      ({ trackKey }: { trackKey: string }) =>
        useAudioVisualizer(true, trackKey),
      { initialProps: { trackKey: "track-one" } },
    );

    act(() => {
      for (let index = 0; index < 3; index++) {
        const frame = frames.values().next().value as FrameRequestCallback;
        frame(0);
      }
    });
    expect(result.current.frequenciesDb).toHaveLength(4);

    rerender({ trackKey: "track-two" });

    expect(result.current.frequenciesDb).toEqual([]);
    expect(result.current.waveform).toEqual([]);
  });

  it("pauses sampling while the document is hidden and resumes when visible", () => {
    const analyser = createAnalyser();
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    mockGetAnalyserNode.mockReturnValue(analyser);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    renderHook(() => useAudioVisualizer(true, "track-one"));
    expect(requestAnimationFrame).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it("does not start sampling when reduced motion is preferred", () => {
    const analyser = createAnalyser();
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    mockGetAnalyserNode.mockReturnValue(analyser);

    renderHook(() => useAudioVisualizer(true, "track-one"));

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
