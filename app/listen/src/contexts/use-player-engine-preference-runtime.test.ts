import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RepeatMode } from "@/contexts/player-types";
import { usePlayerEnginePreferenceRuntime } from "./use-player-engine-preference-runtime";

const { setLoop, setSingleMode, setVolume } = vi.hoisted(() => ({
  setLoop: vi.fn(),
  setSingleMode: vi.fn(),
  setVolume: vi.fn(),
}));

vi.mock("@/lib/gapless-player", () => ({
  setLoop,
  setSingleMode,
  setVolume,
}));

function createOptions() {
  return {
    playSource: null,
    repeat: "off" as RepeatMode,
    shuffle: false,
    smartCrossfadeEnabled: false,
    volume: 0.7,
    playSourceRef: { current: null },
    repeatRef: { current: "off" as const },
    shuffleRef: { current: false },
    smartCrossfadeEnabledRef: { current: false },
  };
}

describe("usePlayerEnginePreferenceRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mirrors React preferences into refs and configures the engine", () => {
    const options = createOptions();

    renderHook(() => usePlayerEnginePreferenceRuntime(options));

    expect(options.playSourceRef.current).toBeNull();
    expect(options.repeatRef.current).toBe("off");
    expect(options.shuffleRef.current).toBe(false);
    expect(options.smartCrossfadeEnabledRef.current).toBe(false);
    expect(setVolume).toHaveBeenCalledWith(0.7);
    expect(setLoop).toHaveBeenCalledWith(false);
    expect(setSingleMode).toHaveBeenCalledWith(false);
  });

  it("updates repeat engine modes without changing shuffle behavior", () => {
    const options = createOptions();
    const { rerender } = renderHook(
      ({ repeat }) => usePlayerEnginePreferenceRuntime({ ...options, repeat }),
      { initialProps: { repeat: "off" as RepeatMode } },
    );

    rerender({ repeat: "one" });

    expect(options.repeatRef.current).toBe("one");
    expect(setLoop).toHaveBeenLastCalledWith(false);
    expect(setSingleMode).toHaveBeenLastCalledWith(true);
  });
});
