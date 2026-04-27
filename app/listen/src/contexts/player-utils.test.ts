import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offline", () => ({
  getOfflineNativePlaybackUrl: vi.fn(() => null),
}));

import type { PlaySource, Track } from "./player-types";
import { getOfflineNativePlaybackUrl } from "@/lib/offline";
import {
  getEffectiveCrossfadeSeconds,
  getStoredQueue,
  getStreamUrl,
  saveQueue,
  STORAGE_KEY,
} from "./player-utils";

const TRACK_A: Track = { id: "a", title: "A", artist: "X" };
const TRACK_B: Track = { id: "b", title: "B", artist: "Y" };
const ALBUM_TRACK_A: Track = { id: "album-a", title: "A", artist: "Dredg", album: "El Cielo" };
const ALBUM_TRACK_B: Track = { id: "album-b", title: "B", artist: "Dredg", album: "El Cielo" };
const OTHER_TRACK: Track = { id: "other-a", title: "A", artist: "Quicksand", album: "Slip" };
const ALBUM_SOURCE: PlaySource = { type: "album", name: "El Cielo", id: 1 };
const PLAYLIST_SOURCE: PlaySource = { type: "playlist", name: "Post-hardcore forever", id: 1 };

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("getStoredQueue / saveQueue round-trip", () => {
  it("returns empty defaults when nothing is persisted", () => {
    const stored = getStoredQueue();
    expect(stored.queue).toEqual([]);
    expect(stored.currentIndex).toBe(0);
    expect(stored.currentTime).toBe(0);
    expect(stored.wasPlaying).toBe(false);
    expect(stored.shuffle).toBe(false);
    expect(stored.unshuffledQueue).toBeNull();
  });

  it("persists basic playback state", () => {
    saveQueue([TRACK_A, TRACK_B], 1, { currentTime: 42, wasPlaying: true });
    const stored = getStoredQueue();
    expect(stored.queue).toEqual([TRACK_A, TRACK_B]);
    expect(stored.currentIndex).toBe(1);
    expect(stored.currentTime).toBe(42);
    expect(stored.wasPlaying).toBe(true);
  });

  it("persists shuffle flag + unshuffledQueue snapshot", () => {
    // User started with [A, B] then activated shuffle; current order
    // is [B, A]. The original [A, B] is preserved so toggling shuffle
    // off after reload restores the user's original sequence.
    saveQueue([TRACK_B, TRACK_A], 0, {
      shuffle: true,
      unshuffledQueue: [TRACK_A, TRACK_B],
    });
    const stored = getStoredQueue();
    expect(stored.queue).toEqual([TRACK_B, TRACK_A]);
    expect(stored.shuffle).toBe(true);
    expect(stored.unshuffledQueue).toEqual([TRACK_A, TRACK_B]);
  });

  it("defaults shuffle flag to false and snapshot to null when not passed", () => {
    saveQueue([TRACK_A], 0);
    const stored = getStoredQueue();
    expect(stored.shuffle).toBe(false);
    expect(stored.unshuffledQueue).toBeNull();
  });

  it("treats legacy payloads (pre-shuffle fields) as shuffle=false", () => {
    // Older app version shape.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      queue: [TRACK_A],
      currentIndex: 0,
      currentTime: 0,
      wasPlaying: false,
    }));
    const stored = getStoredQueue();
    expect(stored.shuffle).toBe(false);
    expect(stored.unshuffledQueue).toBeNull();
  });

  it("survives malformed JSON by returning defaults", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    const stored = getStoredQueue();
    expect(stored.queue).toEqual([]);
    expect(stored.shuffle).toBe(false);
  });

  it("returns defaults when stored queue is empty array", () => {
    saveQueue([], 0);
    const stored = getStoredQueue();
    expect(stored.queue).toEqual([]);
  });
});

describe("getStreamUrl", () => {
  it("prefers canonical by-storage stream URLs for normal playback", () => {
    const url = getStreamUrl({
      id: "t1",
      storageId: "storage-1",
      title: "Song",
      artist: "Band",
    });

    expect(url).toContain("/api/tracks/by-storage/storage-1/stream");
  });

  it("prefers the native offline file URL when one exists", () => {
    vi.mocked(getOfflineNativePlaybackUrl).mockReturnValueOnce("capacitor://localhost/_capacitor_file_/offline/song.flac");

    const url = getStreamUrl({
      id: "t1",
      storageId: "storage-1",
      title: "Song",
      artist: "Band",
    });

    expect(url).toBe("capacitor://localhost/_capacitor_file_/offline/song.flac");
  });
});

describe("getEffectiveCrossfadeSeconds", () => {
  it("returns the configured duration when smart crossfade is disabled", () => {
    expect(
      getEffectiveCrossfadeSeconds(ALBUM_TRACK_A, ALBUM_TRACK_B, ALBUM_SOURCE, false, 6, false),
    ).toBe(6);
  });

  it("returns gapless for continuous album playback when smart crossfade is enabled", () => {
    expect(
      getEffectiveCrossfadeSeconds(ALBUM_TRACK_A, ALBUM_TRACK_B, ALBUM_SOURCE, false, 6, true),
    ).toBe(0);
  });

  it("keeps crossfade for album playback when shuffle is on", () => {
    expect(
      getEffectiveCrossfadeSeconds(ALBUM_TRACK_A, ALBUM_TRACK_B, ALBUM_SOURCE, true, 6, true),
    ).toBe(6);
  });

  it("keeps crossfade for playlist playback", () => {
    expect(
      getEffectiveCrossfadeSeconds(ALBUM_TRACK_A, ALBUM_TRACK_B, PLAYLIST_SOURCE, false, 6, true),
    ).toBe(6);
  });

  it("keeps crossfade when the next track is not from the same album", () => {
    expect(
      getEffectiveCrossfadeSeconds(ALBUM_TRACK_A, OTHER_TRACK, ALBUM_SOURCE, false, 6, true),
    ).toBe(6);
  });

  it("returns zero when the configured crossfade is off", () => {
    expect(
      getEffectiveCrossfadeSeconds(ALBUM_TRACK_A, ALBUM_TRACK_B, ALBUM_SOURCE, false, 0, true),
    ).toBe(0);
  });
});
