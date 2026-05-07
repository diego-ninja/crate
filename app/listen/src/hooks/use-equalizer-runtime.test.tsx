import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Track } from "@/contexts/player-types";
import { EQ_PRESETS } from "@/lib/equalizer";
import { setEqualizerEnabled, setEqualizerGenreAdaptive } from "@/lib/equalizer-prefs";
import { useEqualizerRuntime } from "./use-equalizer-runtime";

vi.mock("@/lib/gapless-player", () => ({
  setEqualizer: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

vi.mock("@/lib/library-routes", () => ({
  trackEqFeaturesApiPath: vi.fn((track: Track) => `/api/tracks/${track.libraryTrackId}/eq-features`),
  trackGenreApiPath: vi.fn((track: Track) => `/api/tracks/${track.libraryTrackId}/genre`),
}));

const TRACK_A: Track = {
  id: "a",
  libraryTrackId: 1,
  title: "Track A",
  artist: "Artist",
};

const TRACK_B: Track = {
  id: "b",
  libraryTrackId: 2,
  title: "Track B",
  artist: "Artist",
};

describe("useEqualizerRuntime", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("keeps genre-adaptive EQ in sync across track changes without the panel mounted", async () => {
    const { api } = await import("@/lib/api");
    const { setEqualizer } = await import("@/lib/gapless-player");
    vi.mocked(api).mockImplementation((path: string) => {
      if (path.includes("/1/genre")) {
        return Promise.resolve({
          primary: { slug: "rock", name: "Rock", canonical: true },
          topLevel: null,
          source: "album",
          preset: { gains: EQ_PRESETS.rock, source: "direct", inheritedFrom: null },
        });
      }
      if (path.includes("/2/genre")) {
        return Promise.resolve({
          primary: { slug: "jazz", name: "Jazz", canonical: true },
          topLevel: null,
          source: "album",
          preset: { gains: EQ_PRESETS.jazz, source: "direct", inheritedFrom: null },
        });
      }
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });

    setEqualizerEnabled(true);
    setEqualizerGenreAdaptive(true);

    const { rerender } = renderHook(
      ({ track }) => useEqualizerRuntime(track),
      { initialProps: { track: TRACK_A } },
    );

    await waitFor(() => {
      expect(vi.mocked(setEqualizer)).toHaveBeenLastCalledWith(true, EQ_PRESETS.rock);
    });

    rerender({ track: TRACK_B });

    await waitFor(() => {
      expect(vi.mocked(setEqualizer)).toHaveBeenLastCalledWith(true, EQ_PRESETS.jazz);
    });
  });
});
