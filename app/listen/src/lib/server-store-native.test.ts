import { beforeEach, describe, expect, it, vi } from "vitest";

const { secureGet, secureSet } = vi.hoisted(() => ({
  secureGet: vi.fn(),
  secureSet: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({
  usesConfigurableServer: true,
  isCapacitorRuntime: true,
}));

vi.mock("@/lib/native-secure-session", () => ({
  getSecureSessionValue: secureGet,
  setSecureSessionValue: secureSet,
  removeSecureSessionValue: vi.fn(),
}));

describe("native server credential migration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("moves legacy tokens to native secure storage before stripping metadata", async () => {
    localStorage.setItem(
      "crate-servers:v1",
      JSON.stringify([
        {
          id: "server-1",
          label: "Crate",
          url: "https://api.example.com",
          token: "access-secret",
          tokenExpiresAt: "2030-01-01T00:00:00Z",
          refreshToken: "refresh-secret",
        },
      ]),
    );
    secureSet.mockResolvedValue(undefined);
    secureGet.mockResolvedValue(
      JSON.stringify({
        token: "access-secret",
        refreshToken: "refresh-secret",
      }),
    );
    const store = await import("./server-store");

    await store.bootstrapNativeSessionStore();

    expect(secureSet).toHaveBeenCalledWith(
      "crate.session.server-1",
      JSON.stringify({
        token: "access-secret",
        refreshToken: "refresh-secret",
      }),
    );
    expect(store.getServers()[0]).toMatchObject({
      token: "access-secret",
      refreshToken: "refresh-secret",
    });
    expect(localStorage.getItem("crate-servers:v1")).not.toContain(
      "access-secret",
    );
    expect(localStorage.getItem("crate-servers:v1")).not.toContain(
      "refresh-secret",
    );
  });

  it("preserves legacy credentials when secure verification fails", async () => {
    const legacy = JSON.stringify([
      {
        id: "server-1",
        label: "Crate",
        url: "https://api.example.com",
        token: "access-secret",
        tokenExpiresAt: null,
        refreshToken: "refresh-secret",
      },
    ]);
    localStorage.setItem("crate-servers:v1", legacy);
    secureSet.mockRejectedValue(new Error("keystore unavailable"));
    const store = await import("./server-store");

    await expect(store.bootstrapNativeSessionStore()).rejects.toThrow(
      "Native session migration failed",
    );

    expect(localStorage.getItem("crate-servers:v1")).toBe(legacy);
  });

  it("loads an existing secure session into memory before React renders", async () => {
    localStorage.setItem(
      "crate-servers:v1",
      JSON.stringify([
        {
          id: "server-1",
          label: "Crate",
          url: "https://api.example.com",
          tokenExpiresAt: null,
        },
      ]),
    );
    secureGet.mockResolvedValue(
      JSON.stringify({
        token: "access-secret",
        refreshToken: "refresh-secret",
      }),
    );
    const store = await import("./server-store");

    await store.bootstrapNativeSessionStore();

    expect(store.getServers()[0]).toMatchObject({
      token: "access-secret",
      refreshToken: "refresh-secret",
    });
  });

  it("keeps the pre-server token until secure migration is verified", async () => {
    localStorage.setItem("crate-auth-token", "access-secret");
    secureSet.mockResolvedValue(undefined);
    secureGet.mockResolvedValue(
      JSON.stringify({
        token: "access-secret",
        refreshToken: null,
      }),
    );
    const store = await import("./server-store");

    store.migrateLegacyToken("https://api.example.com");

    expect(localStorage.getItem("crate-auth-token")).toBe("access-secret");
    expect(localStorage.getItem("crate-servers:v1")).toContain("access-secret");

    await store.bootstrapNativeSessionStore();

    expect(store.getCurrentServer()?.token).toBe("access-secret");
    expect(localStorage.getItem("crate-auth-token")).toBeNull();
    expect(localStorage.getItem("crate-servers:v1")).not.toContain(
      "access-secret",
    );
  });

  it("surfaces secure persistence failures to the login flow", async () => {
    localStorage.setItem(
      "crate-servers:v1",
      JSON.stringify([
        {
          id: "server-1",
          label: "Crate",
          url: "https://api.example.com",
          tokenExpiresAt: null,
        },
      ]),
    );
    localStorage.setItem("crate-current-server", "server-1");
    secureGet.mockResolvedValue(null);
    secureSet.mockRejectedValue(new Error("keystore unavailable"));
    const store = await import("./server-store");
    await store.bootstrapNativeSessionStore();

    store.setCurrentServerAuthTokens("access-secret", "refresh-secret");

    await expect(store.waitForPendingSecureSessionWrites()).rejects.toThrow(
      "Native session persistence failed",
    );
  });
});
