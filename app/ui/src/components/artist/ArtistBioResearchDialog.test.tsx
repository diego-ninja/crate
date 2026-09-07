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
      bio: {
        paragraphs: [
          "High Vis is an English rock band.",
          "The group combines melodic songwriting with a direct hardcore edge.",
        ],
      },
      members: {
        current: [
          {
            name: "Graham Sayle",
            roles: ["vocals"],
            from_year: "2016",
            to_year: null,
          },
        ],
        former: [
          {
            name: "Former Member",
            roles: ["guitar"],
            from_year: "2016",
            to_year: "2018",
          },
        ],
      },
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

    expect(await screen.findByText("High Vis")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(
      await screen.findByDisplayValue(/High Vis is an English rock band/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Sources" }));
    expect(screen.getByText("MusicBrainz")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Edit" }));
    await userEvent.click(
      screen.getByRole("button", { name: /apply biography/i }),
    );

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledWith(
        "High Vis is an English rock band.\n\nThe group combines melodic songwriting with a direct hardcore edge.",
      );
    });
  });

  it("previews the Listen profile with current and former member tables", async () => {
    render(
      <ArtistBioResearchDialog
        open
        onOpenChange={vi.fn()}
        artist={artist}
        currentBio="Old bio"
        onApply={vi.fn()}
      />,
    );

    expect(await screen.findByTestId("artist-bio-preview")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Current members" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Former members" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Current members" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Former members" }),
    ).toBeInTheDocument();
  });

  it("keeps a long research result inside a scrollable dialog body", async () => {
    render(
      <ArtistBioResearchDialog
        open
        onOpenChange={vi.fn()}
        artist={artist}
        currentBio="Old bio"
        onApply={vi.fn()}
      />,
    );

    const body = await screen.findByTestId("artist-bio-research-body");
    const content = document.querySelector('[data-slot="dialog-content"]');
    expect(body).toHaveClass("flex-1", "overflow-y-auto");
    expect(content).toHaveClass("flex", "flex-col", "overflow-hidden");
  });
});
