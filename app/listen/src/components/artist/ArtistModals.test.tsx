import { MemoryRouter } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

import { ArtistBioModal } from "./ArtistBioModal";
import { ArtistBioMembers } from "@crate/ui/domain/ArtistBioProfile";
import { ArtistSetlistModal } from "./ArtistSetlistSection";
import { I18nProvider } from "@/i18n";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: apiMock,
  };
});

describe("artist mobile modals", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockRejectedValue(new Error("skip enrichment in modal tests"));
  });

  it("renders probable setlist as a native bottom sheet instead of a floating panel", () => {
    renderWithProviders(
      <ArtistSetlistModal
        artistName="Kneecap"
        artistId={7}
        open
        onClose={() => {}}
        onPlay={() => {}}
        setlist={[
          {
            title: "Smugglers & Scholars",
            frequency: 0.8,
            play_count: 12,
          },
        ]}
      />,
    );

    const panel = screen
      .getByText("Probable Setlist")
      .closest(".listen-glass-panel");
    expect(panel).toBeInTheDocument();
    expect(panel).not.toHaveClass("fixed");
    expect(panel?.className).not.toContain(
      "listen-mobile-bottom-chrome-height",
    );
  });

  it("renders artist bio as a native bottom sheet instead of a floating panel", () => {
    renderWithProviders(
      <ArtistBioModal
        open
        onClose={() => {}}
        photoUrl="/artist.jpg"
        tags={["hip-hop"]}
        artist={{
          id: 7,
          name: "Kneecap",
          albums: [],
          total_tracks: 0,
          total_size_mb: 0,
          primary_format: null,
          genres: ["hip-hop"],
          issue_count: 0,
        }}
        artistInfo={{
          bio: "Belfast trio.",
          tags: ["hip-hop"],
          similar: [],
          listeners: 1000,
          playcount: 2000,
          image_url: null,
          url: "",
        }}
      />,
    );

    const panel = screen.getByText("Kneecap").closest(".listen-glass-panel");
    expect(panel).toBeInTheDocument();
    expect(panel).not.toHaveClass("fixed");
    expect(panel?.className).not.toContain(
      "listen-mobile-bottom-chrome-height",
    );
  });

  it("shows the complete multi-paragraph biography when the bio sheet opens", () => {
    renderWithProviders(
      <ArtistBioModal
        open
        onClose={() => {}}
        photoUrl="/artist.jpg"
        tags={[]}
        artist={{
          id: 7,
          name: "Kneecap",
          albums: [],
          total_tracks: 0,
          total_size_mb: 0,
          primary_format: null,
          genres: [],
          issue_count: 0,
        }}
        artistInfo={{
          bio: `${"First paragraph. ".repeat(40)}\n\nSecond paragraph.`,
          tags: [],
          similar: [],
          listeners: 0,
          playcount: 0,
          image_url: null,
          url: "",
        }}
      />,
    );

    expect(screen.getByText("Second paragraph.")).toBeInTheDocument();
  });

  it("separates current and former members in the artist bio profile", () => {
    renderWithProviders(
      <ArtistBioMembers
        members={[
          { name: "Current Member", begin: "2020" },
          { name: "Former Member", begin: "2015", end: "2019" },
        ]}
      />,
    );

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

  it("renders artist genres in the bio sheet with genre pill styling and clean sheet chrome", () => {
    renderWithProviders(
      <ArtistBioModal
        open
        onClose={() => {}}
        photoUrl="/artist.jpg"
        tags={["hardcore", "mathcore", "metalcore", "noise"]}
        artist={{
          id: 7,
          name: "Converge",
          albums: [],
          total_tracks: 0,
          total_size_mb: 0,
          primary_format: null,
          genres: ["hardcore", "mathcore", "metalcore", "noise"],
          genre_profile: [
            { name: "Hardcore", slug: "hardcore", source: "lastfm" },
            { name: "Mathcore", slug: "mathcore", source: "lastfm" },
            { name: "Metalcore", slug: "metalcore", source: "lastfm" },
            { name: "Noise", slug: "noise", source: "lastfm" },
          ],
          issue_count: 0,
        }}
        artistInfo={{
          bio: "Converge bio.",
          tags: ["hardcore", "mathcore", "metalcore", "noise"],
          similar: [],
          listeners: 1000,
          playcount: 2000,
          image_url: null,
          url: "",
        }}
      />,
    );

    const panel = screen.getByText("Converge").closest(".listen-glass-panel");
    const header = screen.getByTestId("artist-bio-header");
    const hardcore = screen.getByRole("button", { name: /hardcore/i });
    const metalcore = screen.getByRole("button", { name: /metalcore/i });
    const close = screen.getByRole("button", { name: "Close" });

    expect(panel).toContainElement(hardcore);
    expect(panel).toContainElement(metalcore);
    expect(screen.queryByRole("button", { name: /noise/i })).toBeNull();
    expect(hardcore).toHaveClass("rounded-md");
    expect(hardcore).not.toHaveClass("rounded-full", "bg-white/8");
    expect(header).toHaveClass("border-b-0", "bg-transparent");
    expect(header).not.toHaveClass("backdrop-blur-xl");
    expect(close).toHaveClass("hover:text-accent-action");
    expect(close.className).not.toContain("bg-white/5");
    expect(close.className).not.toContain("border-white/10");
  });

  it("refetches enrichment when the open modal switches artists", async () => {
    const { rerender } = renderWithProviders(
      <ArtistBioModal
        open
        onClose={() => {}}
        photoUrl="/artist.jpg"
        tags={[]}
        artist={{
          id: 7,
          name: "Kneecap",
          albums: [],
          total_tracks: 0,
          total_size_mb: 0,
          primary_format: null,
          genres: [],
          issue_count: 0,
        }}
        artistInfo={{
          bio: "Belfast trio.",
          tags: [],
          similar: [],
          listeners: 0,
          playcount: 0,
          image_url: null,
          url: "",
        }}
      />,
    );

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith("/api/artists/7/enrichment");
    });

    rerender(
      <MemoryRouter>
        <I18nProvider initialLocale="en">
          <ArtistBioModal
            open
            onClose={() => {}}
            photoUrl="/artist.jpg"
            tags={[]}
            artist={{
              id: 8,
              name: "Converge",
              albums: [],
              total_tracks: 0,
              total_size_mb: 0,
              primary_format: null,
              genres: [],
              issue_count: 0,
            }}
            artistInfo={{
              bio: "Boston band.",
              tags: [],
              similar: [],
              listeners: 0,
              playcount: 0,
              image_url: null,
              url: "",
            }}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith("/api/artists/8/enrichment");
    });
  });
});

function renderWithProviders(ui: ReactElement) {
  return render(
    <MemoryRouter>
      <I18nProvider initialLocale="en">{ui}</I18nProvider>
    </MemoryRouter>,
  );
}
