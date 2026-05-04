import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offline", () => ({
  getOfflineNativePlaybackUrl: vi.fn(() => null),
}));

import type { PlaySource, Track } from "./player-types";
import { getOfflineNativePlaybackUrl } from "@/lib/offline";
import { setPlaybackDeliveryPolicyPreference } from "@/lib/player-playback-prefs";
import {
  ANDROID_CONTINUOUS_ALBUM_CROSSFADE_SECONDS,
  getEffectiveCrossfadeSeconds,
  getStoredQueue,
  getStreamUrl,
  saveQueue,
  SMART_TRANSITION_BALANCED_SECONDS,
  SMART_TRANSITION_LONG_SECONDS,
  SMART_TRANSITION_MIXED_QUEUE_SECONDS,
  SMART_TRANSITION_SHORT_SECONDS,
  STORAGE_KEY,
} from "./player-utils";

const TRACK_A: Track = { id: "a", title: "A", artist: "X" };
const TRACK_B: Track = { id: "b", title: "B", artist: "Y" };
const ALBUM_TRACK_A: Track = { id: "album-a", title: "A", artist: "Dredg", album: "El Cielo" };
const ALBUM_TRACK_B: Track = { id: "album-b", title: "B", artist: "Dredg", album: "El Cielo" };
const OTHER_TRACK: Track = { id: "other-a", title: "A", artist: "Quicksand", album: "Slip" };
const COMPATIBLE_TRACK_A: Track = {
  id: "compatible-a",
  title: "A",
  artist: "X",
  bpm: 120,
  audioKey: "C",
  audioScale: "major",
  energy: 0.72,
  danceability: 0.48,
  valence: 0.34,
  blissVector: [0.2, 0.4, 0.6, 0.8],
};
const COMPATIBLE_TRACK_B: Track = {
  id: "compatible-b",
  title: "B",
  artist: "Y",
  bpm: 124,
  audioKey: "G",
  audioScale: "major",
  energy: 0.76,
  danceability: 0.52,
  valence: 0.38,
  blissVector: [0.21, 0.39, 0.62, 0.79],
};
const CLASHING_TRACK: Track = {
  id: "clashing",
  title: "C",
  artist: "Z",
  bpm: 176,
  audioKey: "F#",
  audioScale: "minor",
  energy: 0.12,
  danceability: 0.15,
  valence: 0.92,
  blissVector: [-0.8, -0.6, -0.4, -0.2],
};
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
  it("prefers canonical by-entity stream URLs when entityUid is available", () => {
    const url = getStreamUrl({
      id: "t1",
      entityUid: "entity-1",
      title: "Song",
      artist: "Band",
    });

    expect(url).toContain("/api/tracks/by-entity/entity-1/stream");
  });

  it("falls back to path-based stream URLs for normal playback without canonical ids", () => {
    const url = getStreamUrl({
      id: "t1",
      path: "Band/Album/Song.flac",
      title: "Song",
      artist: "Band",
    });

    expect(url).toContain("/api/stream/Band/Album/Song.flac");
  });

  it("adds the selected playback delivery policy to remote stream URLs", () => {
    setPlaybackDeliveryPolicyPreference("balanced");

    const url = getStreamUrl({
      id: "t1",
      entityUid: "entity-1",
      title: "Song",
      artist: "Band",
    });

    expect(url).toContain("/api/tracks/by-entity/entity-1/stream");
    expect(url).toContain("delivery=balanced");
  });

  it("prefers the native offline file URL when one exists", () => {
    vi.mocked(getOfflineNativePlaybackUrl).mockReturnValueOnce("capacitor://localhost/_capacitor_file_/offline/song.flac");

    const url = getStreamUrl({
      id: "t1",
      entityUid: "entity-1",
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

  it("uses a short Android mask for continuous album playback when WebAudio gapless is unavailable", () => {
    expect(
      getEffectiveCrossfadeSeconds(
        ALBUM_TRACK_A,
        ALBUM_TRACK_B,
        ALBUM_SOURCE,
        false,
        6,
        true,
        { androidNative: true },
      ),
    ).toBe(ANDROID_CONTINUOUS_ALBUM_CROSSFADE_SECONDS);
  });

  it("uses the context fallback for album playback when shuffle is on and analysis is missing", () => {
    expect(
      getEffectiveCrossfadeSeconds(ALBUM_TRACK_A, ALBUM_TRACK_B, ALBUM_SOURCE, true, 6, true),
    ).toBe(SMART_TRANSITION_BALANCED_SECONDS);
  });

  it("uses the playlist fallback when analysis is missing", () => {
    expect(
      getEffectiveCrossfadeSeconds(ALBUM_TRACK_A, ALBUM_TRACK_B, PLAYLIST_SOURCE, false, 6, true),
    ).toBe(SMART_TRANSITION_BALANCED_SECONDS);
  });

  it("uses the mixed queue fallback when the next album track is unrelated and analysis is missing", () => {
    expect(
      getEffectiveCrossfadeSeconds(ALBUM_TRACK_A, OTHER_TRACK, ALBUM_SOURCE, false, 6, true),
    ).toBe(SMART_TRANSITION_MIXED_QUEUE_SECONDS);
  });

  it("uses a longer transition for strongly compatible analysed tracks", () => {
    expect(
      getEffectiveCrossfadeSeconds(COMPATIBLE_TRACK_A, COMPATIBLE_TRACK_B, PLAYLIST_SOURCE, false, 8, true),
    ).toBe(SMART_TRANSITION_LONG_SECONDS);
  });

  it("uses a short transition for clashing analysed tracks", () => {
    expect(
      getEffectiveCrossfadeSeconds(COMPATIBLE_TRACK_A, CLASHING_TRACK, PLAYLIST_SOURCE, false, 8, true),
    ).toBe(SMART_TRANSITION_SHORT_SECONDS);
  });

  it("respects the configured crossfade as the ceiling", () => {
    expect(
      getEffectiveCrossfadeSeconds(COMPATIBLE_TRACK_A, COMPATIBLE_TRACK_B, PLAYLIST_SOURCE, false, 3, true),
    ).toBe(3);
  });

  it("falls back cleanly when only one track has analysis", () => {
    expect(
      getEffectiveCrossfadeSeconds(COMPATIBLE_TRACK_A, TRACK_B, PLAYLIST_SOURCE, false, 6, true),
    ).toBe(SMART_TRANSITION_BALANCED_SECONDS);
  });

  it("returns zero when no next track is predictable", () => {
    expect(
      getEffectiveCrossfadeSeconds(COMPATIBLE_TRACK_A, null, PLAYLIST_SOURCE, false, 6, true),
    ).toBe(0);
  });

  it("returns zero when the configured crossfade is off", () => {
    expect(
      getEffectiveCrossfadeSeconds(ALBUM_TRACK_A, ALBUM_TRACK_B, ALBUM_SOURCE, false, 0, true),
    ).toBe(0);
  });
});
