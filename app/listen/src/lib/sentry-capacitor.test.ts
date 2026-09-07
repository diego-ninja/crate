import { describe, expect, it, vi } from "vitest";

const { capacitorInit, reactInit, browserTracingIntegration } = vi.hoisted(
  () => ({
    capacitorInit: vi.fn(),
    reactInit: vi.fn(),
    browserTracingIntegration: vi.fn(() => "browser-tracing"),
  }),
);

vi.mock("@sentry/capacitor", () => ({
  init: capacitorInit,
  browserTracingIntegration,
}));

vi.mock("@sentry/react", () => ({ init: reactInit }));

import { initNativeSentry } from "./sentry-capacitor";

describe("Capacitor Sentry setup", () => {
  it("initializes the native SDK with the React sibling SDK", () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/native");

    initNativeSentry();

    expect(capacitorInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example.test/native",
        enableNative: true,
        enableNativeCrashHandling: true,
        enableCaptureFailedRequests: true,
        sendDefaultPii: false,
      }),
      reactInit,
    );
  });
});
