import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/PlayerContext", () => ({
  usePlayerActions: () => ({
    currentTrack: {
      id: "track-1",
      entityUid: "track-1",
      title: "Track One",
      artist: "Artist One",
      album: "Album One",
      artistId: 1,
      albumId: 1,
      albumCover: "/api/albums/1/cover",
    },
  }),
}));

vi.mock("@/hooks/use-track-info", () => ({
  useTrackInfo: () => ({
    loading: false,
    info: {
      title: "Track One",
      artist: "Artist One",
      album: "Album One",
      format: "flac",
      bitrate: 1_411,
      sample_rate: 96_000,
      bit_depth: 24,
      bpm: 128,
      audio_key: "C",
      audio_scale: "minor",
      energy: 0.8,
      danceability: 0.7,
      valence: 0.6,
      acousticness: 0.2,
      instrumentalness: 0.4,
      loudness: -8.4,
      dynamic_range: 9.2,
      mood_json: { focused: 0.8 },
      lastfm_listeners: 1_000,
      lastfm_playcount: 2_000,
      popularity: 75,
      rating: 4,
      bliss_signature: { texture: 0.7, motion: 0.6, density: 0.8 },
    },
  }),
}));

vi.mock("@/components/artwork/CrateImage", () => ({
  CrateImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img {...props} />
  ),
}));

vi.mock("@/lib/palette", () => ({
  extractPalette: vi.fn(async () => [
    [0.1, 0.2, 0.3],
    [0.3, 0.4, 0.5],
    [0.5, 0.6, 0.7],
  ]),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
}));

import { InfoTab } from "./InfoTab";

describe("InfoTab", () => {
  it("uses semantic tokens for analysis surfaces and dynamic artwork palette", async () => {
    const { container } = render(<InfoTab />);

    await waitFor(() => {
      expect(container.querySelector(".info-tab-hero")).toBeInTheDocument();
    });

    expect(container.querySelector(".info-tab-stat-card")).toBeInTheDocument();
    expect(
      container.querySelector('.info-tab-metric-fill[data-tone="primary"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('.info-tab-metric-fill[data-tone="warm"]'),
    ).toBeInTheDocument();
    expect(screen.getByText("Focused 80%")).toHaveClass("info-tab-mood-pill");
    expect(container.innerHTML).not.toContain("rgba(");
    expect(container.innerHTML).not.toContain("border-white");
    expect(container.innerHTML).not.toContain("text-white");
  });
});
