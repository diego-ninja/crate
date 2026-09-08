import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

vi.mock("@/components/actions/track-actions", () => ({
  useTrackActionEntries: () => [],
}));

import { HomeReplaySection } from "./HomePlaybackSections";
import type { ReplayMix } from "./home-model";

const replay: ReplayMix = {
  window: "month:2026-06",
  title: "Replay June 2026",
  subtitle: "The tracks that defined June 2026.",
  track_count: 1,
  minutes_listened: 12,
  items: [
    {
      track_id: 1,
      track_path: "/music/converge/jane-doe/concubine.flac",
      title: "Concubine",
      artist: "Converge",
      album: "Jane Doe",
      play_count: 4,
      complete_play_count: 3,
      minutes_listened: 12,
    },
  ],
};

describe("HomeReplaySection", () => {
  it("presents the monthly replay as Crate DNA", () => {
    const { container } = renderWithListenProviders(
      <HomeReplaySection
        replay={replay}
        replayPreview={replay.items}
        onOpenStats={() => undefined}
        onPlayReplay={() => undefined}
        onPlayTrack={() => undefined}
      />,
    );

    expect(screen.getAllByText("Crate DNA").length).toBeGreaterThan(0);
    expect(screen.getByText("Replay June 2026")).toBeInTheDocument();
    expect(screen.getByText("Play month replay")).toBeInTheDocument();
    expect(screen.getByText("Month replay")).toBeInTheDocument();
    expect(container.querySelector(".home-replay-card")).toBeInTheDocument();
    expect(container.querySelector(".home-replay-panel")).toBeInTheDocument();
  });
});
