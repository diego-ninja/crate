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
    expect(content).toHaveClass("!max-w-5xl");
  });

  it("shows incremental review findings when the existing biography is preserved", async () => {
    vi.mocked(waitForTask).mockResolvedValueOnce({
      status: "completed",
      result: {
        bio_action: "preserve",
        proposal:
          "A rewritten biography that should not replace the current one.",
        review_items: [
          {
            kind: "new_release",
            summary: "The official site lists a new album.",
            source_ids: ["official"],
          },
        ],
        warnings: [
          "The generated draft was shorter than the existing biography, so the current text was preserved.",
        ],
        bio: {
          paragraphs: [
            "A rewritten biography that should not replace the current one.",
          ],
        },
        sources: [],
      },
    });

    render(
      <ArtistBioResearchDialog
        open
        onOpenChange={vi.fn()}
        artist={artist}
        currentBio="The existing canonical biography."
        onApply={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("Existing biography preserved"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The official site lists a new album."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/generated draft was shorter/i),
    ).toBeInTheDocument();
  });

  it("renders semantic bio changes with the review color coding", async () => {
    vi.mocked(waitForTask).mockResolvedValueOnce({
      status: "completed",
      result: {
        bio_action: "update",
        bio: { paragraphs: ["Updated biography."] },
        bio_changes: [
          { status: "unchanged", text: "Existing context.", source_ids: [] },
          {
            status: "removed",
            text: "Old stale detail.",
            source_ids: ["official"],
          },
          {
            status: "added",
            text: "New verified release.",
            source_ids: ["official"],
          },
          {
            status: "updated",
            previous_text: "The band formed in 1994.",
            text: "The band formed in 1995.",
            source_ids: ["musicbrainz"],
          },
        ],
        sources: [],
      },
    });

    render(
      <ArtistBioResearchDialog
        open
        onOpenChange={vi.fn()}
        artist={artist}
        currentBio="Existing context."
        onApply={vi.fn()}
      />,
    );

    await screen.findByTestId("artist-bio-preview");
    await userEvent.click(screen.getByRole("tab", { name: "Review changes" }));

    expect(screen.getByTestId("bio-change-added")).toHaveClass(
      "text-state-success-text",
    );
    expect(screen.getByTestId("bio-change-removed")).toHaveClass(
      "text-state-danger-text",
      "line-through",
    );
    expect(screen.getByTestId("bio-change-updated")).toHaveTextContent(
      "The band formed in 1995.",
    );
    expect(screen.getByText("The band formed in 1994.")).toHaveClass(
      "text-state-danger-text",
      "line-through",
    );
    expect(screen.getByTestId("bio-change-updated")).toHaveClass(
      "border-state-warning",
    );
  });

  it("does not expose a legacy short result over a substantial current bio", async () => {
    const currentBio = [
      "Hot Water Music are a Gainesville, Florida punk outfit known for their raspy vocals and urgent guitars.",
      "The band has released a detailed catalogue across multiple labels and has toured internationally for decades.",
      "Its history includes hiatuses, reunions, side projects, collaborations, and important recording milestones.",
      "The current library biography preserves the band's formation, releases, touring history, lineup changes, recording sessions, label history, and collaborations with related artists.",
      "It also captures the context around the band's songwriting, performances, related projects, and continuing place in the scene so that a short generated summary cannot silently replace it.",
    ].join("\n\n");

    vi.mocked(waitForTask).mockResolvedValueOnce({
      status: "completed",
      result: {
        proposal: "Hot Water Music is a punk band from Florida.",
        bio: { paragraphs: ["Hot Water Music is a punk band from Florida."] },
        sources: [],
      },
    });

    render(
      <ArtistBioResearchDialog
        open
        onOpenChange={vi.fn()}
        artist={artist}
        currentBio={currentBio}
        onApply={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("Existing biography preserved"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(
      screen.getByRole("textbox", { name: "Proposed biography" }),
    ).toHaveValue(currentBio);
  });
});
