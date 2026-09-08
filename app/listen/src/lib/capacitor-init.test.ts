import { beforeEach, describe, expect, it, vi } from "vitest";

const { appAddListener, networkAddListener, statusBarSetStyle } = vi.hoisted(
  () => ({
    appAddListener: vi.fn(),
    networkAddListener: vi.fn(),
    statusBarSetStyle: vi.fn(),
  }),
);

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: appAddListener,
    getLaunchUrl: vi.fn(async () => null),
    exitApp: vi.fn(),
  },
}));

vi.mock("@capacitor/keyboard", () => ({
  Keyboard: {
    setStyle: vi.fn(),
    setResizeMode: vi.fn(),
    setAccessoryBarVisible: vi.fn(),
    setScroll: vi.fn(),
    addListener: vi.fn(),
  },
  KeyboardResize: { Body: "body" },
  KeyboardStyle: { Dark: "dark" },
}));

vi.mock("@capacitor/network", () => ({
  Network: {
    addListener: networkAddListener,
  },
}));

vi.mock("@capacitor/status-bar", () => ({
  StatusBar: {
    setStyle: statusBarSetStyle,
    setOverlaysWebView: vi.fn(),
    setBackgroundColor: vi.fn(),
  },
  Style: { Dark: "dark", Light: "light" },
}));

vi.mock("@/lib/capacitor-oauth", () => ({
  consumeOAuthCallbackUrl: vi.fn(),
}));

vi.mock("@/lib/capacitor-runtime", () => ({
  isIosRuntime: false,
  isNative: true,
  platform: "android",
}));

describe("Capacitor initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    appAddListener.mockReset();
    networkAddListener.mockReset();
    statusBarSetStyle.mockReset();
    appAddListener.mockResolvedValue({ remove: vi.fn() });
    networkAddListener.mockResolvedValue({ remove: vi.fn() });
  });

  it("registers native lifecycle listeners only once", async () => {
    const { initCapacitor } = await import("./capacitor-init");

    await Promise.all([initCapacitor(), initCapacitor()]);

    expect(appAddListener).toHaveBeenCalledTimes(4);
    expect(networkAddListener).toHaveBeenCalledTimes(1);
  });

  it("maps the resolved appearance mode to the native status bar", async () => {
    const { applyNativeColorMode } = await import("./capacitor-init");

    await applyNativeColorMode("light");

    expect(statusBarSetStyle).toHaveBeenCalledWith({ style: "light" });
  });
});
