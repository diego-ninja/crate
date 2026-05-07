import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  apiFetch: apiFetchMock,
}));

import { preparePlaybackDelivery, upcomingDeliveryTracks } from "@/lib/playback-delivery";
import type { Track } from "@/contexts/player-types";

function makeTrack(index: number): Track {
  return {
    id: `track-${index}`,
    libraryTrackId: index,
    title: `Track ${index}`,
    artist: "Artist",
    album: "Album",
  };
}

const track = makeTrack(42);
const originalMatchMedia = window.matchMedia;

function mockMatchMedia(matches: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    } satisfies MediaQueryList)),
  });
}

describe("upcomingDeliveryTracks", () => {
  it("keeps the desktop prepare window by default", () => {
    const tracks = Array.from({ length: 7 }, (_, index) => makeTrack(index + 1));
    expect(upcomingDeliveryTracks(tracks, 0).map((item) => item.id)).toEqual([
      "track-1",
      "track-2",
      "track-3",
      "track-4",
      "track-5",
      "track-6",
    ]);
  });

  it("supports a smaller runtime prepare window", () => {
    const tracks = Array.from({ length: 6 }, (_, index) => makeTrack(index + 1));
    expect(upcomingDeliveryTracks(tracks, 0, 3).map((item) => item.id)).toEqual([
      "track-1",
      "track-2",
      "track-3",
    ]);
  });
});

describe("preparePlaybackDelivery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  });

  it("prepares a smaller batch on mobile viewports", async () => {
    const tracks = Array.from({ length: 6 }, (_, index) => makeTrack(index + 1));
    apiFetchMock.mockResolvedValueOnce({});
    mockMatchMedia(true);

    preparePlaybackDelivery(tracks, 0, "balanced");
    await vi.advanceTimersByTimeAsync(300);

    const request = apiFetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body.tracks).toHaveLength(5);
  });

  it("can prepare the active track immediately on user-initiated playback", async () => {
    apiFetchMock.mockResolvedValueOnce({});

    preparePlaybackDelivery([makeTrack(43)], 0, "balanced", { immediate: true });

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries the same batch after a transient prepare failure", async () => {
    apiFetchMock.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({});

    preparePlaybackDelivery([track], 0, "balanced");
    await vi.advanceTimersByTimeAsync(300);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    preparePlaybackDelivery([track], 0, "balanced");
    await vi.advanceTimersByTimeAsync(300);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });
});
