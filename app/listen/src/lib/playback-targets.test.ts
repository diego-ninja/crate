import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiMock,
  getNativeCurrentOutputRouteMock,
  getNativeOutputCapabilitiesMock,
  getCastSenderCapabilitiesMock,
  isCrateConnectEnabledMock,
  isNativeOutputRoutingAvailableMock,
  startCastSessionMock,
  showNativeOutputPickerMock,
} = vi.hoisted(() => ({
  apiMock: vi.fn(),
  getNativeCurrentOutputRouteMock: vi.fn(),
  getNativeOutputCapabilitiesMock: vi.fn(),
  getCastSenderCapabilitiesMock: vi.fn(),
  isCrateConnectEnabledMock: vi.fn(() => true),
  isNativeOutputRoutingAvailableMock: vi.fn(),
  startCastSessionMock: vi.fn(),
  showNativeOutputPickerMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  apiSseUrl: vi.fn((path: string) => path),
}));

vi.mock("@/lib/listen-device", () => ({
  formatCrateDeviceName: vi.fn(
    (device: {
      app_platform?: string | null;
      device_label?: string | null;
      device_type?: string | null;
    }) => {
      if (device.device_label === "Web (Listen)") return "Crate on Browser";
      if (device.device_label) return device.device_label;
      if (device.app_platform === "listen-tauri") return "Crate Desktop";
      if (device.app_platform === "listen-web") return "Crate on Browser";
      return device.device_type
        ? `Crate on ${device.device_type}`
        : "Crate device";
    },
  ),
  getListenDeviceCapabilities: vi.fn(() => ({
    can_play: true,
    can_receive_commands: true,
    can_background_play: false,
    can_set_volume: true,
    supports_native_audio: false,
    supports_cast_sender: false,
  })),
  getListenDeviceId: vi.fn(() => "phone"),
  getListenDeviceLabel: vi.fn(() => "Crate on Chrome"),
}));

vi.mock("@/lib/native-output-router", () => ({
  getNativeCurrentOutputRoute: getNativeCurrentOutputRouteMock,
  getNativeOutputCapabilities: getNativeOutputCapabilitiesMock,
  isNativeOutputRoutingAvailable: isNativeOutputRoutingAvailableMock,
  showNativeOutputPicker: showNativeOutputPickerMock,
}));

vi.mock("@/lib/cast-sender", () => ({
  getCastSenderCapabilities: getCastSenderCapabilitiesMock,
  startCastSession: startCastSessionMock,
}));

vi.mock("@/lib/crate-connect", async () => {
  const actual = await vi.importActual<typeof import("@/lib/crate-connect")>(
    "@/lib/crate-connect",
  );
  return {
    ...actual,
    CRATE_CONNECT_V2_TRANSPORT_ENABLED: false,
    isCrateConnectEnabled: isCrateConnectEnabledMock,
  };
});

import {
  googleCastTargetProvider,
  loadPlaybackTargetGroups,
  localTargetProvider,
  nativeOutputRouteProvider,
  playbackTargetProviders,
  selectPlaybackTarget,
  type PlaybackTargetProvider,
} from "@/lib/playback-targets";

describe("playback targets", () => {
  it("keeps the default provider order stable", () => {
    expect(playbackTargetProviders.map((provider) => provider.id)).toEqual([
      "local",
      "native-output",
      "google-cast",
      "crate-connect",
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    isCrateConnectEnabledMock.mockReturnValue(true);
    isNativeOutputRoutingAvailableMock.mockReturnValue(false);
    getCastSenderCapabilitiesMock.mockResolvedValue({
      platform: "unsupported",
      visible: false,
      available: false,
      activeSession: false,
    });
    startCastSessionMock.mockResolvedValue({ ok: true, message: "Casting." });
    getNativeOutputCapabilitiesMock.mockResolvedValue({
      platform: "android",
      canShowSystemOutputSwitcher: true,
      canPresentRoutePicker: false,
      canReportCurrentRoute: true,
      routePickerKind: "android-output-switcher",
    });
    getNativeCurrentOutputRouteMock.mockResolvedValue(null);
    showNativeOutputPickerMock.mockResolvedValue({ shown: true });
    const devices = [
      {
        device_id: "phone",
        device_label: "Phone",
        active: true,
        capabilities: {
          can_play: true,
          can_receive_commands: true,
          can_set_volume: true,
        },
      },
      {
        device_id: "desktop",
        device_label: "Desktop",
        active: true,
        capabilities: {
          can_play: true,
          can_receive_commands: true,
          can_set_volume: true,
        },
      },
      {
        device_id: "tablet",
        device_label: "Tablet",
        active: false,
        capabilities: { can_play: false },
      },
    ];
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/me/connect/session") {
        return Promise.resolve({ session: null });
      }
      if (path === "/api/me/devices") {
        return Promise.resolve({ devices });
      }
      return Promise.resolve({});
    });
  });

  it("marks the active Crate device from the Connect session", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/me/connect/session") {
        return Promise.resolve({
          session: {
            playback_session_id: "33333333-3333-3333-3333-333333333333",
            active_device_id: "desktop",
            status: "playing",
            command_seq: 2,
          },
        });
      }
      if (path === "/api/me/devices") {
        return Promise.resolve({
          devices: [
            {
              device_id: "phone",
              device_label: "Phone",
              active: true,
              capabilities: {
                can_play: true,
                can_receive_commands: true,
                can_set_volume: true,
              },
            },
            {
              device_id: "desktop",
              device_label: "Desktop",
              active: true,
              capabilities: {
                can_play: true,
                can_receive_commands: true,
                can_set_volume: true,
              },
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    const groups = await loadPlaybackTargetGroups();

    const local = groups
      .find((group) => group.providerId === "local")
      ?.targets.find((target) => target.id === "local:current");
    const desktop = groups
      .find((group) => group.providerId === "crate-connect")
      ?.targets.find((target) => target.id === "crate:desktop");

    expect(local).toMatchObject({ active: false });
    expect(desktop).toMatchObject({
      active: true,
      subtitle: "Playing through Crate Connect",
    });
  });

  it("exposes a native system route target when the shell supports it", async () => {
    isNativeOutputRoutingAvailableMock.mockReturnValue(true);
    getNativeCurrentOutputRouteMock.mockResolvedValue({
      id: "bt-headphones",
      name: "Bluetooth headphones",
      type: "bluetooth",
      platform: "android",
    });

    const targets = await nativeOutputRouteProvider.getTargets();

    expect(targets).toEqual([
      expect.objectContaining({
        id: "native-output:system",
        kind: "system-route",
        name: "Bluetooth headphones",
        subtitle: "Open Android output switcher",
        available: true,
      }),
    ]);

    const target = targets[0];
    expect(target).toBeDefined();
    const result = await nativeOutputRouteProvider.selectTarget(target!);
    expect(result).toEqual({ ok: true, message: undefined });
    expect(showNativeOutputPickerMock).toHaveBeenCalledTimes(1);
  });

  it("loads local output and available Crate device targets through providers", async () => {
    const groups = await loadPlaybackTargetGroups();

    expect(groups[0]).toMatchObject({
      providerId: "local",
      label: "This device",
      targets: [
        {
          id: "local:current",
          kind: "local",
          name: "Crate on Chrome",
          active: true,
          available: true,
        },
      ],
    });
    const crateGroup = groups.find(
      (group) => group.providerId === "crate-connect",
    );
    expect(crateGroup?.targets).toEqual([
      expect.objectContaining({
        id: "crate:desktop",
        name: "Desktop",
        subtitle: "Active Crate device",
        available: true,
        unavailableReason: undefined,
      }),
      expect.objectContaining({
        id: "crate:tablet",
        name: "Tablet",
        subtitle: "Recent Crate device",
        available: false,
        unavailableReason: "Playback is not available on this device.",
      }),
    ]);
  });

  it("loads Crate Connect v2 targets from connected playback instances", async () => {
    const requestTransfer = vi.fn(() => true);
    const groups = await loadPlaybackTargetGroups({
      connect: {
        activeInstanceId: "desktop-tab",
        connectedInstances: [
          {
            instance_id: "phone-tab",
            device_label: "Web (Listen)",
            capabilities: { can_play: true, can_set_volume: true },
          },
          {
            instance_id: "desktop-tab",
            device_label: "Desktop",
            capabilities: { can_play: true, can_set_volume: true },
          },
          {
            instance_id: "tablet-tab",
            device_label: "Tablet",
            capabilities: { can_play: false },
          },
        ],
        playbackInstanceId: "phone-tab",
        requestTransfer,
        transport: "ws",
      },
    });

    const crateGroup = groups.find(
      (group) => group.providerId === "crate-connect",
    );
    const local = groups
      .find((group) => group.providerId === "local")
      ?.targets.find((target) => target.id === "local:current");

    expect(local).toMatchObject({ active: false });
    expect(crateGroup?.targets).toEqual([
      expect.objectContaining({
        id: "crate-instance:desktop-tab",
        name: "Desktop",
        subtitle: "Playing through Crate Connect",
        active: true,
        available: true,
      }),
      expect.objectContaining({
        id: "crate-instance:tablet-tab",
        name: "Tablet",
        active: false,
        available: false,
        unavailableReason: "Playback is not available on this instance.",
      }),
    ]);
    expect(apiMock.mock.calls.map((call) => call[0])).not.toContain(
      "/api/me/devices",
    );
    expect(apiMock.mock.calls.map((call) => call[0])).not.toContain(
      "/api/me/connect/session",
    );
  });

  it("normalizes legacy Crate Connect v2 instance names", async () => {
    const groups = await loadPlaybackTargetGroups({
      connect: {
        activeInstanceId: null,
        connectedInstances: [
          { instance_id: "local-tab", device_label: "Crate on Chrome" },
          { instance_id: "remote-tab", device_label: "Web (Listen)" },
        ],
        playbackInstanceId: "local-tab",
        requestTransfer: vi.fn(() => true),
        transport: "ws",
      },
    });

    const crateGroup = groups.find(
      (group) => group.providerId === "crate-connect",
    );

    expect(crateGroup?.targets[0]?.name).toBe("Crate on Browser");
  });

  it("disambiguates duplicate Crate Connect v2 instance names", async () => {
    const groups = await loadPlaybackTargetGroups({
      connect: {
        activeInstanceId: null,
        connectedInstances: [
          { instance_id: "local-tab", device_label: "Crate on Chrome" },
          { instance_id: "remote-tab-1", device_label: "Crate on Chrome" },
          { instance_id: "remote-tab-2", device_label: "Crate on Chrome" },
        ],
        playbackInstanceId: "local-tab",
        requestTransfer: vi.fn(() => true),
        transport: "ws",
      },
    });

    const crateGroup = groups.find(
      (group) => group.providerId === "crate-connect",
    );

    expect(crateGroup?.targets.map((target) => target.name)).toEqual([
      "Crate on Chrome (1)",
      "Crate on Chrome (2)",
    ]);
  });

  it("selects a Crate Connect v2 instance by requesting transfer", async () => {
    const requestTransfer = vi.fn(() => true);
    const result = await selectPlaybackTarget(
      {
        id: "crate-instance:desktop-tab",
        providerId: "crate-connect",
        kind: "crate-device",
        name: "Desktop",
        active: false,
        available: true,
        capabilities: {
          canPlay: true,
          canSeek: true,
          canSetVolume: true,
        },
      },
      {
        connect: {
          activeInstanceId: "phone-tab",
          connectedInstances: [],
          playbackInstanceId: "phone-tab",
          requestTransfer,
          transport: "ws",
        },
      },
    );

    expect(result).toEqual({ ok: true, message: "Playing on Desktop." });
    expect(requestTransfer).toHaveBeenCalledWith("desktop-tab");
    expect(apiMock).not.toHaveBeenCalledWith(
      "/api/me/connect/transfer",
      expect.anything(),
      expect.anything(),
    );
  });

  it("claims local Crate Connect v2 ownership from the local target", async () => {
    const requestTransfer = vi.fn(() => true);
    const result = await localTargetProvider.selectTarget(
      {
        id: "local:current",
        providerId: "local",
        kind: "local",
        name: "Crate on Chrome",
        active: false,
        available: true,
        capabilities: {
          canPlay: true,
          canSeek: true,
          canSetVolume: true,
        },
      },
      {
        connect: {
          activeInstanceId: "desktop-tab",
          connectedInstances: [],
          playbackInstanceId: "phone-tab",
          requestTransfer,
          transport: "ws",
        },
      },
    );

    expect(result).toEqual({ ok: true, message: "Playing here." });
    expect(requestTransfer).toHaveBeenCalledWith("phone-tab");
  });

  it("does not expose or claim Crate Connect targets when the feature is disabled", async () => {
    isCrateConnectEnabledMock.mockReturnValue(false);

    const groups = await loadPlaybackTargetGroups();
    const localTarget = groups[0]?.targets[0];

    expect(groups.some((group) => group.providerId === "crate-connect")).toBe(
      false,
    );
    expect(localTarget).toBeDefined();
    const result = await localTargetProvider.selectTarget(localTarget!);

    expect(result).toEqual({
      ok: true,
      message: "Already playing on this device.",
    });
    expect(apiMock).not.toHaveBeenCalledWith(
      "/api/me/connect/transfer",
      expect.anything(),
      expect.anything(),
    );
  });

  it("selects a Crate device by transferring playback without pausing until handoff commits", async () => {
    const pause = vi.fn();
    const publishConnectState = vi.fn(async () => undefined);
    const targets = await loadPlaybackTargetGroups({
      currentTime: 42,
      pause,
      publishConnectState,
    });
    const crateGroup = targets.find(
      (group) => group.providerId === "crate-connect",
    );
    const desktop = crateGroup?.targets.find(
      (target) => target.id === "crate:desktop",
    );

    expect(desktop).toBeDefined();
    const result = await selectPlaybackTarget(desktop!, {
      currentTime: 42,
      pause,
      publishConnectState,
    });

    expect(result).toEqual({ ok: true, message: "Playing on Desktop." });
    expect(publishConnectState).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenLastCalledWith(
      "/api/me/connect/transfer",
      "POST",
      {
        source_device_id: "phone",
        target_device_id: "desktop",
        start_playing: true,
      },
    );
    expect(pause).not.toHaveBeenCalled();
  });

  it("transfers ownership back to the local device when a remote device is active", async () => {
    const result = await localTargetProvider.selectTarget(
      {
        id: "local:current",
        providerId: "local",
        kind: "local",
        name: "Crate on Chrome",
        active: false,
        available: true,
        capabilities: {
          canPlay: true,
          canSeek: true,
          canSetVolume: true,
        },
      },
      { activeConnectDeviceId: "desktop" },
    );

    expect(result).toEqual({ ok: true, message: "Playing here." });
    expect(apiMock).toHaveBeenCalledWith("/api/me/connect/transfer", "POST", {
      source_device_id: "desktop",
      target_device_id: "phone",
      start_playing: true,
    });
  });

  it("reclaims local ownership from the fresh active session snapshot", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/api/me/connect/session") {
        return Promise.resolve({
          session: {
            playback_session_id: "33333333-3333-3333-3333-333333333333",
            active_device_id: "desktop",
            status: "playing",
            command_seq: 2,
          },
        });
      }
      return Promise.resolve({});
    });

    const result = await localTargetProvider.selectTarget({
      id: "local:current",
      providerId: "local",
      kind: "local",
      name: "Crate on Chrome",
      active: false,
      available: true,
      capabilities: {
        canPlay: true,
        canSeek: true,
        canSetVolume: true,
      },
    });

    expect(result).toEqual({ ok: true, message: "Playing here." });
    expect(apiMock).toHaveBeenCalledWith("/api/me/connect/transfer", "POST", {
      source_device_id: "desktop",
      target_device_id: "phone",
      start_playing: true,
    });
  });

  it("delegates selection to the target provider", async () => {
    const provider: PlaybackTargetProvider = {
      ...localTargetProvider,
      selectTarget: vi.fn(async () => ({ ok: true, message: "done" })),
    };

    const result = await selectPlaybackTarget(
      {
        id: "local:current",
        providerId: "local",
        kind: "local",
        name: "Crate on Chrome",
        active: true,
        available: true,
        capabilities: {
          canPlay: true,
          canSeek: true,
          canSetVolume: true,
        },
      },
      [provider],
    );

    expect(result).toEqual({ ok: true, message: "done" });
    expect(provider.selectTarget).toHaveBeenCalledTimes(1);
  });

  it("loads and starts a Google Cast target for the current track", async () => {
    getCastSenderCapabilitiesMock.mockResolvedValue({
      platform: "web",
      visible: true,
      available: true,
      activeSession: false,
    });
    const pause = vi.fn();
    const currentTrack = {
      id: "track-1",
      libraryTrackId: 7,
      title: "Track",
      artist: "Artist",
    };

    const targets = await googleCastTargetProvider.getTargets({
      currentTrack,
      currentTime: 12.4,
      pause,
    });

    expect(targets).toEqual([
      expect.objectContaining({
        id: "google-cast:default",
        kind: "google-cast",
        name: "Google Cast",
        available: true,
      }),
    ]);

    const target = targets[0];
    expect(target).toBeDefined();
    const result = await googleCastTargetProvider.selectTarget(target!, {
      currentTrack,
      currentTime: 12.4,
      pause,
    });

    expect(result).toEqual({ ok: true, message: "Casting." });
    expect(startCastSessionMock).toHaveBeenCalledWith({
      track: currentTrack,
      currentTime: 12.4,
      targetDeviceId: "google-cast:default",
    });
    expect(pause).toHaveBeenCalledTimes(1);
  });
});
