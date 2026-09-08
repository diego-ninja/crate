import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { api } from "@/lib/api";
import {
  clearProfileCardCacheForTests,
  ProfileHoverCard,
} from "@/components/social/ProfileHoverCard";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

const mockApi = vi.mocked(api);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mockDesktop(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function profileCard(overrides = {}) {
  return {
    id: 7,
    username: "jane",
    display_name: "Jane",
    avatar: null,
    bio: null,
    relationship_state: {
      following: false,
      followed_by: true,
      is_friend: false,
    },
    affinity_score: 82,
    affinity_band: "high",
    affinity_reasons: ["3 shared top artists"],
    top_genre: {
      name: "screamo",
      play_count: 24,
      minutes_listened: 180,
    },
    stats: {
      plays_30d: 126,
      minutes_30d: 640,
      contributions: 8,
      public_playlists: 3,
    },
    badges: [
      { key: "contributor", label: "Contributor", tone: "cyan" },
      { key: "curator", label: "Curator", tone: "rose" },
    ],
    ...overrides,
  };
}

describe("ProfileHoverCard", () => {
  beforeEach(() => {
    clearProfileCardCacheForTests();
    mockApi.mockReset();
    mockDesktop(true);
  });

  it("loads and renders a desktop profile card on hover", async () => {
    mockApi.mockResolvedValueOnce(profileCard());

    renderWithListenProviders(
      <ProfileHoverCard username="jane" openDelayMs={0}>
        <a href="/users/jane">@jane</a>
      </ProfileHoverCard>,
    );

    fireEvent.pointerEnter(screen.getByText("@jane").parentElement!);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith("/api/users/jane/card");
    });
    expect(await screen.findByText("Jane")).toBeInTheDocument();
    expect(screen.getByText("Jane")).toHaveClass("profile-hover-title");
    expect(screen.getAllByText("82").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("screamo")).toHaveClass("profile-hover-top-genre");
    expect(screen.getAllByText("Contributor")[1]).toHaveClass(
      "profile-hover-badge-cyan",
    );
  });

  it("does not cancel a slow card request when loading state changes", async () => {
    const pending = deferred<ReturnType<typeof profileCard>>();
    mockApi.mockReturnValueOnce(pending.promise);

    renderWithListenProviders(
      <ProfileHoverCard username="jane" openDelayMs={0}>
        <a href="/users/jane">@jane</a>
      </ProfileHoverCard>,
    );

    fireEvent.pointerEnter(screen.getByText("@jane").parentElement!);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith("/api/users/jane/card");
    });
    expect(
      screen.getByRole("status", { name: "Loading profile card" }),
    ).toBeInTheDocument();

    pending.resolve(profileCard({ display_name: "Slow Jane" }));

    expect(await screen.findByText("Slow Jane")).toBeInTheDocument();
  });

  it("does not fetch cards on mobile layouts", async () => {
    mockDesktop(false);

    renderWithListenProviders(
      <ProfileHoverCard username="jane" openDelayMs={0}>
        <a href="/users/jane">@jane</a>
      </ProfileHoverCard>,
    );

    fireEvent.pointerEnter(screen.getByText("@jane").parentElement!);

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(mockApi).not.toHaveBeenCalled();
    expect(screen.queryByText("Match")).not.toBeInTheDocument();
  });

  it("can follow a user from the card", async () => {
    mockApi.mockResolvedValueOnce(profileCard()).mockResolvedValueOnce({
      relationship_state: {
        following: true,
        followed_by: true,
        is_friend: true,
      },
    });

    renderWithListenProviders(
      <ProfileHoverCard username="jane" openDelayMs={0}>
        <a href="/users/jane">@jane</a>
      </ProfileHoverCard>,
    );

    fireEvent.pointerEnter(screen.getByText("@jane").parentElement!);
    await screen.findByText("Jane");

    fireEvent.click(screen.getByTitle("Follow"));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith("/api/users/7/follow", "POST");
    });
    expect(await screen.findByTitle("Following")).toBeInTheDocument();
  });
});
