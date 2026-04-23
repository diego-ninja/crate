import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(),
    getLaunchUrl: vi.fn(async () => null),
    exitApp: vi.fn(),
  },
}));

vi.mock("@capacitor/network", () => ({
  Network: {
    addListener: vi.fn(),
    getStatus: vi.fn(async () => ({ connected: true })),
  },
}));

vi.mock("@capacitor/status-bar", () => ({
  StatusBar: {
    setStyle: vi.fn(async () => {}),
    setOverlaysWebView: vi.fn(async () => {}),
    setBackgroundColor: vi.fn(async () => {}),
  },
  Style: { Dark: "DARK" },
}));

vi.mock("@capacitor/browser", () => ({
  Browser: {
    close: vi.fn(async () => {}),
  },
}));

const setAuthToken = vi.fn();
vi.mock("@/lib/api", () => ({
  setAuthToken,
}));

import { consumeOAuthCallbackUrl, consumePendingOAuthNext } from "@/lib/capacitor";

describe("capacitor OAuth callback helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    setAuthToken.mockReset();
  });

  it("stores token and pending next for native OAuth callbacks", async () => {
    const result = await consumeOAuthCallbackUrl("cratemusic://oauth/callback?token=abc123&next=%2Fmixes");

    expect(result).toEqual({ handled: true, next: "/mixes" });
    expect(setAuthToken).toHaveBeenCalledWith("abc123");
    expect(consumePendingOAuthNext()).toBe("/mixes");
    expect(consumePendingOAuthNext()).toBeNull();
  });

  it("ignores unrelated URLs", async () => {
    const result = await consumeOAuthCallbackUrl("https://example.com/login");

    expect(result).toEqual({ handled: false, next: "/" });
    expect(setAuthToken).not.toHaveBeenCalled();
    expect(consumePendingOAuthNext()).toBeNull();
  });
});
