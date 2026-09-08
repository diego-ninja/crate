import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMockTrack,
  renderWithListenProviders,
} from "@/test/render-with-listen-providers";
import { setEqualizerEnabled } from "@/lib/equalizer-prefs";

import { PlayerBar, PlayerSurfaceFallback } from "./PlayerBar";

const useIsDesktopMock = vi.hoisted(() => vi.fn(() => false));
const isLikedMock = vi.hoisted(() => vi.fn(() => false));
const likeTrackMock = vi.hoisted(() => vi.fn(async () => true));
const unlikeTrackMock = vi.hoisted(() => vi.fn(async () => true));
const triggerHapticMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: useIsDesktopMock,
}));

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: isLikedMock,
    likeTrack: likeTrackMock,
    unlikeTrack: unlikeTrackMock,
  }),
}));

vi.mock("@/hooks/use-audio-visualizer", () => ({
  useAudioVisualizer: () => ({ frequenciesDb: [], sampleRate: 48_000 }),
}));

vi.mock("@/hooks/use-crossfade-progress", () => ({
  useCrossfadeProgress: () => 1,
  useCrossfadeAwareProgress: (
    _transition: unknown,
    time: number,
    dur: number,
  ) => ({
    displayedTime: time,
    displayedDuration: dur,
  }),
}));

vi.mock("@/hooks/use-crate-connect-enabled", () => ({
  useCrateConnectEnabled: () => false,
}));

vi.mock("@/hooks/use-track-info", () => ({
  useTrackInfo: () => ({ info: null, loading: false }),
}));

vi.mock("@/hooks/use-track-playback", () => ({
  useTrackPlayback: () => ({ resolution: null, loading: false }),
}));

vi.mock("@/lib/crate-connect", () => ({
  CONNECT_SESSION_EVENT: "crate:connect-session",
  CRATE_CONNECT_V2_TRANSPORT_ENABLED: false,
  fetchActiveConnectSnapshot: vi.fn(async () => ({
    session: null,
    state: null,
  })),
  fetchConnectDevices: vi.fn(async () => ({ devices: [] })),
  sendConnectCommand: vi.fn(async () => true),
}));

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: triggerHapticMock,
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: vi.fn(),
  },
}));

vi.mock("@crate/ui/lib/use-dismissible-layer", () => ({
  useDismissibleLayer: vi.fn(),
}));

vi.mock("@/components/player/lazy-player-surfaces", () => ({
  LazyEqualizerPopover: () => null,
  LazyExtendedPlayer: () => null,
  LazyFullscreenPlayer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="fullscreen-player" /> : null,
  LazyLyricsPanel: () => null,
  LazyQueuePanel: () => null,
  preloadEqualizerPopover: vi.fn(),
  preloadExtendedPlayer: vi.fn(),
  preloadFullscreenPlayer: vi.fn(),
  preloadLyricsPanel: vi.fn(),
  preloadQueuePanel: vi.fn(),
}));

vi.mock("@/components/player/bar/PlayerTrackMenu", () => ({
  PlayerTrackMenu: () => <div data-testid="player-track-menu" />,
}));

vi.mock("@/components/player/bar/PlayerVolumeControl", () => ({
  PlayerVolumeControl: () => <div data-testid="player-volume-control" />,
}));

vi.mock("@/components/player/PlaybackTargetMenu", () => ({
  PlaybackTargetMenu: () => <div data-testid="playback-target-menu" />,
}));

vi.mock("@/components/player/bar/WaveformCanvas", () => ({
  WaveformCanvas: () => <canvas data-testid="waveform-canvas" />,
}));

vi.mock("@/components/player/player-gestures", () => ({
  getHorizontalPlayerSwipeAction: vi.fn(() => null),
}));

describe("PlayerBar mobile mini-player", () => {
  beforeEach(() => {
    useIsDesktopMock.mockReturnValue(false);
    localStorage.removeItem("listen-eq-enabled");
    isLikedMock.mockReturnValue(false);
    likeTrackMock.mockClear();
    unlikeTrackMock.mockClear();
    triggerHapticMock.mockClear();
    toastSuccessMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not render like or contextual actions in the mobile mini-player", () => {
    const track = createMockTrack({
      title: "No Buttons",
      artist: "Tidal Mode",
    });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    expect(screen.queryByLabelText("Like track")).toBeNull();
    expect(screen.queryByTestId("player-track-menu")).toBeNull();
  });

  it("uses semantic tokens for player surface fallbacks", () => {
    const mobileFallback = renderWithListenProviders(<PlayerSurfaceFallback />);
    const fullscreenFallback = renderWithListenProviders(
      <PlayerSurfaceFallback fullscreen />,
    );

    expect(
      mobileFallback.container.querySelector(".listen-player-surface-fallback"),
    ).toBeInTheDocument();
    expect(
      fullscreenFallback.container.querySelector(
        ".listen-player-fullscreen-scrim",
      ),
    ).toBeInTheDocument();
    expect(mobileFallback.container.innerHTML).not.toMatch(
      /(?:border|text|bg)-(?:white|black|primary|muted)|rgba\(|shadow-\[/,
    );
    expect(fullscreenFallback.container.innerHTML).not.toMatch(
      /(?:border|text|bg)-(?:white|black|primary|muted)|rgba\(|shadow-\[/,
    );
  });

  it("leaves the mobile dock glass to the shared Shell backdrop", () => {
    const track = createMockTrack({
      title: "Glass Dock",
      artist: "Crate",
    });

    const { container } = renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    expect(container.querySelector(".listen-mobile-player-glass")).toBeNull();
  });

  it("keeps the desktop PlayerBar off the mobile dock glass surface", () => {
    useIsDesktopMock.mockReturnValue(true);
    const track = createMockTrack({
      title: "Desktop Surface",
      artist: "Crate",
    });

    const { container } = renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    expect(container.querySelector(".listen-mobile-player-glass")).toBeNull();
  });

  it("uses semantic tokens for the desktop progress control", () => {
    useIsDesktopMock.mockReturnValue(true);
    const track = createMockTrack({
      title: "Semantic Progress",
      artist: "Crate",
    });

    const { container } = renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    const progress = container.querySelector(".listen-player-progress");

    expect(progress).toBeInTheDocument();
    expect(
      progress?.querySelector(".listen-player-progress-track"),
    ).toBeInTheDocument();
    expect(progress?.innerHTML).not.toContain("rgba(");
  });

  it("uses semantic tokens for desktop transport controls", () => {
    useIsDesktopMock.mockReturnValue(true);
    const track = createMockTrack({
      title: "Semantic Transport",
      artist: "Crate",
    });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    for (const label of [
      "Enable shuffle",
      "Previous track",
      "Next track",
      "Repeat: off",
    ]) {
      const buttons = screen.getAllByRole("button", { name: label });

      for (const button of buttons) {
        expect(button.className).toContain("text-text-");
        expect(button.className).toContain("hover:text-accent-action");
        expect(button.className).toContain("hover:drop-shadow-accent-action");
        expect(button.className).not.toContain("text-white/");
        expect(button.className).not.toContain("rgba(");
      }
    }
  });

  it("uses semantic tokens for the desktop shell and track identity", () => {
    useIsDesktopMock.mockReturnValue(true);
    const track = createMockTrack({
      title: "Semantic Shell Track",
      artist: "Crate",
    });

    const { container } = renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    const shell = container.querySelector(".listen-player-shell");
    const artwork = container.querySelector(".listen-player-artwork");

    expect(shell).toBeInTheDocument();
    expect(artwork).toBeInTheDocument();
    expect(screen.getByText("Semantic Shell Track")).toHaveClass(
      "text-text-primary",
    );
    expect(screen.getByText("Crate")).toHaveClass("text-text-muted");
    expect(shell?.outerHTML).not.toMatch(
      /(?:border|text|bg)-(?:white|black|primary|muted)|rgba\(|shadow-\[/,
    );
  });

  it("uses the accent token for active shuffle and repeat states", () => {
    useIsDesktopMock.mockReturnValue(true);
    const track = createMockTrack({
      title: "Active Transport",
      artist: "Crate",
    });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: {
        currentTrack: track,
        queue: [track],
        shuffle: true,
        repeat: "one",
      },
    });

    const activeGlow = "drop-shadow-accent-action";

    expect(screen.getByRole("button", { name: "Disable shuffle" })).toHaveClass(
      "text-accent-action",
      activeGlow,
    );
    expect(screen.getByRole("button", { name: "Repeat: one" })).toHaveClass(
      "text-accent-action",
      activeGlow,
    );
  });

  it("uses semantic tokens for desktop player actions", () => {
    useIsDesktopMock.mockReturnValue(true);
    const track = createMockTrack({
      title: "Semantic Actions",
      artist: "Crate",
    });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    for (const label of ["Queue", "Lyrics", "Expand player"]) {
      const buttons = screen.getAllByRole("button", { name: label });

      for (const button of buttons) {
        expect(button.className).toContain("text-text-");
        expect(button.className).toContain("hover:text-accent-action");
        expect(button.className).toContain("hover:drop-shadow-accent-action");
        expect(button.className).not.toContain("text-white/");
        expect(button.className).not.toContain("rgba(");
      }
    }
  });

  it("hides the desktop Equalizer access when the global toggle is disabled", async () => {
    useIsDesktopMock.mockReturnValue(true);
    localStorage.setItem("listen-eq-enabled", "true");
    const track = createMockTrack({
      title: "Desktop EQ",
      artist: "Crate",
    });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    expect(screen.getByLabelText("Equalizer")).toBeInTheDocument();

    setEqualizerEnabled(false);

    await waitFor(() => {
      expect(screen.queryByLabelText("Equalizer")).not.toBeInTheDocument();
    });
  });

  it("likes the current track with a long press on the cover", async () => {
    vi.useFakeTimers();
    const track = createMockTrack({
      id: "track-long-press",
      entityUid: "track-uid",
      libraryTrackId: 42,
      path: "/music/long-press.flac",
      title: "Long Press Song",
      artist: "Crate",
      albumCover: "https://example.test/cover.jpg",
    });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    fireEvent.touchStart(screen.getByLabelText("Track artwork"), {
      touches: [{ clientX: 10, clientY: 10 }],
    });
    await vi.advanceTimersByTimeAsync(550);

    expect(likeTrackMock).toHaveBeenCalledWith(
      42,
      "track-uid",
      "/music/long-press.flac",
      null,
    );
    expect(triggerHapticMock).toHaveBeenCalledWith("selection");
    expect(toastSuccessMock).toHaveBeenCalledWith("Added to liked tracks");
  });

  it("shows a liked indicator on the cover when the current track is liked", () => {
    isLikedMock.mockReturnValue(true);
    const track = createMockTrack({
      title: "Liked Song",
      artist: "Crate",
      albumCover: "https://example.test/cover.jpg",
    });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    expect(screen.getByLabelText("Liked track")).toBeInTheDocument();
  });

  it("uses the play button spinner as the only buffering indicator", () => {
    const track = createMockTrack({
      title: "Buffering Song",
      artist: "Crate",
    });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
      playerState: { isBuffering: true },
    });

    expect(screen.queryByText("Buffering...")).toBeNull();
  });

  it("keeps the mobile dock artwork, info, and controls vertically aligned", () => {
    const track = createMockTrack({
      title: "The Season",
      artist: "Minor Empires",
      albumCover: "https://example.test/cover.jpg",
    });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: { currentTrack: track, queue: [track] },
    });

    const trackButton = screen.getByLabelText("Open fullscreen player");
    const mobileRow = trackButton.parentElement;
    const mobilePlayButton = screen
      .getAllByRole("button", { name: "Play" })
      .find((button) => button.className.includes("h-12"));
    const mobileControls = mobilePlayButton?.parentElement;

    expect(mobilePlayButton).toBeInTheDocument();
    expect(mobileRow).toHaveClass("px-4", "pt-3", "pb-0.5");
    expect(mobileControls).toHaveClass("self-stretch");
    expect(mobileControls).not.toHaveClass("translate-y-1");
  });

  it("locks local transport controls for Jam members", () => {
    const pause = vi.fn();
    const resume = vi.fn();
    const next = vi.fn();
    const track = createMockTrack({ title: "Jam track", artist: "Crate" });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: {
        currentTrack: track,
        queue: [track],
        jamQueueLocked: true,
        pause,
        resume,
        next,
        jamTransport: {
          canControl: false,
          togglePlayPause: vi.fn(),
          next: vi.fn(),
          previous: vi.fn(),
          seek: vi.fn(),
        },
      },
    });

    const playButton = screen
      .getAllByRole("button", { name: "Play" })
      .find((button) => button.className.includes("h-12"));
    const nextButton = screen
      .getAllByRole("button", { name: "Next track" })
      .find((button) => button.className.includes("size-12"));

    expect(playButton).toBeDefined();
    expect(nextButton).toBeDefined();
    fireEvent.click(playButton!);
    fireEvent.click(nextButton!);

    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(playButton).toBeDisabled();
    expect(nextButton).toBeDisabled();
  });

  it("keeps the global transport controls read-only for Jam hosts", () => {
    const togglePlayPause = vi.fn();
    const next = vi.fn();
    const track = createMockTrack({
      title: "Jam owner track",
      artist: "Crate",
    });

    renderWithListenProviders(<PlayerBar />, {
      playerActions: {
        currentTrack: track,
        queue: [track],
        jamQueueLocked: true,
        jamTransport: {
          canControl: true,
          togglePlayPause,
          next,
          previous: vi.fn(),
          seek: vi.fn(),
        },
      },
    });

    const playButton = screen
      .getAllByRole("button", { name: "Play" })
      .find((button) => button.className.includes("h-12"));
    const nextButton = screen
      .getAllByRole("button", { name: "Next track" })
      .find((button) => button.className.includes("size-12"));

    fireEvent.click(playButton!);
    fireEvent.click(nextButton!);

    expect(playButton).toBeDisabled();
    expect(nextButton).toBeDisabled();
    expect(togglePlayPause).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
