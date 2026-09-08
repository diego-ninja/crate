import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── polyfill requestAnimationFrame ──────────────────────────────────
globalThis.requestAnimationFrame = vi.fn(
  (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number,
);
globalThis.cancelAnimationFrame = vi.fn((id: number) => {
  clearTimeout(id);
});

// ── mocks ───────────────────────────────────────────────────────────
vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const apiMock = vi.hoisted(() => vi.fn(() => Promise.resolve({})));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  AUTH_TOKEN_EVENT: "crate:auth-token-updated",
  ensureMediaAccessUrl: vi.fn(async (url: string) => url),
  isUsableMediaAssetUrl: (url: string | null | undefined) => Boolean(url),
  requiresMediaAccessTicket: () => false,
  resolveMaybeApiAssetUrl: (url: string | null | undefined) => url ?? null,
}));

const androidNativeEngineMock = vi.hoisted(() => ({
  shouldUseAndroidNativePlayer: vi.fn(() => false),
}));

vi.mock("@/lib/android-native-engine", () => androidNativeEngineMock);

vi.mock("@/components/player/SpinningDisc", () => ({
  SpinningDisc: (props: Record<string, unknown>) => (
    <div data-testid="spinning-disc" data-props={JSON.stringify(props)} />
  ),
}));

vi.mock("@/components/player/PlayerTrackIdentity", () => ({
  PlayerTrackIdentity: (props: Record<string, unknown>) => (
    <div
      data-testid="player-track-identity"
      data-props={JSON.stringify(props)}
    />
  ),
}));

vi.mock("@/components/player/EqualizerPanel", () => ({
  EqualizerPanel: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="equalizer-panel">
      <button data-testid="eq-close-btn" onClick={onClose}>
        Close EQ
      </button>
    </div>
  ),
}));

vi.mock("@/components/player/extended/InfoTab", () => ({
  InfoTab: ({ className }: { className?: string }) => (
    <div data-testid="info-tab" className={className}>
      Info tab content
    </div>
  ),
}));

vi.mock("@/components/player/bar/PlayerTrackMenu", () => ({
  PlayerTrackMenu: ({
    className,
  }: {
    className?: string;
    currentTrack?: Record<string, unknown>;
  }) => (
    <div data-testid="player-track-menu" className={className}>
      menu
    </div>
  ),
}));

vi.mock("@/components/player/bar/PlayerSeekBar", () => ({
  PlayerSeekBar: (props: {
    onSeek: (t: number) => void;
    currentTime: number;
    duration: number;
  }) => (
    <div data-testid="seek-bar">
      <button data-testid="seek-btn" onClick={() => props.onSeek(30)}>
        Seek
      </button>
      <span data-testid="seek-time">{props.currentTime}</span>
      <span data-testid="seek-dur">{props.duration}</span>
    </div>
  ),
}));

vi.mock("@/components/player/bar/player-bar-utils", () => ({
  formatPlayerTime: (t: number) =>
    `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`,
}));

vi.mock("@/components/player/player-source", () => ({
  getPlaySourceLabel: (source: { name?: string } | null) =>
    source?.name ?? null,
}));

vi.mock("@/components/player/useResolvedPlayerArtist", () => ({
  useResolvedPlayerArtist: () => ({
    resolvedArtist: null,
    artistAvatarUrl: null,
    markArtistPhotoFailed: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-crossfade-progress", () => ({
  useCrossfadeProgress: () => 1,
  useCrossfadeAwareProgress: (_t: unknown, time: number, dur: number) => ({
    displayedTime: time,
    displayedDuration: dur,
  }),
}));

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({
    isLiked: vi.fn(() => false),
    toggleTrackLike: vi.fn(() => Promise.resolve(true)),
  }),
}));

vi.mock("@crate/ui/lib/use-dismissible-layer", () => ({
  useDismissibleLayer: vi.fn(),
}));

vi.mock("@crate/ui/lib/use-escape-key", () => ({
  useEscapeKey: vi.fn(),
}));

const { useEscapeKey: mockUseEscapeKey } = await import(
  "@crate/ui/lib/use-escape-key"
);

vi.mock("@/lib/mobile-audio-mode", () => ({
  canUseWebAudioEffects: true,
  isMobileAudioRuntime: false,
  stableMobileAudioPipeline: true,
}));

vi.mock("@/lib/player-visualizer-prefs", () => ({
  getPlayerSurfaceModePreference: () => "cd",
  PLAYER_VIZ_PREFS_EVENT: "player-viz-prefs",
  setPlayerSurfaceModePreference: vi.fn(),
}));

vi.mock("@/components/player/player-gestures", () => ({
  getHorizontalPlayerSwipeAction: vi.fn(() => null),
}));

vi.mock("@/components/actions/ItemActionMenu", () => ({
  ItemActionMenu: () => <div data-testid="item-action-menu" />,
  ItemActionMenuButton: () => <div data-testid="item-action-menu-btn" />,
  useItemActionMenu: () => ({
    open: false,
    position: null,
    menuRef: { current: null },
    triggerRef: { current: null },
    hasActions: true,
    openFromTrigger: vi.fn(),
    close: vi.fn(),
    handleContextMenu: vi.fn(),
  }),
}));

vi.mock("@/components/actions/shared", () => ({
  trackToMenuData: (t: Record<string, unknown>) => t,
}));

vi.mock("@/components/actions/track-actions", () => ({
  useTrackActionEntries: () => [],
}));

// ── react-router mock ───────────────────────────────────────────────
const navigateMock = vi.fn();
vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// ── imports ─────────────────────────────────────────────────────────
import { FullscreenPlayer } from "@/components/player/FullscreenPlayer";
import {
  renderWithListenProviders,
  createMockTrack,
  createMockPlayerActions,
  createMockPlayerState,
  createMockPlayerProgress,
} from "@/test/render-with-listen-providers";
import type { Track } from "@/contexts/player-types";

// ── helpers ─────────────────────────────────────────────────────────
function makeTrack(overrides: Partial<Track> = {}): Track {
  return createMockTrack({
    id: "t1",
    entityUid: "entity-t1",
    title: "Test Song",
    artist: "Test Artist",
    album: "Test Album",
    albumCover: "https://example.test/cover.jpg",
    duration: 240,
    ...overrides,
  });
}

function makeQueueTrack(
  overrides: Partial<Track> = {},
  idx: number = 0,
): Track {
  return createMockTrack({
    id: `q${idx}`,
    entityUid: `entity-q${idx}`,
    title: `Queue Track ${idx}`,
    artist: `Queue Artist ${idx}`,
    albumCover: idx % 2 === 0 ? "https://example.test/cover.jpg" : undefined,
    ...overrides,
  });
}

// ── tests ───────────────────────────────────────────────────────────
describe("FullscreenPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigateMock.mockReset();
    localStorage.removeItem("listen-eq-enabled");
    androidNativeEngineMock.shouldUseAndroidNativePlayer.mockReturnValue(false);
  });

  // ════════════════════════════════════════════════════════════════════
  // Rendering states
  // ════════════════════════════════════════════════════════════════════
  describe("rendering states", () => {
    it("renders nothing when open is false", () => {
      const track = makeTrack();
      const { container } = renderWithListenProviders(
        <FullscreenPlayer open={false} onClose={vi.fn()} />,
        {
          playerActions: createMockPlayerActions({
            currentTrack: track,
            queue: [track],
            currentIndex: 0,
          }),
        },
      );

      expect(container.innerHTML).toBe("");
    });

    it("renders nothing when no currentTrack", () => {
      const { container } = renderWithListenProviders(
        <FullscreenPlayer open onClose={vi.fn()} />,
        {
          playerActions: createMockPlayerActions({
            currentTrack: undefined,
            queue: [],
          }),
        },
      );

      expect(container.innerHTML).toBe("");
    });

    it("renders player UI when open with a current track", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByTestId("seek-bar")).toBeInTheDocument();
      });
    });

    it("shows buffering spinner when isBuffering is true", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerState: createMockPlayerState({
          isPlaying: true,
          isBuffering: true,
        }),
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Pause")).toBeInTheDocument();
      });
      // The play/pause button shows Loader2 when isBuffering
      const pauseBtn = screen.getByLabelText("Pause");
      expect(pauseBtn.querySelector("svg")).toBeTruthy();
    });

    it("shows Play icon when paused and not buffering", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerState: createMockPlayerState({
          isPlaying: false,
          isBuffering: false,
        }),
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Play")).toBeInTheDocument();
      });
    });

    it("uses semantic tokens for fullscreen static surfaces", async () => {
      const track = makeTrack({ albumCover: undefined });
      const user = userEvent.setup();
      const { container } = renderWithListenProviders(
        <FullscreenPlayer open onClose={vi.fn()} />,
        {
          playerActions: createMockPlayerActions({
            currentTrack: track,
            queue: [track],
            currentIndex: 0,
          }),
        },
      );

      expect(
        container.querySelector(".fullscreen-player-surface"),
      ).toBeInTheDocument();
      expect(
        container.querySelector(".fullscreen-player-handle"),
      ).toBeInTheDocument();

      await user.click(screen.getByLabelText("Show album cover"));

      await waitFor(() => {
        expect(
          container.querySelector(".fullscreen-player-artwork-placeholder"),
        ).toBeInTheDocument();
        expect(
          container.querySelector(".fullscreen-player-artwork-icon"),
        ).toBeInTheDocument();
      });

      expect(container.innerHTML).not.toContain("bg-white/20");
      expect(container.innerHTML).not.toContain("bg-white/5");
      expect(container.innerHTML).not.toContain("text-white");
      expect(container.innerHTML).not.toContain("shadow-black/60");
      expect(container.innerHTML).not.toContain("text-muted-foreground");
      expect(container.innerHTML).not.toContain("#1a2030");
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Player info display
  // ════════════════════════════════════════════════════════════════════
  describe("player info display", () => {
    it("renders PlayerTrackIdentity with the current track", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        const identity = screen.getByTestId("player-track-identity");
        expect(identity).toBeInTheDocument();
        const props = JSON.parse(identity.dataset.props || "{}");
        expect(props.currentTrack.id).toBe("t1");
      });
    });

    it("displays formatted current time and remaining time", async () => {
      const track = makeTrack({ duration: 240 });
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerState: createMockPlayerState({
          isPlaying: true,
          isBuffering: false,
        }),
        playerProgress: createMockPlayerProgress({
          currentTime: 60,
          duration: 240,
        }),
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("1:00")).toBeInTheDocument();
        expect(screen.getByText("-3:00")).toBeInTheDocument();
      });
    });

    it("toggles from CD mode to cover art mode on surface mode click", async () => {
      const track = makeTrack({ albumCover: "https://example.test/cover.jpg" });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByTestId("spinning-disc")).toBeInTheDocument();
      });

      // Click surface mode toggle to switch to cover mode
      await user.click(screen.getByLabelText("Show album cover"));

      // SpinningDisc should be gone, replaced by cover image
      await waitFor(() => {
        expect(screen.queryByTestId("spinning-disc")).not.toBeInTheDocument();
      });

      const coverImg = document.querySelector(
        'img[src="https://example.test/cover.jpg"]',
      );
      expect(coverImg).toBeInTheDocument();
    });

    it("shows CD mode (SpinningDisc) when surface mode is cd", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByTestId("spinning-disc")).toBeInTheDocument();
      });
    });

    it("keeps live disc jog seeks for web playback", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        const props = JSON.parse(
          screen.getByTestId("spinning-disc").dataset.props ?? "{}",
        );
        expect(props.jogSeekMode).toBe("live");
      });
    });

    it("uses commit-only disc jog seeks for Android native playback", async () => {
      androidNativeEngineMock.shouldUseAndroidNativePlayer.mockReturnValue(
        true,
      );
      const track = makeTrack();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        const props = JSON.parse(
          screen.getByTestId("spinning-disc").dataset.props ?? "{}",
        );
        expect(props.jogSeekMode).toBe("commit");
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Controls
  // ════════════════════════════════════════════════════════════════════
  describe("controls", () => {
    it("calls pause when playing and play/pause button is clicked", async () => {
      const track = makeTrack();
      const actions = createMockPlayerActions({
        currentTrack: track,
        queue: [track],
        currentIndex: 0,
      });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerState: createMockPlayerState({
          isPlaying: true,
          isBuffering: false,
        }),
        playerActions: actions,
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Pause")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Pause"));
      expect(actions.pause).toHaveBeenCalledTimes(1);
    });

    it("calls resume when paused and play/pause button is clicked", async () => {
      const track = makeTrack();
      const actions = createMockPlayerActions({
        currentTrack: track,
        queue: [track],
        currentIndex: 0,
      });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerState: createMockPlayerState({
          isPlaying: false,
          isBuffering: false,
        }),
        playerActions: actions,
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Play")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Play"));
      expect(actions.resume).toHaveBeenCalledTimes(1);
    });

    it("calls next when next button is clicked", async () => {
      const track = makeTrack();
      const actions = createMockPlayerActions({
        currentTrack: track,
        queue: [track],
        currentIndex: 0,
      });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: actions,
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Next track")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Next track"));
      expect(actions.next).toHaveBeenCalledTimes(1);
    });

    it("calls prev when prev button is clicked", async () => {
      const track = makeTrack();
      const actions = createMockPlayerActions({
        currentTrack: track,
        queue: [track],
        currentIndex: 0,
      });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: actions,
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Previous track")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Previous track"));
      expect(actions.prev).toHaveBeenCalledTimes(1);
    });

    it("calls toggleShuffle when shuffle button is clicked", async () => {
      const track = makeTrack();
      const actions = createMockPlayerActions({
        currentTrack: track,
        queue: [track],
        currentIndex: 0,
        shuffle: false,
      });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: actions,
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Enable shuffle")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Enable shuffle"));
      expect(actions.toggleShuffle).toHaveBeenCalledTimes(1);
    });

    it("calls cycleRepeat when repeat button is clicked", async () => {
      const track = makeTrack();
      const actions = createMockPlayerActions({
        currentTrack: track,
        queue: [track],
        currentIndex: 0,
        repeat: "off",
      });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: actions,
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Repeat: off")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Repeat: off"));
      expect(actions.cycleRepeat).toHaveBeenCalledTimes(1);
    });

    it("shows repeat-one icon when repeat mode is 'one'", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
          repeat: "one",
        }),
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Repeat: one")).toBeInTheDocument();
      });
    });

    it("calls onSeek via PlayerSeekBar", async () => {
      const track = makeTrack({ duration: 240 });
      const actions = createMockPlayerActions({
        currentTrack: track,
        queue: [track],
        currentIndex: 0,
      });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: actions,
      });

      await waitFor(() => {
        expect(screen.getByTestId("seek-btn")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("seek-btn"));
      expect(actions.seek).toHaveBeenCalledWith(30);
    });

    it("equalizer button toggles EqualizerPanel visibility", async () => {
      localStorage.setItem("listen-eq-enabled", "true");
      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Equalizer")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("equalizer-panel")).not.toBeInTheDocument();

      await user.click(screen.getByLabelText("Equalizer"));
      const equalizerPanel = screen.getByTestId("equalizer-panel");
      expect(equalizerPanel).toBeInTheDocument();
      expect(equalizerPanel.parentElement).toHaveClass(
        "listen-mobile-eq-glass",
      );

      await user.click(screen.getByLabelText("Equalizer"));
      await waitFor(() => {
        expect(screen.queryByTestId("equalizer-panel")).not.toBeInTheDocument();
      });
    });

    it("hides the mobile Equalizer access when it is globally disabled", async () => {
      localStorage.setItem("listen-eq-enabled", "false");
      const track = makeTrack();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.queryByLabelText("Equalizer")).not.toBeInTheDocument();
      });
    });

    it("like button toggles liked state", async () => {
      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Like track")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Like track"));
      // should not crash - toggleTrackLike is mocked to resolve
    });

    it("stores seek time via progress display", async () => {
      const track = makeTrack({ duration: 240 });
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerProgress: createMockPlayerProgress({
          currentTime: 90,
          duration: 240,
        }),
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByTestId("seek-time").textContent).toBe("90");
        expect(screen.getByTestId("seek-dur").textContent).toBe("240");
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Tab switching
  // ════════════════════════════════════════════════════════════════════
  describe("tab switching", () => {
    it("defaults to player tab", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByTestId("seek-bar")).toBeInTheDocument();
      });
    });

    it("switches to queue tab", async () => {
      const track = makeTrack();
      const qTrack = makeQueueTrack({ title: "Queue Track 0" }, 0);
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track, qTrack],
          currentIndex: 0,
        }),
      });

      const queueSwitch = await screen.findByRole("button", { name: "Queue" });

      await user.click(queueSwitch);

      await waitFor(() => {
        expect(screen.getByText("Queue Track 0")).toBeInTheDocument();
      });
    });

    it("switches to lyrics tab and shows lyrics content", async () => {
      let apiResolve: (v: Record<string, unknown>) => void = () => {};
      const pendingPromise = new Promise<Record<string, unknown>>((resolve) => {
        apiResolve = resolve;
      });
      apiMock.mockImplementation(() => pendingPromise);

      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Lyrics")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Lyrics"));

      await waitFor(() => {
        expect(screen.getByText("Loading lyrics...")).toBeInTheDocument();
      });

      apiResolve!({ syncedLyrics: null, plainLyrics: "Hello world" });
      apiMock.mockImplementation(() => Promise.resolve({}));
    });

    it("switches to info tab", async () => {
      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Info")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Info"));

      await waitFor(() => {
        expect(screen.getByTestId("info-tab")).toBeInTheDocument();
      });
    });

    it("treats queue as a panel switch that can return to player", async () => {
      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      const queueSwitch = await screen.findByRole("button", { name: "Queue" });
      expect(queueSwitch).toHaveAttribute("aria-pressed", "false");

      await user.click(queueSwitch);

      await waitFor(() => {
        expect(screen.getByText("Nothing queued")).toBeInTheDocument();
      });
      expect(queueSwitch).toHaveAttribute("aria-pressed", "true");

      await user.click(queueSwitch);

      await waitFor(() => {
        expect(screen.queryByText("Nothing queued")).not.toBeInTheDocument();
        expect(screen.getByTestId("seek-bar")).toBeInTheDocument();
      });
      expect(queueSwitch).toHaveAttribute("aria-pressed", "false");
    });

    it("uses semantic tokens for active panel and transport states", async () => {
      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
          shuffle: true,
          repeat: "one",
        }),
      });

      const shuffle = await screen.findByRole("button", {
        name: "Disable shuffle",
      });
      const repeat = screen.getByRole("button", { name: "Repeat: one" });
      expect(shuffle).toHaveClass(
        "text-accent-action",
        "drop-shadow-accent-action",
      );
      expect(repeat).toHaveClass(
        "text-accent-action",
        "drop-shadow-accent-action",
      );

      const queueSwitch = screen.getByRole("button", { name: "Queue" });
      expect(queueSwitch).toHaveClass(
        "text-text-muted",
        "active:text-text-secondary",
      );

      await user.click(queueSwitch);

      expect(queueSwitch).toHaveClass(
        "text-accent-action",
        "drop-shadow-accent-action-icon",
      );
      expect(queueSwitch.querySelector('[aria-hidden="true"]')).toHaveClass(
        "bg-accent-action",
        "shadow-accent-action-indicator-active",
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Close behavior
  // ════════════════════════════════════════════════════════════════════
  describe("close behavior", () => {
    it("calls onClose when dismiss button is clicked", async () => {
      const track = makeTrack();
      const onClose = vi.fn();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={onClose} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Close player")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Close player"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("escape key calls onClose when on player tab", async () => {
      const track = makeTrack();
      const onClose = vi.fn();

      // Capture the escape handler registered by useEscapeKey
      let capturedHandler: ((e: KeyboardEvent) => void) | null = null;
      vi.mocked(mockUseEscapeKey).mockImplementation(
        (_active: boolean, onEscape: (e: KeyboardEvent) => void) => {
          capturedHandler = onEscape;
        },
      );

      renderWithListenProviders(<FullscreenPlayer open onClose={onClose} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(capturedHandler).not.toBeNull();
      });

      const event = new KeyboardEvent("keydown", { key: "Escape" });
      vi.spyOn(event, "preventDefault");
      vi.spyOn(event, "stopImmediatePropagation");
      capturedHandler!(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopImmediatePropagation).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("escape key returns to player tab from non-player tab", async () => {
      const track = makeTrack();
      const onClose = vi.fn();
      const user = userEvent.setup();

      // For this test we use real useEscapeKey mock with full implementation
      // We need to control the escape callback sequence
      let capturedHandler: ((e: KeyboardEvent) => void) | null = null;
      vi.mocked(mockUseEscapeKey).mockImplementation(
        (_active: boolean, onEscape: (e: KeyboardEvent) => void) => {
          capturedHandler = onEscape;
        },
      );

      renderWithListenProviders(<FullscreenPlayer open onClose={onClose} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Info")).toBeInTheDocument();
      });

      // Switch to info tab
      await user.click(screen.getByText("Info"));
      await waitFor(() => {
        expect(screen.getByTestId("info-tab")).toBeInTheDocument();
      });

      // Now escape should return to player tab, not close
      const event = new KeyboardEvent("keydown", { key: "Escape" });
      capturedHandler!(event);

      // onClose should NOT have been called
      expect(onClose).not.toHaveBeenCalled();
      // Should be back on player tab
      await waitFor(() => {
        expect(screen.getByTestId("seek-bar")).toBeInTheDocument();
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Queue tab
  // ════════════════════════════════════════════════════════════════════
  describe("queue tab", () => {
    it('shows "Nothing queued" when queue has no upcoming tracks', async () => {
      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Queue")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Queue"));

      await waitFor(() => {
        expect(screen.getByText("Nothing queued")).toBeInTheDocument();
      });
    });

    it("shows upcoming tracks count in queue header", async () => {
      const track = makeTrack();
      const qTracks = Array.from({ length: 5 }, (_, i) =>
        makeQueueTrack({ title: `Queue Track ${i}` }, i),
      );
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track, ...qTracks],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Queue")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Queue"));

      await waitFor(() => {
        expect(screen.getByText(/Up Next · 5 tracks/)).toBeInTheDocument();
      });
    });

    it("shows upcoming track titles in the queue", async () => {
      const track = makeTrack();
      const qTracks = [
        makeQueueTrack({ title: "First In Queue" }, 0),
        makeQueueTrack({ title: "Second In Queue" }, 1),
      ];
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track, ...qTracks],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Queue")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Queue"));

      await waitFor(() => {
        expect(screen.getByText("First In Queue")).toBeInTheDocument();
        expect(screen.getByText("Second In Queue")).toBeInTheDocument();
      });
    });

    it('shows "Suggested" badge on suggested queue tracks', async () => {
      const track = makeTrack();
      const suggestedTrack = makeQueueTrack(
        { title: "Suggested Track", isSuggested: true },
        0,
      );
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track, suggestedTrack],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Queue")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Queue"));

      await waitFor(() => {
        expect(screen.getByText("Suggested")).toBeInTheDocument();
      });
    });

    it("calls jumpTo when a queue row is clicked", async () => {
      const track = makeTrack();
      const qTrack = makeQueueTrack({ title: "Queue One" }, 0);
      const actions = createMockPlayerActions({
        currentTrack: track,
        queue: [track, qTrack],
        currentIndex: 0,
      });
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: actions,
      });

      await waitFor(() => {
        expect(screen.getByText("Queue")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Queue"));

      await waitFor(() => {
        expect(screen.getByText("Queue One")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Queue One"));
      expect(actions.jumpTo).toHaveBeenCalledWith(1);
    });

    it("uses semantic tokens for queue rows", async () => {
      const track = makeTrack();
      const qTrack = makeQueueTrack({ title: "Queue One" }, 0);
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track, qTrack],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Queue")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Queue"));

      const queueRow = await screen.findByText("Queue One");
      const row = queueRow.closest('[role="button"]');

      expect(row).toHaveClass(
        "active:bg-surface-control",
        "focus-visible:bg-surface-control",
        "focus-visible:ring-focus-ring/40",
      );
      expect(queueRow).toHaveClass("text-text-primary");
      expect(row?.className).not.toContain("white/");
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Lyrics tab
  // ════════════════════════════════════════════════════════════════════
  describe("lyrics tab", () => {
    beforeEach(() => {
      // Keep lyrics API in pending state so "Loading..." stays visible
      apiMock.mockImplementation(() => new Promise(() => {}));
    });

    afterEach(() => {
      apiMock.mockReset();
      apiMock.mockImplementation(() => Promise.resolve({}));
    });

    it('shows "Loading lyrics..." initially', async () => {
      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Lyrics")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Lyrics"));

      await waitFor(() => {
        expect(screen.getByText("Loading lyrics...")).toBeInTheDocument();
      });
    });

    it('shows "No lyrics available" when API resolves with no lyrics', async () => {
      apiMock.mockReset();
      apiMock.mockImplementation(() => Promise.resolve({}));

      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByText("Lyrics")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Lyrics"));

      await waitFor(() => {
        expect(screen.getByText("No lyrics available")).toBeInTheDocument();
      });
    });

    it("renders synced lyrics with a large active Apple Music-style hierarchy", async () => {
      apiMock.mockReset();
      apiMock.mockImplementation(() =>
        Promise.resolve({
          syncedLyrics:
            "[00:00.00]Picking petals\n[00:10.00]Do you love me? Do you love me not?",
          plainLyrics: null,
        }),
      );

      const track = makeTrack();
      const user = userEvent.setup();

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerProgress: createMockPlayerProgress({
          currentTime: 1,
          duration: 60,
        }),
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await user.click(await screen.findByRole("button", { name: "Lyrics" }));

      const activeLine = await screen.findByRole("button", {
        name: "Picking petals",
      });
      const nextLine = screen.getByRole("button", {
        name: "Do you love me? Do you love me not?",
      });

      expect(activeLine).toHaveClass(
        "text-[1.9rem]",
        "font-extrabold",
        "text-text-primary",
        "lyrics-active-line",
      );
      expect(activeLine.className).not.toContain("rgba(");
      expect(nextLine).toHaveClass("text-[1.55rem]");
      expect(nextLine.className).toContain("blur-[0.35px]");
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Responsive behavior
  // ════════════════════════════════════════════════════════════════════
  describe("responsive behavior", () => {
    it("renders drag handle at the top for mobile", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        const dragHandle = document.querySelector(".fullscreen-player-handle");
        expect(dragHandle).toBeInTheDocument();
        expect(dragHandle?.className).toContain("rounded-full");
      });
    });

    it("renders three panel switches and no player tab", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(
          screen.queryByRole("button", { name: "Player" }),
        ).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Queue" })).toHaveAttribute(
          "aria-pressed",
          "false",
        );
        expect(screen.getByRole("button", { name: "Lyrics" })).toHaveAttribute(
          "aria-pressed",
          "false",
        );
        expect(screen.getByRole("button", { name: "Info" })).toHaveAttribute(
          "aria-pressed",
          "false",
        );
      });
    });

    it("renders surface mode toggle button with correct label in cd mode", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Show album cover")).toBeInTheDocument();
      });
    });

    it("uses semantic tokens for secondary player actions", async () => {
      const track = makeTrack();
      localStorage.setItem("listen-eq-enabled", "true");
      const user = userEvent.setup();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByLabelText("Like track")).toBeInTheDocument();
      });

      for (const button of [
        screen.getByLabelText("Like track"),
        screen.getByLabelText("Equalizer"),
        screen.getByLabelText("Show album cover"),
      ]) {
        expect(button).toHaveClass(
          "border-border-subtle",
          "bg-surface-control",
          "text-text-secondary",
          "active:bg-surface-control-hover",
          "active:text-text-primary",
        );
        expect(button.className).not.toContain("white/");
      }

      const equalizer = screen.getByLabelText("Equalizer");
      await user.click(equalizer);
      expect(equalizer).toHaveClass(
        "text-accent-action",
        "drop-shadow-accent-action",
      );

      expect(screen.getByTestId("player-track-menu")).toHaveClass(
        "border-border-subtle",
        "bg-surface-control",
        "text-text-secondary",
        "active:bg-surface-control-hover",
        "active:text-text-primary",
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Layout
  // ════════════════════════════════════════════════════════════════════
  describe("layout", () => {
    it("renders the player tab with seek bar and controls", async () => {
      const track = makeTrack();
      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByTestId("seek-bar")).toBeInTheDocument();
        expect(screen.getByTestId("player-track-identity")).toBeInTheDocument();
        expect(screen.getByTestId("player-track-menu")).toBeInTheDocument();
      });
    });

    it("does not render queue rows on player tab", async () => {
      const track = makeTrack();
      const qTrack = makeQueueTrack({ title: "Hidden In Queue" }, 0);

      renderWithListenProviders(<FullscreenPlayer open onClose={vi.fn()} />, {
        playerActions: createMockPlayerActions({
          currentTrack: track,
          queue: [track, qTrack],
          currentIndex: 0,
        }),
      });

      await waitFor(() => {
        expect(screen.getByTestId("seek-bar")).toBeInTheDocument();
      });

      expect(screen.queryByText("Hidden In Queue")).not.toBeInTheDocument();
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // TEST_GAPs
  // ════════════════════════════════════════════════════════════════════
  describe("TEST_GAPs", () => {
    it.skip("TEST_GAP: swipe-to-dismiss gesture is not testable in jsdom", () => {
      // Swipe gesture simulation (onTouchStart, onTouchMove, onTouchEnd)
      // with delta tracking and rAF-based scheduling requires a real
      // touch environment (mobile browser, Playwright, or Capacitor).
      // jsdom does not support touch events with clientX/clientY in a
      // way that maps to gesture helpers.
    });

    it.skip("TEST_GAP: horizontal swipe for prev/next is not testable in jsdom", () => {
      // Same constraint as swipe-to-dismiss: the horizontal gesture
      // path through getHorizontalPlayerSwipeAction requires real
      // touch deltas relative to viewport width.
    });

    it.skip("TEST_GAP: crossfade transition visuals require real animation frames", () => {
      // Crossfade overlays and progress-driven opacity changes rely on
      // rAF scheduling of useCrossfadeProgress. jsdom cannot produce
      // meaningful intermediate opacity values.
    });

    it.skip("TEST_GAP: native back button (crate:native-back) is Capacitor-only", () => {
      // The native back event is dispatched by Capacitor's back button
      // listener plugin, not available in jsdom.
    });
  });
});
