import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_SKIN,
  MODE_REGISTRY,
  applyThemeSkin,
  getAppliedThemeSkin,
  readStoredThemeSkin,
  resolveColorMode,
  resolveThemeSkin,
  subscribeThemeSkin,
} from "./theme-skin";

function createMatchMedia(initiallyDark: boolean) {
  let matches = initiallyDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  const mediaQuery = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, listener: EventListener) => {
      listeners.add(listener as (event: MediaQueryListEvent) => void);
    },
    removeEventListener: (_type: string, listener: EventListener) => {
      listeners.delete(listener as (event: MediaQueryListEvent) => void);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;

  return {
    mediaQuery,
    setDark(next: boolean) {
      matches = next;
      listeners.forEach((listener) =>
        listener({ matches, media: mediaQuery.media } as MediaQueryListEvent),
      );
    },
    listenerCount: () => listeners.size,
  };
}

describe("theme and skin runtime", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-crate-mode");
    document.documentElement.removeAttribute("data-crate-mode-preference");
    document.documentElement.removeAttribute("data-crate-skin");
  });

  it("keeps translated labels out of the shared runtime registry", async () => {
    const { SKIN_REGISTRY } = await import("./theme-skin");

    expect(MODE_REGISTRY.dark).not.toHaveProperty("label");
    expect(MODE_REGISTRY.light).not.toHaveProperty("label");
    expect(MODE_REGISTRY.system).not.toHaveProperty("label");
    expect(SKIN_REGISTRY.default).not.toHaveProperty("label");
    expect(SKIN_REGISTRY.crateRed).not.toHaveProperty("label");
  });

  it("resolves dark, light, and system preferences", () => {
    expect(resolveColorMode("dark", false)).toBe("dark");
    expect(resolveColorMode("light", true)).toBe("light");
    expect(resolveColorMode("system", true)).toBe("dark");
    expect(resolveColorMode("system", false)).toBe("light");
  });

  it("falls back to the supported default for unknown and legacy values", () => {
    const unknownStorage = {
      getItem: () => JSON.stringify({ mode: "neon", skin: "aurora" }),
    } as unknown as Storage;
    const legacyStorage = {
      getItem: () => JSON.stringify({ theme: "high-contrast", skin: "aurora" }),
    } as unknown as Storage;

    expect(readStoredThemeSkin(unknownStorage)).toEqual(DEFAULT_THEME_SKIN);
    expect(readStoredThemeSkin(legacyStorage)).toEqual(DEFAULT_THEME_SKIN);
  });

  it("migrates the previous dark aurora selection to Crate Red", () => {
    const storage = {
      getItem: () => JSON.stringify({ theme: "dark", skin: "aurora" }),
    } as unknown as Storage;

    expect(readStoredThemeSkin(storage)).toEqual({
      mode: "dark",
      skin: "crateRed",
    });
  });

  it("resolves only registered skin combinations", () => {
    expect(resolveThemeSkin("dark", "default")).toEqual(DEFAULT_THEME_SKIN);
    expect(resolveThemeSkin("light", "default")).toEqual({
      mode: "light",
      skin: "default",
    });
    expect(resolveThemeSkin("dark", "crateRed")).toEqual({
      mode: "dark",
      skin: "crateRed",
    });
    expect(resolveThemeSkin("light", "crateRed")).toEqual({
      mode: "light",
      skin: "crateRed",
    });
  });

  it("defines explicit dark and light token variants for each skin", async () => {
    const { SKIN_REGISTRY } = await import("./theme-skin");

    Object.values(SKIN_REGISTRY).forEach(({ modes }) => {
      expect(modes.dark["--color-primary"]).toBeTruthy();
      expect(modes.light["--color-primary"]).toBeTruthy();
      expect(modes.dark["--surface-app"]).toBeTruthy();
      expect(modes.light["--surface-app"]).toBeTruthy();
    });

    expect(SKIN_REGISTRY.default.modes.light["--surface-app"]).toBe("#f8fafc");
    expect(SKIN_REGISTRY.crateRed.modes.dark["--color-primary"]).toBe(
      "#ff375f",
    );
  });

  it("applies resolved mode and persists the preference", () => {
    const root = document.documentElement;
    const values = new Map<string, string>();
    const storage = {
      setItem: (key: string, value: string) => values.set(key, value),
    } as unknown as Storage;

    const selection = applyThemeSkin("light", "default", { root, storage });

    expect(selection).toEqual({
      mode: "light",
      skin: "default",
      resolvedMode: "light",
    });
    expect(root.dataset.crateApp).toBe("listen");
    expect(root.dataset.crateMode).toBe("light");
    expect(root.dataset.crateModePreference).toBe("light");
    expect(root.dataset.crateSkin).toBe("default");
    expect(values.get("crate.listen.theme-skin")).toBe(
      JSON.stringify({ mode: "light", skin: "default" }),
    );
  });

  it("keeps v2 preferences when the legacy facade changes mode or skin", () => {
    const root = document.documentElement;
    const values = new Map([
      [
        "crate.listen.appearance.v2",
        JSON.stringify({
          version: 2,
          mode: "dark",
          preset: "default",
          overrides: { accent: "violet", material: "solid" },
          presentation: { density: "compact" },
          accessibility: { motion: "reduced" },
          preserved: { source: "future-client" },
        }),
      ],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } as unknown as Storage;

    applyThemeSkin("light", "crateRed", { root, storage });

    expect(JSON.parse(values.get("crate.listen.appearance.v2")!)).toEqual(
      expect.objectContaining({
        mode: "light",
        preset: "crateRed",
        overrides: { accent: "violet", material: "solid" },
        presentation: { density: "compact" },
        accessibility: { motion: "reduced" },
        preserved: { source: "future-client" },
      }),
    );
    expect(values.get("crate.listen.theme-skin")).toBe(
      JSON.stringify({ mode: "light", skin: "crateRed" }),
    );
  });

  it("reacts to system color changes and removes the old listener", () => {
    const root = document.documentElement;
    const darkMedia = createMatchMedia(true);
    const lightMedia = createMatchMedia(false);
    let currentMedia = darkMedia;

    const matchMedia = () => currentMedia.mediaQuery;
    applyThemeSkin("system", "crateRed", {
      root,
      storage: undefined,
      matchMedia,
    });

    expect(root.dataset.crateMode).toBe("dark");
    expect(root.dataset.crateModePreference).toBe("system");
    expect(darkMedia.listenerCount()).toBe(1);

    darkMedia.setDark(false);
    expect(root.dataset.crateMode).toBe("light");

    currentMedia = lightMedia;
    applyThemeSkin("light", "default", {
      root,
      storage: undefined,
      matchMedia,
    });

    expect(darkMedia.listenerCount()).toBe(0);
    expect(lightMedia.listenerCount()).toBe(0);
    expect(root.dataset.crateMode).toBe("light");
  });

  it("notifies app surfaces when the resolved appearance changes", () => {
    const root = document.documentElement;
    const changes: string[] = [];
    const unsubscribe = subscribeThemeSkin(() => {
      changes.push(getAppliedThemeSkin().resolvedMode);
    });

    applyThemeSkin("light", "default", { root, storage: undefined });
    unsubscribe();
    applyThemeSkin("dark", "default", { root, storage: undefined });

    expect(changes).toEqual(["light"]);
    expect(getAppliedThemeSkin().resolvedMode).toBe("dark");
  });
});
