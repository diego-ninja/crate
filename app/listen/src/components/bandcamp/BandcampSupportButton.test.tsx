import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BandcampSupportButton } from "@/components/bandcamp/BandcampSupportButton";
import { I18nProvider } from "@/i18n/I18nProvider";
import { api } from "@/lib/api";
import { openExternalUrl } from "@/lib/external-links";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

vi.mock("@/lib/external-links", () => ({
  openExternalUrl: vi.fn(),
}));

const mockApi = vi.mocked(api);
const mockOpenExternalUrl = vi.mocked(openExternalUrl);

function renderWithI18n(ui: ReactElement) {
  return render(<I18nProvider initialLocale="en">{ui}</I18nProvider>);
}

describe("BandcampSupportButton", () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockOpenExternalUrl.mockReset();
  });

  it("shows an owned badge instead of a buy CTA for purchased albums", async () => {
    mockApi.mockResolvedValueOnce({
      entity_type: "album",
      entity_uid: "album-1",
      album_url: "https://artist.bandcamp.com/album/lp",
      user_owned: true,
      user_downloadable: true,
      latest_import_status: "completed",
    });

    renderWithI18n(
      <BandcampSupportButton entityType="album" entityUid="album-1" />,
    );

    expect(await screen.findByText("Owned on Bandcamp")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /buy this album/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the import CTA for owned downloadable albums that are not imported", async () => {
    mockApi.mockResolvedValueOnce({
      entity_type: "album",
      entity_uid: "album-2",
      bandcamp_item_id: 42,
      album_url: "https://artist.bandcamp.com/album/lp",
      user_owned: true,
      user_downloadable: true,
      latest_import_status: null,
    });

    renderWithI18n(
      <BandcampSupportButton entityType="album" entityUid="album-2" />,
    );

    expect(await screen.findByText("Import from Bandcamp")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import from bandcamp/i }),
    ).toBeInTheDocument();
  });

  it("shows the buy CTA for albums that are not owned by the user", async () => {
    mockApi.mockResolvedValueOnce({
      entity_type: "album",
      entity_uid: "album-3",
      album_url: "https://artist.bandcamp.com/album/lp",
      user_owned: false,
      user_downloadable: false,
      latest_import_status: null,
    });

    renderWithI18n(
      <BandcampSupportButton entityType="album" entityUid="album-3" />,
    );

    expect(
      await screen.findByText("Buy this album on Bandcamp"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /buy this album on bandcamp/i }),
    ).toBeInTheDocument();
  });

  it("opens Bandcamp links through the external opener", async () => {
    mockApi.mockResolvedValueOnce({
      entity_type: "artist",
      entity_uid: "artist-1",
      artist_url: "https://highvis.bandcamp.com",
      user_owned: false,
      user_downloadable: false,
      latest_import_status: null,
    });

    renderWithI18n(
      <BandcampSupportButton entityType="artist" entityUid="artist-1" />,
    );

    await userEvent.click(await screen.findByText("Support on Bandcamp"));

    expect(mockOpenExternalUrl).toHaveBeenCalledWith(
      "https://highvis.bandcamp.com",
    );
  });

  it("falls back to the artist Bandcamp link when an album link is missing", async () => {
    mockApi
      .mockResolvedValueOnce({
        entity_type: "album",
        entity_uid: "album-1",
        album_url: null,
        item_url: null,
        artist_url: null,
      })
      .mockResolvedValueOnce({
        entity_type: "artist",
        entity_uid: "artist-1",
        artist_url: "https://highvis.bandcamp.com",
        user_owned: false,
        user_downloadable: false,
        latest_import_status: null,
      });

    renderWithI18n(
      <BandcampSupportButton
        entityType="album"
        entityUid="album-1"
        fallbackArtistEntityUid="artist-1"
      />,
    );

    expect(await screen.findByText("Support on Bandcamp")).toBeInTheDocument();
  });

  it("uses the artist URL returned by an album link when the album URL is missing", async () => {
    mockApi.mockResolvedValueOnce({
      entity_type: "album",
      entity_uid: "album-4",
      album_url: null,
      item_url: null,
      artist_url: "https://artist-only.bandcamp.com",
      user_owned: false,
      user_downloadable: false,
      latest_import_status: null,
    });

    renderWithI18n(
      <BandcampSupportButton entityType="album" entityUid="album-4" />,
    );

    await userEvent.click(await screen.findByText("Support on Bandcamp"));

    expect(mockOpenExternalUrl).toHaveBeenCalledWith(
      "https://artist-only.bandcamp.com",
    );
  });

  it("can render as a frameless secondary action with a visible label", async () => {
    mockApi.mockResolvedValueOnce({
      entity_type: "artist",
      entity_uid: "artist-2",
      artist_url: "https://crossed.bandcamp.com",
      user_owned: false,
      user_downloadable: false,
      latest_import_status: null,
    });

    renderWithI18n(
      <BandcampSupportButton
        entityType="artist"
        entityUid="artist-2"
        presentation="secondary-action"
      />,
    );

    const action = await screen.findByRole("button", {
      name: /support on bandcamp/i,
    });
    expect(action).toHaveTextContent("Bandcamp");
    expect(action).toHaveClass("hover:text-accent-action");
    expect(action.className).toContain("hover:drop-shadow");
    expect(action).not.toHaveClass("rounded-full");
  });
});
