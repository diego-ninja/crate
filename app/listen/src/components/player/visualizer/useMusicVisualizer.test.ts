import { render } from "@testing-library/react";
import { createElement, Fragment, useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  analyser,
  createAnalyserNodeMock,
  getAnalyserNodeMock,
  musicVisualizerMock,
  visualizer,
} = vi.hoisted(() => {
  const visualizer = {
    setAnalyser: vi.fn(),
    setMode: vi.fn(),
    setSize: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };

  return {
    analyser: {} as AnalyserNode,
    createAnalyserNodeMock: vi.fn(),
    getAnalyserNodeMock: vi.fn(),
    musicVisualizerMock: vi.fn(function MusicVisualizerMock() {
      return visualizer;
    }),
    visualizer,
  };
});

vi.mock("./MusicVisualizer", () => ({
  MusicVisualizer: musicVisualizerMock,
}));

vi.mock("@/hooks/use-audio-visualizer", () => ({
  createAnalyserNode: createAnalyserNodeMock,
}));

vi.mock("@/lib/gapless-player", () => ({
  getAnalyserNode: getAnalyserNodeMock,
}));

import { useMusicVisualizer } from "./useMusicVisualizer";

function VisualizerHarness({ children }: { children?: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useMusicVisualizer(canvasRef, "track-1", true, {
    volume: 1,
    isPlaying: true,
  });

  return createElement(
    Fragment,
    null,
    createElement("canvas", { ref: canvasRef }),
    children,
  );
}

describe("useMusicVisualizer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createAnalyserNodeMock.mockReturnValue(analyser);
    getAnalyserNodeMock.mockReturnValue(analyser);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("cancels delayed visualizer work when the canvas unmounts", () => {
    const { unmount } = render(createElement(VisualizerHarness));
    const canvas = document.querySelector("canvas")!;
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 180 },
    });

    vi.advanceTimersByTime(50);

    expect(musicVisualizerMock).toHaveBeenCalledTimes(1);
    expect(visualizer.start).toHaveBeenCalledTimes(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
