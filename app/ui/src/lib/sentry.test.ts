import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureException,
  init,
  setUser,
  withScope,
  browserTracingIntegration,
} = vi.hoisted(() => ({
  captureException: vi.fn(),
  init: vi.fn(),
  setUser: vi.fn(),
  withScope: vi.fn(),
  browserTracingIntegration: vi.fn(() => "browser-tracing"),
}));

vi.mock("@sentry/react", () => ({
  captureException,
  init,
  setUser,
  withScope,
  browserTracingIntegration,
}));

import { initSentry, setSentryUser } from "./sentry";

describe("admin Sentry setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not initialize without a DSN", () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");

    initSentry();

    expect(init).not.toHaveBeenCalled();
  });

  it("initializes tracing with privacy-safe defaults", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/1");
    vi.stubEnv("VITE_SENTRY_ENVIRONMENT", "test");
    vi.stubEnv("VITE_SENTRY_RELEASE", "crate-test");

    initSentry();

    expect(browserTracingIntegration).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example.test/1",
        environment: "test",
        release: "crate-test",
        sendDefaultPii: false,
        integrations: ["browser-tracing"],
      }),
    );
  });

  it("sets only the authenticated user's stable id", () => {
    setSentryUser(42);
    setSentryUser(null);

    expect(setUser).toHaveBeenNthCalledWith(1, { id: "42" });
    expect(setUser).toHaveBeenNthCalledWith(2, null);
  });
});
