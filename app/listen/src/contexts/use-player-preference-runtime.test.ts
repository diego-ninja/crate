import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaySource } from "@/contexts/player-types";
import {
  PLAYER_PLAYBACK_PREFS_EVENT,
  type PlaybackDeliveryPreference,
} from "@/lib/player-playback-prefs";
import { preparePlaybackDelivery } from "@/lib/playback-delivery";
import { usePlayerPreferenceRuntime } from "./use-player-preference-runtime";

vi.mock("@/lib/playback-delivery", () => ({
  preparePlaybackDelivery: vi.fn(),
}));

function createOptions() {
  return {
    currentIndex: 0,
    playbackDeliveryPolicy: "auto" as PlaybackDeliveryPreference,
    playSource: { type: "queue", name: "Queue" } as PlaySource,
    queue: [],
    repeat: "off" as const,
    setInfinitePlaybackEnabled: vi.fn(),
    setPlaybackDeliveryPolicy: vi.fn(),
    setSmartCrossfadeEnabled: vi.fn(),
    setSmartPlaylistSuggestionsCadence: vi.fn(),
    setSmartPlaylistSuggestionsEnabled: vi.fn(),
    shuffle: false,
    smartCrossfadeEnabled: true,
    syncEffectiveCrossfade: vi.fn(),
  };
}

describe("usePlayerPreferenceRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies preference event overrides and keeps delivery preparation in the hook", () => {
    const options = createOptions();
    renderHook(() => usePlayerPreferenceRuntime(options));

    act(() => {
      window.dispatchEvent(
        new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
          detail: {
            infinitePlaybackEnabled: false,
            playbackDeliveryPolicy: "balanced",
            smartCrossfadeEnabled: false,
            smartPlaylistSuggestionsCadence: 12,
            smartPlaylistSuggestionsEnabled: true,
          },
        }),
      );
    });

    expect(options.setInfinitePlaybackEnabled).toHaveBeenCalledWith(false);
    expect(options.setPlaybackDeliveryPolicy).toHaveBeenCalledWith("balanced");
    expect(options.setSmartCrossfadeEnabled).toHaveBeenCalledWith(false);
    expect(options.setSmartPlaylistSuggestionsCadence).toHaveBeenCalledWith(12);
    expect(options.setSmartPlaylistSuggestionsEnabled).toHaveBeenCalledWith(
      true,
    );
    expect(options.syncEffectiveCrossfade).toHaveBeenCalledTimes(2);
    expect(preparePlaybackDelivery).toHaveBeenCalledWith([], 0, "original");
  });

  it("removes the preference listener when the provider unmounts", () => {
    const options = createOptions();
    const { unmount } = renderHook(() => usePlayerPreferenceRuntime(options));

    unmount();
    act(() => {
      window.dispatchEvent(
        new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
          detail: { smartCrossfadeEnabled: false },
        }),
      );
    });

    expect(options.setSmartCrossfadeEnabled).not.toHaveBeenCalled();
  });
});
