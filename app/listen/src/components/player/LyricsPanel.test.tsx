import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LyricsPanel } from "@/components/player/LyricsPanel";
import { LyricsTab } from "@/components/player/extended/LyricsTab";
import {
  createMockTrack,
  renderWithListenProviders,
} from "@/test/render-with-listen-providers";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

describe("lyrics surfaces", () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it("uses semantic tokens for the dock lyrics panel", async () => {
    apiMock.mockResolvedValue({
      syncedLyrics: "[00:00.00]First line\n[00:10.00]Second line",
      plainLyrics: null,
    });
    const track = createMockTrack({ title: "Semantic lyrics" });

    const { container } = renderWithListenProviders(
      <LyricsPanel open onClose={vi.fn()} />,
      {
        playerActions: { currentTrack: track },
      },
    );

    const panel = screen.getByText("Lyrics").closest(".listen-glass-panel");
    const activeLine = await screen.findByRole("button", {
      name: "First line",
    });

    expect(panel).toHaveClass("border-l", "border-border-quiet");
    expect(screen.getByText("Lyrics")).toHaveClass("text-text-primary");
    expect(container.querySelector(".lyrics-ambient-glow")).toBeInTheDocument();
    expect(activeLine).toHaveClass(
      "bg-accent-action/10",
      "text-accent-action",
      "lyrics-active-line",
    );
    expect(container.innerHTML).not.toContain("rgba(");
    expect(container.innerHTML).not.toContain("text-white/");
  });

  it("uses the same semantic line tokens in the extended lyrics tab", async () => {
    apiMock.mockResolvedValue({
      syncedLyrics: "[00:00.00]Extended line",
      plainLyrics: null,
    });

    const { container } = renderWithListenProviders(
      <LyricsTab useAlbumPalette={false} />,
      {
        playerActions: {
          currentTrack: createMockTrack({ title: "Extended lyrics" }),
        },
      },
    );
    const activeLine = await screen.findByRole("button", {
      name: "Extended line",
    });

    expect(
      container.querySelector(".lyrics-surface-gradient"),
    ).toBeInTheDocument();
    expect(activeLine).toHaveClass(
      "bg-accent-action/10",
      "text-accent-action",
      "lyrics-active-line",
    );
    expect(container.innerHTML).not.toContain("rgba(");
    expect(container.innerHTML).not.toContain("text-white/");
  });

  it("passes cancellation to the lyrics request", async () => {
    apiMock.mockResolvedValue({
      syncedLyrics: "[00:00.00]Cancellable line",
      plainLyrics: null,
    });

    renderWithListenProviders(<LyricsTab useAlbumPalette={false} />, {
      playerActions: {
        currentTrack: createMockTrack({ title: "Cancellable lyrics" }),
      },
    });

    await screen.findByRole("button", { name: "Cancellable line" });

    expect(apiMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/lyrics?"),
      "GET",
      undefined,
      { signal: expect.any(AbortSignal) },
    );
  });
});
