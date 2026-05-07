import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadStorage(options: { native: boolean; apiBase?: string }) {
  vi.resetModules();
  vi.doMock("@/lib/api", () => ({
    getApiBase: () => options.apiBase ?? "",
  }));
  vi.doMock("@/lib/capacitor-runtime", () => ({
    isNative: options.native,
  }));
  return import("./auth-user-storage");
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.doUnmock("@/lib/api");
  vi.doUnmock("@/lib/capacitor-runtime");
  vi.resetModules();
});

describe("auth user storage", () => {
  it("keeps web installs on the legacy key", async () => {
    const storage = await loadStorage({ native: false });

    storage.setStoredAuthUserId(7);

    expect(localStorage.getItem("listen-auth-user-id")).toBe("7");
    expect(storage.getStoredAuthUserId()).toBe("7");
  });

  it("scopes native user ids by server origin", async () => {
    const storage = await loadStorage({
      native: true,
      apiBase: "https://api-one.example.test/rest",
    });

    storage.setStoredAuthUserId(42);

    expect(localStorage.getItem("listen-auth-user-id")).toBeNull();
    expect(storage.getStoredAuthUserId()).toBe("42");
    expect(storage.getAuthUserIdStorageKey()).toBe(
      "listen-auth-user-id:https%3A%2F%2Fapi-one.example.test",
    );
  });

  it("migrates native legacy user ids into the scoped key", async () => {
    localStorage.setItem("listen-auth-user-id", "11");
    const storage = await loadStorage({
      native: true,
      apiBase: "https://api-two.example.test",
    });

    expect(storage.getStoredAuthUserId()).toBe("11");
    expect(localStorage.getItem("listen-auth-user-id")).toBeNull();
    expect(localStorage.getItem("listen-auth-user-id:https%3A%2F%2Fapi-two.example.test")).toBe("11");
  });
});
