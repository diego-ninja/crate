import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

import { api } from "@/lib/api";
import { __resetTrackInfoCacheForTests, useTrackInfo } from "@/hooks/use-track-info";

const TEST_TRACK = {
  id: "42",
  libraryTrackId: 42,
  title: "Still Suffer",
  artist: "Terror",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useTrackInfo", () => {
  afterEach(() => {
    vi.clearAllMocks();
    __resetTrackInfoCacheForTests();
  });

  it("dedupes concurrent consumers of the same track info request", async () => {
    const request = deferred<{
      title: string;
      artist: string;
      album: string;
      format: string;
      bitrate: number;
      sample_rate: number;
      bit_depth: number;
      bpm: null;
      audio_key: null;
      audio_scale: null;
      energy: null;
      danceability: null;
      valence: null;
      acousticness: null;
      instrumentalness: null;
      loudness: null;
      dynamic_range: null;
      mood_json: null;
      lastfm_listeners: null;
      lastfm_playcount: null;
      popularity: null;
      rating: null;
      bliss_signature: null;
    }>();
    vi.mocked(api).mockReturnValue(request.promise);

    const first = renderHook(() => useTrackInfo(TEST_TRACK));
    const second = renderHook(() => useTrackInfo(TEST_TRACK));

    expect(vi.mocked(api)).toHaveBeenCalledTimes(1);
    expect(first.result.current.loading).toBe(true);
    expect(second.result.current.loading).toBe(true);

    request.resolve({
      title: "Still Suffer",
      artist: "Terror",
      album: "Still Suffer",
      format: "flac",
      bitrate: 1004,
      sample_rate: 44100,
      bit_depth: 16,
      bpm: null,
      audio_key: null,
      audio_scale: null,
      energy: null,
      danceability: null,
      valence: null,
      acousticness: null,
      instrumentalness: null,
      loudness: null,
      dynamic_range: null,
      mood_json: null,
      lastfm_listeners: null,
      lastfm_playcount: null,
      popularity: null,
      rating: null,
      bliss_signature: null,
    });

    await waitFor(() => {
      expect(first.result.current.info?.format).toBe("flac");
      expect(second.result.current.info?.format).toBe("flac");
    });
  });

  it("serves cached track info immediately to later consumers without refetching", async () => {
    vi.mocked(api).mockResolvedValue({
      title: "Still Suffer",
      artist: "Terror",
      album: "Still Suffer",
      format: "aac",
      bitrate: 320,
      sample_rate: 44100,
      bit_depth: null,
      bpm: null,
      audio_key: null,
      audio_scale: null,
      energy: null,
      danceability: null,
      valence: null,
      acousticness: null,
      instrumentalness: null,
      loudness: null,
      dynamic_range: null,
      mood_json: null,
      lastfm_listeners: null,
      lastfm_playcount: null,
      popularity: null,
      rating: null,
      bliss_signature: null,
    });

    const first = renderHook(() => useTrackInfo(TEST_TRACK));
    await waitFor(() => {
      expect(first.result.current.info?.format).toBe("aac");
    });
    first.unmount();

    const second = renderHook(() => useTrackInfo(TEST_TRACK));
    expect(second.result.current.info?.format).toBe("aac");
    expect(second.result.current.loading).toBe(false);
    expect(vi.mocked(api)).toHaveBeenCalledTimes(1);
  });

  it("skips the request entirely when disabled", () => {
    const result = renderHook(() => useTrackInfo(TEST_TRACK, { enabled: false }));
    expect(result.result.current.info).toBeNull();
    expect(result.result.current.loading).toBe(false);
    expect(vi.mocked(api)).not.toHaveBeenCalled();
  });
});
