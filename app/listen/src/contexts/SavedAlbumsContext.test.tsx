import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/cache", () => ({
  onCacheInvalidation: vi.fn(() => () => {}),
}));

import {
  SavedAlbumsProvider,
  type SavedAlbum,
  useSavedAlbums,
} from "@/contexts/SavedAlbumsContext";

function Probe() {
  const { savedAlbums, loading, refetch } = useSavedAlbums();
  return (
    <div>
      <output>{savedAlbums.map((album) => album.name).join(",")}</output>
      <span>{loading ? "loading" : "idle"}</span>
      <button onClick={() => void refetch()}>refetch</button>
    </div>
  );
}

function SaveProbe() {
  const { isSaved, savedAlbums, toggleAlbumSaved } = useSavedAlbums();
  return (
    <div>
      <output data-testid="saved-state">
        {isSaved(42, "album-global-1") ? "saved" : "not-saved"}
      </output>
      <output data-testid="refetched-state">
        {savedAlbums.some((album) => album.id === 99) ? "loaded" : "pending"}
      </output>
      <button onClick={() => void toggleAlbumSaved(42, "album-global-1")}>
        save
      </button>
    </div>
  );
}

describe("SavedAlbumsProvider", () => {
  beforeEach(() => apiMock.mockReset());

  it("preserves the last valid library when a refetch fails", async () => {
    apiMock
      .mockResolvedValueOnce([
        {
          saved_at: "2026-07-15T00:00:00Z",
          id: 8,
          artist: "High Vis",
          name: "Guided Tour",
          year: "2024",
          has_cover: true,
          track_count: 11,
          total_duration: 1800,
        },
      ])
      .mockRejectedValueOnce(new Error("catalog refresh unavailable"));
    const user = userEvent.setup();
    render(
      <SavedAlbumsProvider>
        <Probe />
      </SavedAlbumsProvider>,
    );
    await screen.findByText("Guided Tour");

    await user.click(screen.getByRole("button", { name: "refetch" }));

    await waitFor(() => expect(screen.getByText("idle")).toBeInTheDocument());
    expect(screen.getByText("Guided Tour")).toBeInTheDocument();
  });

  it("keeps an optimistic save visible when the immediate refetch is stale", async () => {
    let resolveStaleRefetch: ((albums: SavedAlbum[]) => void) | undefined;
    const staleRefetch = new Promise<SavedAlbum[]>((resolve) => {
      resolveStaleRefetch = resolve;
    });
    apiMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ ok: true })
      .mockReturnValueOnce(staleRefetch);
    const user = userEvent.setup();
    render(
      <SavedAlbumsProvider>
        <SaveProbe />
      </SavedAlbumsProvider>,
    );

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));
    await act(async () => {
      resolveStaleRefetch?.([
        {
          saved_at: "2026-07-15T00:00:00Z",
          id: 99,
          artist: "Other Artist",
          name: "Other Album",
          year: "2024",
          has_cover: false,
          track_count: 1,
          total_duration: 120,
        },
      ]);
      await staleRefetch;
    });
    await waitFor(() =>
      expect(screen.getByTestId("refetched-state")).toHaveTextContent("loaded"),
    );
    expect(screen.getByTestId("saved-state")).toHaveTextContent(/^saved$/);
  });
});
