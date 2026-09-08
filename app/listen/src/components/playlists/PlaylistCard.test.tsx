import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

describe("PlaylistCard", () => {
  it("uses the semantic canvas token for playlist badges", () => {
    renderWithListenProviders(
      <PlaylistCard
        name="Crate Selects"
        meta="12 tracks"
        badge="Featured"
        onClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Featured")).toHaveClass("bg-surface-canvas/85");
  });
});
