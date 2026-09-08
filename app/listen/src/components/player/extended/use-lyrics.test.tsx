import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

import type { Track } from "@/contexts/player-types";
import { api } from "@/lib/api";

import { useLyrics } from "./use-lyrics";

const TEST_TRACK: Track = {
  id: "track-1",
  title: "Still Suffer",
  artist: "Terror",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("useLyrics", () => {
  it("clears the loading state when the current track is removed", () => {
    const request = deferred<{
      syncedLyrics: string | null;
      plainLyrics: string | null;
    }>();
    vi.mocked(api).mockReturnValue(request.promise);

    const initialProps: { track: Track | null } = { track: TEST_TRACK };
    const hook = renderHook(
      ({ track }: { track: Track | null }) => useLyrics(track),
      {
        initialProps,
      },
    );

    expect(hook.result.current.loading).toBe(true);

    hook.rerender({ track: null });

    expect(hook.result.current).toEqual({ lyrics: null, loading: false });
  });
});
