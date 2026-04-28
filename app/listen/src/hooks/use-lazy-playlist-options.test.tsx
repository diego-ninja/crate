import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(() => ({ data: [] })),
}));

import { useApi } from "@/hooks/use-api";
import { useLazyPlaylistOptions } from "@/hooks/use-lazy-playlist-options";

describe("useLazyPlaylistOptions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not request playlists until explicitly enabled", () => {
    const useApiMock = vi.mocked(useApi);

    const { result, rerender } = renderHook(() => useLazyPlaylistOptions());

    expect(useApiMock).toHaveBeenLastCalledWith(null);
    expect(result.current.playlistOptions).toEqual([]);

    act(() => {
      result.current.ensurePlaylistOptionsLoaded();
    });
    rerender();

    expect(useApiMock).toHaveBeenLastCalledWith("/api/playlists");
  });

  it("can start enabled for menu flows that need options immediately", () => {
    const useApiMock = vi.mocked(useApi);

    renderHook(() => useLazyPlaylistOptions(true));

    expect(useApiMock).toHaveBeenLastCalledWith("/api/playlists");
  });
});
