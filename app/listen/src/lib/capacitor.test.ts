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

const { setAuthTokens } = vi.hoisted(() => ({
  setAuthTokens: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  setAuthTokens,
}));

import { consumeOAuthCallbackUrl, consumePendingOAuthNext, getOAuthCallbackPayload } from "@/lib/capacitor";

describe("capacitor OAuth callback helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    setAuthTokens.mockReset();
  });

  it("stores token and pending next for native OAuth callbacks", async () => {
    const result = await consumeOAuthCallbackUrl("cratemusic://oauth/callback?token=abc123&next=%2Fmixes");

    expect(result).toEqual({ handled: true, next: "/mixes" });
    expect(setAuthTokens).toHaveBeenCalledWith("abc123", undefined);
    expect(consumePendingOAuthNext()).toBe("/mixes");
    expect(consumePendingOAuthNext()).toBeNull();
  });

  it("stores token and pending next for iOS universal link callbacks", async () => {
    const result = await consumeOAuthCallbackUrl("https://listen.lespedants.org/auth/callback?token=abc123&next=%2Fmixes");

    expect(result).toEqual({ handled: true, next: "/mixes" });
    expect(setAuthTokens).toHaveBeenCalledWith("abc123", undefined);
    expect(consumePendingOAuthNext()).toBe("/mixes");
  });

  it("stores refresh token when the native callback includes one", async () => {
    const result = await consumeOAuthCallbackUrl("cratemusic://oauth/callback?token=abc123&refresh_token=refresh456&next=%2Fmixes");

    expect(result).toEqual({ handled: true, next: "/mixes" });
    expect(setAuthTokens).toHaveBeenCalledWith("abc123", "refresh456");
  });

  it("ignores unrelated URLs", async () => {
    const result = await consumeOAuthCallbackUrl("https://example.com/login");

    expect(result).toEqual({ handled: false, next: "/" });
    expect(setAuthTokens).not.toHaveBeenCalled();
    expect(consumePendingOAuthNext()).toBeNull();
  });

  it("parses token and next from plain search params too", () => {
    expect(getOAuthCallbackPayload("?token=abc123&next=%2Fstats")).toEqual({
      token: "abc123",
      refreshToken: null,
      next: "/stats",
    });
  });
});
