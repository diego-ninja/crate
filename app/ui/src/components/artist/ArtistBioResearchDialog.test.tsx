import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArtistBioResearchDialog } from "./ArtistBioResearchDialog";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/lib/tasks", () => ({ waitForTask: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";

const artist = {
  id: 12,
  entity_uid: "artist-uid",
  name: "High Vis",
  albums: [],
  total_tracks: 0,
  total_size_mb: 0,
  issue_count: 0,
  is_v2: true,
  bio: "Old bio",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({ task_id: "task-1" });
  vi.mocked(waitForTask).mockResolvedValue({
    status: "completed",
    result: {
      proposal: "High Vis is an English rock band.",
      model: "test-model",
      sources: [
        {
          id: "musicbrainz",
          title: "MusicBrainz",
          url: "https://musicbrainz.org/artist/test",
          kind: "musicbrainz",
          excerpt: "An English rock band.",
        },
      ],
    },
  });
});

describe("ArtistBioResearchDialog", () => {
  it("shows sourced proposal and applies the reviewed text", async () => {
    const onApply = vi.fn();
    render(
      <ArtistBioResearchDialog
        open
        onOpenChange={vi.fn()}
        artist={artist}
        currentBio="Old bio"
        onApply={onApply}
      />,
    );

    expect(
      await screen.findByDisplayValue("High Vis is an English rock band."),
    ).toBeInTheDocument();
    expect(screen.getByText("MusicBrainz")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /apply proposal/i }),
    );

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledWith("High Vis is an English rock band.");
    });
  });
});
