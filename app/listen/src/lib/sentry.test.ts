import { beforeEach, describe, expect, it, vi } from "vitest";

const { init, setUser, browserTracingIntegration } = vi.hoisted(() => ({
  init: vi.fn(),
  setUser: vi.fn(),
  browserTracingIntegration: vi.fn(() => "browser-tracing"),
}));

vi.mock("@sentry/react", () => ({
  init,
  setUser,
  browserTracingIntegration,
}));

import { initSentry, setSentryUser } from "./sentry";

describe("Listen Sentry setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes tracing asynchronously for web and desktop", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/2");

    const initialization = initSentry();

    expect(initialization).toBeInstanceOf(Promise);
    await initialization;

    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example.test/2",
        sendDefaultPii: false,
      }),
    );
  });

  it("clears the stable user id on logout", async () => {
    await setSentryUser("listen-user");
    await setSentryUser(null);

    expect(setUser).toHaveBeenNthCalledWith(1, { id: "listen-user" });
    expect(setUser).toHaveBeenNthCalledWith(2, null);
  });
});
