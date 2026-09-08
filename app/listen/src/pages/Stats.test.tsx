import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApi } from "@/hooks/use-api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import type { StatsDashboard } from "@/components/stats/stats-model";

import { Stats } from "./Stats";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

const mockUseApi = vi.mocked(useApi);

describe("Stats page", () => {
  beforeEach(() => {
    mockUseApi.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("localizes the main stats chrome", () => {
    renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "es",
    });

    expect(screen.getByText("Crate DNA")).toBeInTheDocument();
    expect(screen.getByText("Tu sonido")).toBeInTheDocument();
    expect(screen.getByText("descifrado")).toBeInTheDocument();
    expect(screen.getByText("Tu Crate DNA")).toBeInTheDocument();
    expect(screen.getByText("Crate Pulse")).toBeInTheDocument();
    expect(
      screen.getByText("Tus estadísticas esperan una señal"),
    ).toBeInTheDocument();
  });

  it("uses semantic tokens for the stats shell and hero", () => {
    const { container } = renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "es",
    });

    expect(
      container.querySelector(".stats-page-atmosphere"),
    ).toBeInTheDocument();
    expect(container.querySelector(".stats-page-grid")).toBeInTheDocument();

    const hero = container.querySelector(".stats-hero-surface");
    expect(hero).toBeInTheDocument();
    expect(hero).not.toHaveClass("bg-[#101116]");
    expect(hero).not.toHaveClass("shadow-black/35");
    expect(hero?.querySelector(".stats-hero-overlay")).toBeInTheDocument();

    const heroTitle = container.querySelector(".stats-hero-title");
    expect(heroTitle).toBeInTheDocument();
    expect(heroTitle).not.toHaveClass("text-white");
    expect(container.querySelectorAll(".stats-hero-metric")).toHaveLength(3);
  });

  it("localizes data-backed stats panels", () => {
    const dashboard: StatsDashboard = {
      window: "30d",
      subject: {
        kind: "user",
        username: "listener",
        display_name: "Listener",
      },
      overview: {
        window: "30d",
        play_count: 12,
        complete_play_count: 10,
        skip_count: 2,
        minutes_listened: 64,
        active_days: 4,
        skip_rate: 0.16,
        top_artist: {
          artist_name: "Fugazi",
          play_count: 8,
          minutes_listened: 42,
        },
      },
      trends: {
        window: "30d",
        points: [
          {
            day: "2026-07-01",
            play_count: 6,
            complete_play_count: 5,
            skip_count: 1,
            minutes_listened: 32,
          },
        ],
      },
      top_tracks: {
        window: "30d",
        items: [
          {
            track_id: 1,
            track_path: "/music/fugazi/waiting-room.flac",
            title: "Waiting Room",
            artist: "Fugazi",
            album: "13 Songs",
            energy: 0.72,
            danceability: 0.42,
            valence: 0.34,
            play_count: 6,
            complete_play_count: 5,
            minutes_listened: 18,
          },
        ],
      },
      top_artists: {
        window: "30d",
        items: [
          {
            artist_name: "Fugazi",
            play_count: 8,
            complete_play_count: 7,
            minutes_listened: 42,
          },
        ],
      },
      top_albums: {
        window: "30d",
        items: [
          {
            artist: "Fugazi",
            album: "13 Songs",
            play_count: 6,
            complete_play_count: 5,
            minutes_listened: 18,
          },
        ],
      },
      top_genres: {
        window: "30d",
        items: [],
      },
      replay: {
        window: "30d",
        title: "Replay",
        subtitle: "Snapshot",
        track_count: 0,
        minutes_listened: 0,
        items: [],
      },
      viewer_affinity: {
        affinity_score: 82,
        affinity_band: "very_high",
        affinity_reasons: ["Fugazi"],
      },
    };

    mockUseApi.mockReturnValue({
      data: dashboard,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithListenProviders(<Stats />, {
      route: "/users/listener/stats",
      path: "/users/:username/stats",
      locale: "es",
    });

    expect(screen.getByText("Coincidencia de oyente")).toBeInTheDocument();
    expect(screen.getByText("82% de afinidad")).toBeInTheDocument();
    expect(screen.getByText("Fugazi lideró este periodo")).toBeInTheDocument();
    expect(screen.getAllByText(/1 jul/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Señal 01")).toBeInTheDocument();
    expect(screen.getByText("Tu perfil sonoro")).toBeInTheDocument();
    expect(screen.getByText("Energía")).toBeInTheDocument();
    expect(screen.getByText("Movimiento")).toBeInTheDocument();
    expect(screen.getByText("Luminosidad")).toBeInTheDocument();
    expect(screen.getByText("BPM medio")).toBeInTheDocument();
    expect(screen.getByText("Tasa de saltos")).toBeInTheDocument();
    expect(
      screen.getByText("La señal de géneros aparecerá aquí."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tu replay aparecerá cuando escuches un poco más."),
    ).toBeInTheDocument();
  });

  it("uses global album artwork for remote replay tracks", () => {
    const dashboard: StatsDashboard = {
      window: "30d",
      overview: {
        window: "30d",
        play_count: 1,
        complete_play_count: 1,
        skip_count: 0,
        minutes_listened: 3,
        active_days: 1,
        skip_rate: 0,
        top_artist: null,
      },
      trends: {
        window: "30d",
        points: [],
      },
      top_tracks: {
        window: "30d",
        items: [],
      },
      top_artists: {
        window: "30d",
        items: [],
      },
      top_albums: {
        window: "30d",
        items: [],
      },
      top_genres: {
        window: "30d",
        items: [],
      },
      replay: {
        window: "30d",
        title: "Replay",
        subtitle: "Snapshot",
        track_count: 1,
        minutes_listened: 3,
        items: [
          {
            track_id: null,
            global_track_uid: "track-global-1",
            global_artist_uid: "artist-global-1",
            global_album_uid: "album-global-1",
            track_path: null,
            title: "0151",
            artist: "High Vis",
            album: "Blending",
            play_count: 1,
            complete_play_count: 1,
            minutes_listened: 3,
          },
        ],
      },
    };

    mockUseApi.mockReturnValue({
      data: dashboard,
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { container } = renderWithListenProviders(<Stats />, {
      route: "/stats",
      path: "/stats",
      locale: "es",
    });

    expect(container.innerHTML).toContain(
      "/api/catalog/albums/album-global-1/cover",
    );
  });
});
