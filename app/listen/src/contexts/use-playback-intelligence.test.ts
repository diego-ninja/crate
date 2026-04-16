import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/radio", () => ({
  fetchRadioContinuation: vi.fn(),
  fetchInfiniteContinuation: vi.fn(),
}));

import * as radio from "@/lib/radio";
import { usePlaybackIntelligence } from "./use-playback-intelligence";
import type { PlaySource, Track } from "./player-types";

const mockRadioCont = vi.mocked(radio.fetchRadioContinuation);
const mockInfiniteCont = vi.mocked(radio.fetchInfiniteContinuation);

const TRACK_A: Track = { id: "a", title: "A", artist: "X" };
const TRACK_B: Track = { id: "b", title: "B", artist: "Y" };
const TRACK_C: Track = { id: "c", title: "C", artist: "Z" };

function makeActions() {
  return {
    appendTracks: vi.fn(),
    insertSuggestionAfterCurrent: vi.fn(),
    appendAndAdvance: vi.fn(),
    setBuffering: vi.fn(),
  };
}

// Extra padding tracks so the prefetch effect doesn't auto-fire
// (threshold: fetch when remainingUpcoming <= 3). Manual tests of
// continueInfinitePlayback want a full buffer so they can control the
// timing of the single fetch.
const PAD: Track[] = Array.from({ length: 10 }, (_, i) => ({
  id: `pad-${i}`,
  title: `Pad ${i}`,
  artist: "Pad",
}));

function baseOptions(overrides: Partial<Parameters<typeof usePlaybackIntelligence>[0]> = {}) {
  const actions = makeActions();
  const playSourceRadio: PlaySource = {
    type: "album",
    name: "Album",
    id: 42,
    radio: { seedType: "album", seedId: 42 },
  };
  return {
    opts: {
      queue: [TRACK_A, ...PAD],
      currentIndex: 0,
      isPlaying: false,
      playSource: playSourceRadio,
      shuffle: false,
      infinitePlaybackEnabled: true,
      smartPlaylistSuggestionsEnabled: false,
      smartPlaylistSuggestionsCadence: 3,
      recentlyPlayed: [],
      actions,
      ...overrides,
    },
    actions,
  };
}

beforeEach(() => {
  mockRadioCont.mockReset();
  mockInfiniteCont.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
});

describe("continueInfinitePlayback", () => {
  it("returns false when infinite playback is disabled", () => {
    const { opts } = baseOptions({ infinitePlaybackEnabled: false });
    const { result } = renderHook(() => usePlaybackIntelligence(opts));
    expect(result.current.continueInfinitePlayback()).toBe(false);
  });

  it("returns false when shuffle is on", () => {
    const { opts } = baseOptions({ shuffle: true });
    const { result } = renderHook(() => usePlaybackIntelligence(opts));
    expect(result.current.continueInfinitePlayback()).toBe(false);
  });

  it("returns false when playSource is radio (not album/playlist)", () => {
    const { opts } = baseOptions({
      playSource: { type: "radio", name: "R", radio: { seedType: "track", seedId: 1 } },
    });
    const { result } = renderHook(() => usePlaybackIntelligence(opts));
    expect(result.current.continueInfinitePlayback()).toBe(false);
  });

  it("returns false when there's no radio seed", () => {
    const { opts } = baseOptions({
      playSource: { type: "album", name: "A", id: 1 },
    });
    const { result } = renderHook(() => usePlaybackIntelligence(opts));
    expect(result.current.continueInfinitePlayback()).toBe(false);
  });

  it("returns true and calls setBuffering then appendAndAdvance on success", async () => {
    const { opts, actions } = baseOptions();
    mockInfiniteCont.mockResolvedValue([TRACK_B, TRACK_C]);

    const { result } = renderHook(() => usePlaybackIntelligence(opts));

    let returned = false;
    await act(async () => {
      returned = result.current.continueInfinitePlayback();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(returned).toBe(true);
    expect(actions.setBuffering).toHaveBeenCalledWith(true);
    expect(actions.appendAndAdvance).toHaveBeenCalledWith([TRACK_B, TRACK_C]);
  });

  it("clears buffering when the fetch returns no tracks", async () => {
    const { opts, actions } = baseOptions();
    mockInfiniteCont.mockResolvedValue([]);

    const { result } = renderHook(() => usePlaybackIntelligence(opts));

    await act(async () => {
      result.current.continueInfinitePlayback();
      // Let the mocked fetch resolve + all then() chains settle.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(actions.setBuffering).toHaveBeenCalledWith(true);
    expect(actions.setBuffering).toHaveBeenCalledWith(false);
    expect(actions.appendAndAdvance).not.toHaveBeenCalled();
  });

  it("clears buffering and logs when the fetch rejects", async () => {
    const { opts, actions } = baseOptions();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockInfiniteCont.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => usePlaybackIntelligence(opts));

    await act(async () => {
      result.current.continueInfinitePlayback();
      // Let the mocked fetch resolve + all then() chains settle.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(actions.setBuffering).toHaveBeenCalledWith(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("filters tracks already in queue or recently played", async () => {
    const { opts, actions } = baseOptions({
      queue: [TRACK_A, ...PAD],
      recentlyPlayed: [TRACK_B],
    });
    // Fetch returns one already in queue (A), one recently played (B),
    // one genuinely new (C).
    mockInfiniteCont.mockResolvedValue([TRACK_A, TRACK_B, TRACK_C]);

    const { result } = renderHook(() => usePlaybackIntelligence(opts));

    await act(async () => {
      result.current.continueInfinitePlayback();
      // Let the mocked fetch resolve + all then() chains settle.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(actions.appendAndAdvance).toHaveBeenCalledWith([TRACK_C]);
  });

  it("clears buffering when all fetched tracks are duplicates", async () => {
    const { opts, actions } = baseOptions({ queue: [TRACK_A, ...PAD] });
    mockInfiniteCont.mockResolvedValue([TRACK_A]);

    const { result } = renderHook(() => usePlaybackIntelligence(opts));

    await act(async () => {
      result.current.continueInfinitePlayback();
      // Let the mocked fetch resolve + all then() chains settle.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(actions.setBuffering).toHaveBeenCalledWith(false);
    expect(actions.appendAndAdvance).not.toHaveBeenCalled();
  });
});

describe("radio refill effect", () => {
  it("fetches when isPlaying + radio source + queue low", async () => {
    mockRadioCont.mockResolvedValue([TRACK_B]);
    const { opts, actions } = baseOptions({
      playSource: {
        type: "radio",
        name: "R",
        radio: { seedType: "track", seedId: 1 },
      },
      isPlaying: true,
      queue: [TRACK_A],
      currentIndex: 0,
    });

    renderHook(() => usePlaybackIntelligence(opts));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRadioCont).toHaveBeenCalled();
    expect(actions.appendTracks).toHaveBeenCalledWith([TRACK_B]);
  });

  it("does nothing when not playing", async () => {
    const { opts, actions } = baseOptions({
      playSource: { type: "radio", name: "R", radio: { seedType: "track", seedId: 1 } },
      isPlaying: false,
    });

    renderHook(() => usePlaybackIntelligence(opts));

    await act(async () => { await Promise.resolve(); });

    expect(mockRadioCont).not.toHaveBeenCalled();
    expect(actions.appendTracks).not.toHaveBeenCalled();
  });
});

describe("resetPlaybackIntelligence", () => {
  it("aborts in-flight fetches and clears signatures", async () => {
    mockInfiniteCont.mockImplementation(() => new Promise(() => {})); // never resolves
    const { opts } = baseOptions();

    const { result } = renderHook(() => usePlaybackIntelligence(opts));

    act(() => { result.current.continueInfinitePlayback(); });
    expect(() => result.current.resetPlaybackIntelligence()).not.toThrow();
  });
});
