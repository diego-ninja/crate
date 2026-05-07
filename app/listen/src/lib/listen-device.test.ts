import { describe, expect, it, vi } from "vitest";

async function loadDeviceHelpers({
  native,
  platform,
  navigatorPatch,
}: {
  native: boolean;
  platform: "android" | "ios" | "web";
  navigatorPatch?: Partial<Navigator>;
}) {
  vi.resetModules();
  vi.doMock("@/lib/capacitor-runtime", () => ({
    isAndroidNative: native && platform === "android",
    isIosNative: native && platform === "ios",
    isNative: native,
    platform,
  }));

  const effectiveNavigatorPatch: Partial<Navigator> = {
    maxTouchPoints: 0,
    platform: "",
    userAgent: "",
    ...navigatorPatch,
  };
  for (const [key, value] of Object.entries(effectiveNavigatorPatch)) {
    Object.defineProperty(window.navigator, key, {
      configurable: true,
      value,
    });
  }

  const module = await import("@/lib/listen-device");
  vi.doUnmock("@/lib/capacitor-runtime");

  return module;
}

describe("listen device helpers", () => {
  it("labels Android native sessions", async () => {
    const { getListenAppPlatform, getListenDeviceLabel, getListenDeviceType } = await loadDeviceHelpers({
      native: true,
      platform: "android",
    });

    expect(getListenDeviceType()).toBe("android");
    expect(getListenAppPlatform()).toBe("listen-android");
    expect(getListenDeviceLabel()).toBe("Android (Listen)");
  });

  it("labels iPhone native sessions", async () => {
    const { getListenAppPlatform, getListenDeviceLabel, getListenDeviceType } = await loadDeviceHelpers({
      native: true,
      platform: "ios",
      navigatorPatch: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
    });

    expect(getListenDeviceType()).toBe("iphone");
    expect(getListenAppPlatform()).toBe("listen-ios");
    expect(getListenDeviceLabel()).toBe("iPhone (Listen)");
  });

  it("detects iPad native sessions on modern iPadOS", async () => {
    const { getListenDeviceLabel, getListenDeviceType } = await loadDeviceHelpers({
      native: true,
      platform: "ios",
      navigatorPatch: {
        maxTouchPoints: 5,
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
    });

    expect(getListenDeviceType()).toBe("ipad");
    expect(getListenDeviceLabel()).toBe("iPad (Listen)");
  });
});
