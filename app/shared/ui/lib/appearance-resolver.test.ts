import { describe, expect, it } from "vitest";

import {
  APPEARANCE_STORAGE_KEY,
  APPEARANCE_CORRUPT_BACKUP_STORAGE_KEY,
  APPEARANCE_LEGACY_BACKUP_STORAGE_KEY,
  LEGACY_THEME_SKIN_STORAGE_KEY,
  createDefaultAppearancePreferences,
  readAppearancePreferences,
  resolveAccentForeground,
  resolveAppearance,
  resolveDangerForeground,
  validateAppearanceContrast,
  writeAppearancePreferences,
} from "./appearance-resolver";

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("appearance contract v2", () => {
  it("resolves a complete default appearance without DOM access", () => {
    const preferences = createDefaultAppearancePreferences();

    expect(
      resolveAppearance(preferences, {
        prefersColorSchemeDark: false,
        prefersReducedMotion: true,
      }),
    ).toEqual(
      expect.objectContaining({
        mode: "dark",
        preset: "default",
        effective: expect.objectContaining({
          accent: "cyan",
          material: "glass",
        }),
        reducedMotion: true,
      }),
    );
  });

  it("preserves explicit overrides while changing the resolved mode", () => {
    const preferences = {
      ...createDefaultAppearancePreferences(),
      mode: "system" as const,
      preset: "crateRed" as const,
      overrides: {
        accent: "violet" as const,
        material: "solid" as const,
      },
      presentation: { density: "compact" as const },
    };

    const appearance = resolveAppearance(preferences, {
      prefersColorSchemeDark: false,
      prefersReducedMotion: false,
    });

    expect(appearance.mode).toBe("light");
    expect(appearance.preset).toBe("crateRed");
    expect(appearance.effective.accent).toBe("violet");
    expect(appearance.effective.material).toBe("solid");
    expect(appearance.preferences.presentation.density).toBe("compact");
  });

  it("validates every supported accent and material before exposing it", () => {
    for (const preset of ["default", "crateRed"] as const) {
      for (const mode of ["dark", "light"] as const) {
        for (const accent of ["cyan", "red", "violet"] as const) {
          for (const material of ["solid", "glass"] as const) {
            const appearance = resolveAppearance(
              {
                ...createDefaultAppearancePreferences(),
                mode,
                preset,
                overrides: { accent, material },
              },
              {
                prefersColorSchemeDark: mode === "dark",
                prefersReducedMotion: false,
              },
            );

            expect(validateAppearanceContrast(appearance)).toEqual({
              valid: true,
              issues: [],
            });
            expect(resolveAccentForeground(appearance)).toMatch(/^#/);
            expect(resolveDangerForeground(appearance)).toMatch(/^#/);
          }
        }
      }
    }
  });

  it("migrates a legacy selection without writing during read", () => {
    const storage = createStorage({
      [LEGACY_THEME_SKIN_STORAGE_KEY]: JSON.stringify({
        theme: "dark",
        skin: "aurora",
      }),
    });

    expect(readAppearancePreferences(storage)).toEqual(
      expect.objectContaining({
        version: 2,
        mode: "dark",
        preset: "crateRed",
        presentation: { density: "comfortable" },
      }),
    );
    expect(storage.values.has(APPEARANCE_STORAGE_KEY)).toBe(false);
  });

  it("preserves unknown v2 fields and projects a legacy selection", () => {
    const storage = createStorage({
      [APPEARANCE_STORAGE_KEY]: JSON.stringify({
        version: 2,
        mode: "light",
        preset: "default",
        overrides: { accent: "violet" },
        presentation: { density: "compact" },
        accessibility: { motion: "reduced" },
        futureField: { keep: true },
      }),
    });

    const result = writeAppearancePreferences(storage, {
      ...createDefaultAppearancePreferences(),
      mode: "dark",
      preset: "crateRed",
      overrides: { accent: "red" },
      presentation: { density: "compact" },
      accessibility: { motion: "reduced" },
    });

    expect(result.status).toBe("saved");
    expect(JSON.parse(storage.values.get(APPEARANCE_STORAGE_KEY)!)).toEqual(
      expect.objectContaining({
        futureField: { keep: true },
        preset: "crateRed",
      }),
    );
    expect(
      JSON.parse(storage.values.get(LEGACY_THEME_SKIN_STORAGE_KEY)!),
    ).toEqual({
      mode: "dark",
      skin: "crateRed",
    });
  });

  it("does not overwrite corrupt v2 data if its backup fails", () => {
    const corrupt = "{not-json";
    const storage = {
      getItem: (key: string) =>
        key === APPEARANCE_STORAGE_KEY ? corrupt : null,
      setItem: (key: string) => {
        if (key === APPEARANCE_CORRUPT_BACKUP_STORAGE_KEY)
          throw new Error("quota");
      },
    };

    const result = writeAppearancePreferences(
      storage,
      createDefaultAppearancePreferences(),
    );

    expect(result.status).toBe("backup-failed");
    expect(storage.getItem(APPEARANCE_STORAGE_KEY)).toBe(corrupt);
  });

  it("backs up the legacy payload once when projecting a migrated appearance", () => {
    const legacy = JSON.stringify({ mode: "light", skin: "default" });
    const storage = createStorage({ [LEGACY_THEME_SKIN_STORAGE_KEY]: legacy });

    writeAppearancePreferences(storage, {
      ...createDefaultAppearancePreferences(),
      mode: "light",
      preset: "default",
    });

    expect(storage.values.get(APPEARANCE_LEGACY_BACKUP_STORAGE_KEY)).toBe(
      legacy,
    );
  });
});
