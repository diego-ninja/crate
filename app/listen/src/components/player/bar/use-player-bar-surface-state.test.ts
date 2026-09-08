import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePlayerBarSurfaceState } from "./use-player-bar-surface-state";

vi.mock("@crate/ui/lib/use-dismissible-layer", () => ({
  useDismissibleLayer: vi.fn(),
}));

vi.mock("@/components/player/lazy-player-surfaces", () => ({
  preloadFullscreenPlayer: vi.fn(() => Promise.resolve()),
  preloadQueuePanel: vi.fn(() => Promise.resolve()),
}));

const createOptions = () => ({
  allowEqualizer: true,
  currentTrackAvailable: true,
  displayTrackAvailable: true,
  isDesktop: true,
  isRemoteConnectActive: false,
});

describe("usePlayerBarSurfaceState", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists fullscreen state and exposes independent surface state", () => {
    const { result } = renderHook(() =>
      usePlayerBarSurfaceState(createOptions()),
    );

    expect(result.current.fsOpen).toBe(false);
    expect(result.current.showQueue).toBe(false);
    expect(result.current.showLyrics).toBe(false);

    act(() => {
      result.current.setFsOpen(true);
      result.current.setShowQueue(true);
      result.current.setHasFloatingOverlayOpen(true);
    });

    expect(result.current.fsOpen).toBe(true);
    expect(result.current.showQueue).toBe(true);
    expect(result.current.hasFloatingOverlayOpen).toBe(true);
    expect(localStorage.getItem("listen-fs-player-open")).toBe("true");
  });

  it("closes open surfaces when native back is requested", () => {
    const { result } = renderHook(() =>
      usePlayerBarSurfaceState(createOptions()),
    );

    act(() => {
      result.current.setExtendedOpen(true);
      result.current.setShowQueue(true);
      result.current.setShowLyrics(true);
      result.current.setShowEqualizer(true);
      result.current.setHasFloatingOverlayOpen(true);
    });
    act(() => {
      window.dispatchEvent(new Event("crate:native-back"));
    });

    expect(result.current.extendedOpen).toBe(false);
    expect(result.current.showQueue).toBe(false);
    expect(result.current.showLyrics).toBe(false);
    expect(result.current.showEqualizer).toBe(false);
    expect(result.current.hasFloatingOverlayOpen).toBe(false);
  });
});
