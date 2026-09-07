import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());

type Artist = {
  artist_name: string;
  artist_id?: number;
  created_at: string;
};

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/cache", () => ({
  onCacheInvalidation: vi.fn(() => () => {}),
}));

import {
  ArtistFollowsProvider,
  useArtistFollows,
} from "@/contexts/ArtistFollowsContext";

function Probe() {
  const { followedArtists, loading, refetch } = useArtistFollows();
  return (
    <div>
      <output>
        {followedArtists.map((artist) => artist.artist_name).join(",")}
      </output>
      <span>{loading ? "loading" : "idle"}</span>
      <button onClick={() => void refetch()}>refetch</button>
    </div>
  );
}

function FollowProbe() {
  const { followedArtists, isFollowing, refetch, toggleArtistFollow } =
    useArtistFollows();
  return (
    <div>
      <output data-testid="following-state">
        {isFollowing(7, "artist-global-1") ? "following" : "not-following"}
      </output>
      <output data-testid="refetched-state">
        {followedArtists.some((artist) => artist.artist_id === 99)
          ? "loaded"
          : "pending"}
      </output>
      <button
        onClick={() =>
          void toggleArtistFollow(7, "artist-global-1", "Target Artist")
        }
      >
        follow
      </button>
      <button onClick={() => void refetch()}>refetch</button>
    </div>
  );
}

describe("ArtistFollowsProvider", () => {
  beforeEach(() => apiMock.mockReset());

  it("preserves the last valid library when a refetch fails", async () => {
    apiMock
      .mockResolvedValueOnce([
        {
          artist_name: "High Vis",
          artist_id: 7,
          created_at: "2026-07-15T00:00:00Z",
        },
      ])
      .mockRejectedValueOnce(new Error("catalog refresh unavailable"));
    const user = userEvent.setup();
    render(
      <ArtistFollowsProvider>
        <Probe />
      </ArtistFollowsProvider>,
    );
    await screen.findByText("High Vis");

    await user.click(screen.getByRole("button", { name: "refetch" }));

    await waitFor(() => expect(screen.getByText("idle")).toBeInTheDocument());
    expect(screen.getByText("High Vis")).toBeInTheDocument();
  });

  it("keeps an optimistic follow visible when a later refetch is stale", async () => {
    let resolveStaleRefetch: ((artists: Artist[]) => void) | undefined;
    const staleRefetch = new Promise<Artist[]>((resolve) => {
      resolveStaleRefetch = resolve;
    });
    apiMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ ok: true })
      .mockReturnValueOnce(staleRefetch);
    const user = userEvent.setup();
    render(
      <ArtistFollowsProvider>
        <FollowProbe />
      </ArtistFollowsProvider>,
    );

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "follow" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "refetch" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));

    await act(async () => {
      resolveStaleRefetch?.([
        {
          artist_name: "Other Artist",
          artist_id: 99,
          created_at: "2026-07-15T00:00:00Z",
        },
      ]);
      await staleRefetch;
    });
    await waitFor(() =>
      expect(screen.getByTestId("refetched-state")).toHaveTextContent("loaded"),
    );
    expect(screen.getByTestId("following-state")).toHaveTextContent(
      /^following$/,
    );
  });
});
