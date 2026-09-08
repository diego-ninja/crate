import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { useApi } from "@/hooks/use-api";

import { UserProfile } from "@/pages/UserProfile";

vi.mock("@/hooks/use-api", () => ({
  useApi: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn(async () => ({ ok: true })),
  getApiBase: vi.fn(() => ""),
  getAuthToken: vi.fn(() => null),
}));

describe("UserProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders social identity, listening DNA summary, and contributions", () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        id: 7,
        username: "jane",
        display_name: "Jane Doe",
        avatar: null,
        bio: "Post-hardcore lifer",
        joined_at: "2026-01-01T00:00:00Z",
        followers_count: 12,
        following_count: 9,
        friends_count: 3,
        public_playlists: [],
        relationship_state: {
          following: false,
          followed_by: false,
          is_friend: false,
        },
        affinity_score: 87,
        affinity_band: "high",
        affinity_reasons: ["shared artists"],
        followers_preview: [],
        following_preview: [],
        top_genre: {
          name: "post-hardcore",
          play_count: 24,
          minutes_listened: 80,
        },
        stats: {
          plays_30d: 35,
          minutes_30d: 140,
          contributions: 1,
          public_playlists: 0,
        },
        badges: [{ key: "contributor", label: "Contributor", tone: "cyan" }],
        contributions_preview: [
          {
            id: 31,
            source: "upload",
            album_id: 4,
            album_entity_uid: "9bcb4ac9-3d22-44bb-9de0-c57f78a0d1fb",
            album_slug: "public-record",
            artist_name: "Jane Band",
            album_name: "Public Record",
            has_cover: false,
            imported_at: "2026-03-01T00:00:00Z",
          },
        ],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { container } = renderWithListenProviders(<UserProfile />, {
      route: "/users/jane",
      path: "/users/:username",
      auth: {
        user: {
          id: 1,
          email: "viewer@example.test",
          name: "Viewer",
          role: "user",
        },
      },
    });

    expect(screen.getByRole("heading", { name: "Jane Doe" })).toBeVisible();
    expect(screen.getByText("post-hardcore")).toBeVisible();
    expect(screen.getByText("Contributor")).toBeVisible();
    expect(screen.getByText("35")).toBeVisible();
    expect(screen.getByText("2h 20m")).toBeVisible();
    expect(screen.getByText("Public Record")).toBeVisible();
    expect(screen.getByText("Jane Band")).toBeVisible();
    expect(screen.getByText("via upload")).toBeVisible();
    expect(container.querySelector(".user-profile-hero")).toBeInTheDocument();
    expect(container.querySelector(".user-profile-card")).toBeInTheDocument();
    expect(
      container.querySelector(".user-profile-accent-panel"),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".user-profile-affinity-high"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /View Crate DNA/i }),
    ).toHaveAttribute("href", "/users/jane/stats");
  });

  it("localizes public profile chrome", () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        id: 7,
        username: "jane",
        display_name: "Jane Doe",
        avatar: null,
        bio: null,
        joined_at: "2026-01-01T00:00:00Z",
        followers_count: 12,
        following_count: 9,
        friends_count: 3,
        public_playlists: [],
        relationship_state: {
          following: true,
          followed_by: false,
          is_friend: true,
        },
        affinity_score: 87,
        affinity_band: "high",
        affinity_reasons: [],
        followers_preview: [],
        following_preview: [],
        top_genre: null,
        stats: {
          plays_30d: 35,
          minutes_30d: 140,
          contributions: 0,
          public_playlists: 0,
        },
        badges: [],
        contributions_preview: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithListenProviders(<UserProfile />, {
      locale: "es",
      route: "/users/jane",
      path: "/users/:username",
      auth: {
        user: {
          id: 1,
          email: "viewer@example.test",
          name: "Viewer",
          role: "user",
        },
      },
    });

    expect(screen.getAllByText("Amigos")).toHaveLength(2);
    expect(screen.getByText(/Se unió en/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Ver Crate DNA/i }),
    ).toHaveAttribute("href", "/users/jane/stats");
    expect(screen.getByRole("button", { name: "Siguiendo" })).toBeVisible();
    expect(screen.getByText("Afinidad")).toBeVisible();
    expect(screen.getByText("Aún mapeando")).toBeVisible();
    expect(screen.getByText("Contribuciones a la biblioteca")).toBeVisible();
    expect(screen.getByText("Aún no hay playlists públicas.")).toBeVisible();
  });
});
