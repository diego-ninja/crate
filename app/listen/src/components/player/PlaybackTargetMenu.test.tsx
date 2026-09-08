import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadGroupsMock,
  onNativeOutputRouteChangedMock,
  selectTargetMock,
  toastInfoMock,
} = vi.hoisted(() => ({
  loadGroupsMock: vi.fn(),
  onNativeOutputRouteChangedMock: vi.fn(),
  selectTargetMock: vi.fn(),
  toastInfoMock: vi.fn(),
}));

vi.mock("@/lib/playback-targets", async () => {
  const actual = await vi.importActual<typeof import("@/lib/playback-targets")>(
    "@/lib/playback-targets",
  );
  return {
    ...actual,
    loadPlaybackTargetGroups: loadGroupsMock,
    selectPlaybackTarget: selectTargetMock,
  };
});

vi.mock("sonner", () => ({
  toast: {
    info: toastInfoMock,
  },
}));

vi.mock("@/lib/native-output-router", () => ({
  onNativeOutputRouteChanged: onNativeOutputRouteChangedMock,
}));

import { PlaybackTargetMenu } from "@/components/player/PlaybackTargetMenu";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

describe("PlaybackTargetMenu", () => {
  beforeEach(() => {
    onNativeOutputRouteChangedMock.mockResolvedValue(() => {});
    loadGroupsMock.mockResolvedValue([
      {
        providerId: "local",
        label: "This device",
        targets: [
          {
            id: "local:current",
            providerId: "local",
            kind: "local",
            name: "Crate on Chrome",
            subtitle: "System-selected output",
            active: true,
            available: true,
            capabilities: {
              canPlay: true,
              canSeek: true,
              canSetVolume: true,
            },
          },
        ],
      },
      {
        providerId: "crate-connect",
        label: "Crate devices",
        targets: [
          {
            id: "crate:desktop",
            providerId: "crate-connect",
            kind: "crate-device",
            name: "Desktop",
            subtitle: "Active Crate device",
            active: false,
            available: false,
            unavailableReason: "Crate Connect transfer is coming later.",
            capabilities: {
              canPlay: true,
              canSeek: false,
              canSetVolume: true,
            },
          },
        ],
      },
    ]);
    selectTargetMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens the unified output menu with local and Crate targets", async () => {
    renderWithListenProviders(<PlaybackTargetMenu />);

    const outputButton = screen.getByRole("button", { name: "Output" });
    expect(outputButton.className).not.toContain("hover:bg");
    expect(outputButton.className).toContain("hover:text-accent-action");
    expect(outputButton.className).toContain("hover:drop-shadow-accent-action");
    expect(outputButton.className).not.toContain("text-white/30");
    expect(outputButton.className).not.toContain("rgba(");

    fireEvent.click(outputButton);

    expect(await screen.findByText("Crate on Chrome")).toBeVisible();
    expect(screen.getByText("System-selected output")).toBeVisible();
    expect(screen.getByText("Desktop")).toBeVisible();
    expect(screen.getByText("Unavailable")).toBeVisible();

    const menu = screen.getByRole("menu", { name: "Output targets" });
    const localRow = menu.querySelector('[role="menuitemradio"]');

    expect(localRow).toHaveClass(
      "text-text-primary",
      "hover:bg-surface-control",
    );
    expect(menu.innerHTML).not.toContain("rgba(");
    expect(menu.innerHTML).not.toContain("bg-white");
  });

  it("surfaces the active remote Connect device", async () => {
    loadGroupsMock.mockResolvedValue([
      {
        providerId: "local",
        label: "This device",
        targets: [
          {
            id: "local:current",
            providerId: "local",
            kind: "local",
            name: "Crate on Chrome",
            subtitle: "Available on this device",
            active: false,
            available: true,
            capabilities: {
              canPlay: true,
              canSeek: true,
              canSetVolume: true,
            },
          },
        ],
      },
      {
        providerId: "crate-connect",
        label: "Crate devices",
        targets: [
          {
            id: "crate:desktop",
            providerId: "crate-connect",
            kind: "crate-device",
            name: "Desktop",
            subtitle: "Playing through Crate Connect",
            active: true,
            available: true,
            capabilities: {
              canPlay: true,
              canSeek: true,
              canSetVolume: true,
            },
          },
        ],
      },
    ]);

    renderWithListenProviders(<PlaybackTargetMenu />);

    fireEvent.click(screen.getByRole("button", { name: "Output" }));

    expect(await screen.findByText("Desktop")).toBeVisible();
    expect(screen.getByText("Playing through Crate Connect")).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
  });

  it("delegates available targets and explains unavailable targets", async () => {
    const targetContext = {
      currentTrack: {
        id: "track-1",
        title: "Track",
        artist: "Artist",
        libraryTrackId: 7,
      },
      currentTime: 4,
    };

    renderWithListenProviders(
      <PlaybackTargetMenu targetContext={targetContext} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Output" }));
    const localRow = (await screen.findByText("Crate on Chrome")).closest(
      "button",
    );
    expect(localRow).not.toBeNull();
    fireEvent.click(localRow!);

    await waitFor(() => expect(selectTargetMock).toHaveBeenCalledTimes(1));
    expect(loadGroupsMock).toHaveBeenCalledWith(targetContext);
    expect(selectTargetMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "local:current" }),
      targetContext,
    );

    fireEvent.click(screen.getByRole("button", { name: "Output" }));
    const crateRow = (await screen.findByText("Desktop")).closest("button");
    expect(crateRow).not.toBeNull();
    fireEvent.click(crateRow!);

    expect(toastInfoMock).toHaveBeenCalledWith(
      "Crate Connect transfer is coming later.",
    );
  });

  it("localizes the output menu chrome", async () => {
    renderWithListenProviders(<PlaybackTargetMenu />, { locale: "es" });

    fireEvent.click(screen.getByRole("button", { name: "Salida" }));

    expect(
      await screen.findByRole("menu", { name: "Salidas de audio" }),
    ).toBeVisible();
    expect(screen.getByText("Salida")).toBeVisible();
    expect(screen.getByText("Activo")).toBeVisible();
    expect(screen.getByText("No disponible")).toBeVisible();
  });
});
