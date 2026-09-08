import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Track } from "@/contexts/player-types";

vi.mock("@/components/artwork/CrateImage", () => ({
  CrateImage: (props: { alt: string; src?: string }) => (
    <img data-testid="crate-image" {...props} />
  ),
}));

import { PlayerTrackIdentity } from "./PlayerTrackIdentity";

const track: Track = {
  id: "track-1",
  title: "Track One",
  artist: "Artist One",
  album: "Album One",
};

describe("PlayerTrackIdentity", () => {
  it("uses semantic tokens for track metadata and artist badge", () => {
    render(
      <PlayerTrackIdentity
        currentTrack={track}
        crossfadeTransition={null}
        crossfadeProgress={1}
        sourceLabel="Queue"
      />,
    );

    expect(screen.getByText("Playing from: Queue")).toHaveClass(
      "text-text-subtle",
    );
    expect(screen.getByRole("heading", { name: "Track One" })).toHaveClass(
      "text-text-primary",
    );
    expect(screen.getByText("Album One")).toHaveClass("text-text-muted");

    const artistButton = screen.getByRole("button", {
      name: "Go to Artist One",
    });
    expect(artistButton).toHaveClass(
      "border-border-subtle",
      "bg-surface-quiet-subtle",
    );
    expect(artistButton.className).not.toContain("white/");
    expect(artistButton.className).not.toContain("black/");
  });

  it("keeps the artist action disabled unless the artist is clickable", () => {
    render(
      <PlayerTrackIdentity
        currentTrack={track}
        crossfadeTransition={null}
        crossfadeProgress={1}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Go to Artist One" }),
    ).toBeDisabled();
  });
});
