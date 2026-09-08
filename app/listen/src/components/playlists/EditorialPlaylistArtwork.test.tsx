import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  EditorialPlaylistArtwork,
  editorialPlaylistLabel,
} from "./EditorialPlaylistArtwork";

describe("EditorialPlaylistArtwork", () => {
  it("normalizes Core Tracks names into editorial title and kicker", () => {
    expect(editorialPlaylistLabel("Hardcore Core Tracks")).toEqual({
      title: "Hardcore",
      kicker: "Core Tracks",
    });
  });

  it("treats legacy Mix smart playlists as Core Tracks", () => {
    expect(editorialPlaylistLabel("Screamo Mix")).toEqual({
      title: "Screamo",
      kicker: "Core Tracks",
    });
  });

  it("renders the Crate editorial mark instead of decorative diamonds", () => {
    const { container } = render(
      <EditorialPlaylistArtwork title="Hardcore" kicker="Core Tracks" />,
    );

    expect(screen.getByText("Hardcore")).toBeInTheDocument();
    expect(screen.getByText("Core Tracks")).toBeInTheDocument();
    expect(screen.getByTestId("crate-editorial-mark")).toHaveClass(
      "drop-shadow-artwork-mark",
    );
    expect(container.innerHTML).not.toContain("rgba(");
  });
});
