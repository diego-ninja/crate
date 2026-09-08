import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMockPlayerActions,
  createMockTrack,
  renderWithListenProviders,
} from "@/test/render-with-listen-providers";
import type { PlayerSurfaceMode } from "@/lib/player-visualizer-prefs";

import { ExtendedPlayer } from "./ExtendedPlayer";

const useIsDesktopMock = vi.hoisted(() => vi.fn(() => true));
type MockVisualizerConfig = {
  surfaceMode: PlayerSurfaceMode;
  useAlbumPalette: boolean;
  trackVizProfile: { hasAnalysis: boolean; summary: string | null };
  setSurfaceMode: (mode: PlayerSurfaceMode) => void;
};

const useVisualizerConfigMock = vi.hoisted(() =>
  vi.fn<() => MockVisualizerConfig>(() => ({
    surfaceMode: "cd",
    useAlbumPalette: false,
    trackVizProfile: { hasAnalysis: false, summary: null },
    setSurfaceMode: vi.fn<(mode: PlayerSurfaceMode) => void>(),
  })),
);

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: useIsDesktopMock,
}));

vi.mock("@/components/player/SpinningDisc", () => ({
  SpinningDisc: () => <div data-testid="spinning-disc" />,
}));

vi.mock("@/components/player/PlayerTrackIdentity", () => ({
  PlayerTrackIdentity: () => <div data-testid="player-track-identity" />,
}));

vi.mock("@/components/player/bar/PlayerSeekBar", () => ({
  PlayerSeekBar: () => <div data-testid="seek-bar" />,
}));

vi.mock("@/components/player/extended/QueueTab", () => ({
  QueueTab: () => <div data-testid="queue-tab" />,
}));

vi.mock("@/components/player/extended/LyricsTab", () => ({
  LyricsTab: () => null,
}));

vi.mock("@/components/player/extended/SuggestedTab", () => ({
  SuggestedTab: () => null,
}));

vi.mock("@/components/player/extended/InfoTab", () => ({
  InfoTab: () => null,
}));

vi.mock("@/components/player/useResolvedPlayerArtist", () => ({
  useResolvedPlayerArtist: () => ({
    resolvedArtist: null,
    artistAvatarUrl: null,
    markArtistPhotoFailed: vi.fn(),
  }),
}));

vi.mock("@/components/player/player-source", () => ({
  getPlaySourceLabel: () => null,
}));

vi.mock("@/components/player/visualizer/useMusicVisualizer", () => ({
  useMusicVisualizer: () => undefined,
}));

vi.mock("@/components/player/visualizer/useVisualizerConfig", () => ({
  useVisualizerConfig: useVisualizerConfigMock,
}));

vi.mock("@/hooks/use-crossfade-progress", () => ({
  useCrossfadeProgress: () => 1,
  useCrossfadeAwareProgress: (
    _transition: unknown,
    time: number,
    duration: number,
  ) => ({
    displayedTime: time,
    displayedDuration: duration,
  }),
}));

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}));

vi.mock("@crate/ui/lib/use-dismissible-layer", () => ({
  useDismissibleLayer: vi.fn(),
}));

vi.mock("@crate/ui/lib/use-escape-key", () => ({
  useEscapeKey: vi.fn(),
}));

describe("ExtendedPlayer", () => {
  beforeEach(() => {
    localStorage.removeItem("listen-eq-enabled");
    useIsDesktopMock.mockReturnValue(true);
  });

  it("hides the desktop Equalizer access when it is globally disabled", () => {
    localStorage.setItem("listen-eq-enabled", "false");
    const track = createMockTrack({
      id: "extended-eq-track",
      entityUid: "extended-eq-track",
      title: "Extended EQ",
      artist: "Crate",
    });

    renderWithListenProviders(
      <ExtendedPlayer open={false} onClose={vi.fn()} />,
      {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      },
    );

    expect(screen.queryByLabelText("Equalizer")).not.toBeInTheDocument();
  });

  it("uses semantic tokens for the player chrome and tabs", async () => {
    localStorage.setItem("listen-eq-enabled", "true");
    const user = userEvent.setup();
    const track = createMockTrack({
      id: "extended-chrome-track",
      entityUid: "extended-chrome-track",
      title: "Extended chrome",
      artist: "Crate",
    });

    renderWithListenProviders(
      <ExtendedPlayer open={false} onClose={vi.fn()} />,
      {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      },
    );

    const closeButton = screen.getByLabelText("Close player");
    const equalizerButton = screen.getByLabelText("Equalizer");
    const visualizerSettingsButton = screen.getByLabelText(
      "Visualizer settings",
    );
    const activeTab = screen.getByRole("button", { name: "Queue" });
    const inactiveTab = screen.getByRole("button", { name: "Suggested" });

    for (const button of [closeButton, equalizerButton]) {
      expect(button).toHaveClass(
        "bg-surface-control",
        "text-text-secondary",
        "hover:bg-surface-control-hover",
        "hover:text-text-primary",
      );
      expect(button.className).not.toContain("black/");
      expect(button.className).not.toContain("white/");
    }

    expect(visualizerSettingsButton).toHaveClass(
      "bg-surface-icon-control",
      "text-text-faint",
    );
    expect(visualizerSettingsButton.className).not.toContain("black/");
    expect(visualizerSettingsButton.className).not.toContain("white/");

    expect(activeTab).toHaveClass("bg-surface-control", "text-text-primary");
    expect(inactiveTab).toHaveClass(
      "text-text-muted",
      "hover:text-text-secondary",
    );
    expect(activeTab.className).not.toContain("white/");
    expect(inactiveTab.className).not.toContain("white/");

    await user.click(equalizerButton);
    expect(equalizerButton).toHaveClass(
      "bg-accent-action/18",
      "text-accent-action",
      "drop-shadow-accent-action",
    );
  });

  it("uses semantic tokens for the artwork surface", () => {
    useVisualizerConfigMock.mockReturnValue({
      surfaceMode: "cover",
      useAlbumPalette: false,
      trackVizProfile: { hasAnalysis: true, summary: "Analyzed" },
      setSurfaceMode: vi.fn(),
    });
    const track = createMockTrack({
      id: "extended-artwork-track",
      entityUid: "extended-artwork-track",
      title: "Extended artwork",
      artist: "Crate",
    });

    const { container } = renderWithListenProviders(
      <ExtendedPlayer open={false} onClose={vi.fn()} />,
      {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      },
    );

    expect(container.innerHTML).toContain("bg-accent-action/10");
    expect(container.innerHTML).toContain("border-border-quiet");
    expect(container.innerHTML).toContain("bg-surface-quiet-subtle");
    expect(container.innerHTML).toContain("shadow-player-artwork");
    expect(container.innerHTML).toContain("text-text-muted");
    expect(container.innerHTML).not.toContain("bg-primary/10");
    expect(container.innerHTML).not.toContain("border-white/10");
    expect(container.innerHTML).not.toContain("bg-white/[0.02]");
    expect(container.innerHTML).not.toContain("bg-white/5");
    expect(container.innerHTML).not.toContain("text-white/40");
  });

  it("uses the layered semantic shadow for visible cover art", () => {
    useVisualizerConfigMock.mockReturnValue({
      surfaceMode: "cover",
      useAlbumPalette: false,
      trackVizProfile: { hasAnalysis: false, summary: null },
      setSurfaceMode: vi.fn(),
    });
    const track = createMockTrack({
      id: "extended-visible-artwork-track",
      entityUid: "extended-visible-artwork-track",
      title: "Visible artwork",
      artist: "Crate",
      albumCover: "/cover.jpg",
    });

    const { container } = renderWithListenProviders(
      <ExtendedPlayer open={false} onClose={vi.fn()} />,
      {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      },
    );

    expect(container.innerHTML).toContain("shadow-player-artwork-layered");
  });
});
