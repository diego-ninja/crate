import {
  APPEARANCE_CORRUPT_BACKUP_STORAGE_KEY,
  APPEARANCE_LEGACY_BACKUP_STORAGE_KEY,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_PREFERENCES,
  LEGACY_THEME_SKIN_STORAGE_KEY,
  type AccentId,
  type AppearanceEffectiveValues,
  type AppearanceEnvironment,
  type AppearanceOverrides,
  type AppearancePreferencesV2,
  type AppearanceReadResult,
  type AppearanceResolution,
  type AppearanceStorage,
  type AppearanceWriteResult,
  type ColorModePreference,
  type ContentDensity,
  type Effects,
  type Material,
  type MotionPreference,
  type PresetId,
  type Radius,
  type StorageReader,
  type SurfaceTone,
  type Typography,
} from "./appearance-types";

export {
  APPEARANCE_CORRUPT_BACKUP_STORAGE_KEY,
  APPEARANCE_LEGACY_BACKUP_STORAGE_KEY,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_PREFERENCES,
  LEGACY_THEME_SKIN_STORAGE_KEY,
  createDefaultAppearancePreferences,
} from "./appearance-types";
export type {
  AccentId,
  AppearanceEffectiveValues,
  AppearanceEnvironment,
  AppearanceOverrides,
  AppearancePreferencesV2,
  AppearanceReadResult,
  AppearanceResolution,
  AppearanceStorage,
  AppearanceWriteResult,
  ColorModePreference,
  ContentDensity,
  Effects,
  Material,
  MotionPreference,
  PresetId,
  Radius,
  StorageReader,
  SurfaceTone,
  Typography,
} from "./appearance-types";

const PRESET_DEFAULTS: Record<PresetId, AppearanceEffectiveValues> = {
  default: {
    accent: "cyan",
    surfaceTone: "neutral",
    material: "glass",
    radius: "subtle",
    typography: "brand",
    effects: "subtle",
  },
  crateRed: {
    accent: "red",
    surfaceTone: "warm",
    material: "glass",
    radius: "rounded",
    typography: "system",
    effects: "subtle",
  },
};

const ACCENTS = new Set<AccentId>(["cyan", "red", "violet"]);
const SURFACE_TONES = new Set<SurfaceTone>(["neutral", "warm", "tinted"]);
const MATERIALS = new Set<Material>(["solid", "glass"]);
const RADII = new Set<Radius>(["subtle", "rounded"]);
const TYPOGRAPHIES = new Set<Typography>(["brand", "system"]);
const EFFECTS = new Set<Effects>(["off", "subtle", "expressive"]);
const MODES = new Set<ColorModePreference>(["dark", "light", "system"]);
const PRESETS = new Set<PresetId>(["default", "crateRed"]);
const DENSITIES = new Set<ContentDensity>(["comfortable", "compact"]);
const MOTIONS = new Set<MotionPreference>(["system", "reduced"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T>(value: unknown, values: Set<T>, fallback: T): T {
  return values.has(value as T) ? (value as T) : fallback;
}

function normalizeOverrides(value: unknown): AppearanceOverrides {
  if (!isRecord(value)) return {};

  const overrides: AppearanceOverrides = {};
  if (ACCENTS.has(value.accent as AccentId))
    overrides.accent = value.accent as AccentId;
  if (SURFACE_TONES.has(value.surfaceTone as SurfaceTone)) {
    overrides.surfaceTone = value.surfaceTone as SurfaceTone;
  }
  if (MATERIALS.has(value.material as Material))
    overrides.material = value.material as Material;
  if (RADII.has(value.radius as Radius))
    overrides.radius = value.radius as Radius;
  if (TYPOGRAPHIES.has(value.typography as Typography)) {
    overrides.typography = value.typography as Typography;
  }
  if (EFFECTS.has(value.effects as Effects))
    overrides.effects = value.effects as Effects;
  return overrides;
}

export function normalizeAppearancePreferences(
  value: unknown,
): AppearancePreferencesV2 {
  const record = isRecord(value) ? value : {};
  const mode = pick(record.mode, MODES, DEFAULT_APPEARANCE_PREFERENCES.mode);
  const preset = pick(
    record.preset,
    PRESETS,
    DEFAULT_APPEARANCE_PREFERENCES.preset,
  );
  const presentation = isRecord(record.presentation) ? record.presentation : {};
  const accessibility = isRecord(record.accessibility)
    ? record.accessibility
    : {};

  return {
    version: 2,
    mode,
    preset,
    overrides: normalizeOverrides(record.overrides),
    presentation: {
      density: pick(
        presentation.density,
        DENSITIES,
        DEFAULT_APPEARANCE_PREFERENCES.presentation.density,
      ),
    },
    accessibility: {
      motion: pick(
        accessibility.motion,
        MOTIONS,
        DEFAULT_APPEARANCE_PREFERENCES.accessibility.motion,
      ),
    },
  };
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isFutureVersion(value: unknown): boolean {
  return (
    isRecord(value) && typeof value.version === "number" && value.version > 2
  );
}

function parseLegacyPreferences(
  value: unknown,
): AppearancePreferencesV2 | undefined {
  if (!isRecord(value)) return undefined;
  const mode = value.mode ?? value.theme;
  if (mode !== "dark" && mode !== "light" && mode !== "system")
    return undefined;

  const preset = value.skin === "aurora" ? "crateRed" : value.skin;
  return normalizeAppearancePreferences({ mode, preset });
}

export function inspectAppearancePreferences(
  storage: StorageReader,
): AppearanceReadResult {
  const v2Raw = storage.getItem(APPEARANCE_STORAGE_KEY);
  if (v2Raw !== null) {
    const parsed = parseJson(v2Raw);
    if (isFutureVersion(parsed)) {
      return {
        preferences: normalizeAppearancePreferences(undefined),
        status: "future-version",
        raw: v2Raw,
      };
    }
    if (isRecord(parsed) && parsed.version === 2) {
      return {
        preferences: normalizeAppearancePreferences(parsed),
        status: "valid",
        raw: v2Raw,
      };
    }
    return {
      preferences: normalizeAppearancePreferences(undefined),
      status: "corrupt",
      raw: v2Raw,
    };
  }

  const legacyRaw = storage.getItem(LEGACY_THEME_SKIN_STORAGE_KEY);
  const legacy = parseLegacyPreferences(parseJson(legacyRaw));
  if (legacy)
    return {
      preferences: legacy,
      status: "legacy",
      raw: legacyRaw ?? undefined,
    };

  return {
    preferences: normalizeAppearancePreferences(undefined),
    status: "default",
  };
}

export function readAppearancePreferences(
  storage: StorageReader,
): AppearancePreferencesV2 {
  return inspectAppearancePreferences(storage).preferences;
}

function safeSet(
  storage: AppearanceStorage,
  key: string,
  value: string,
): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function writeAppearancePreferences(
  storage: AppearanceStorage,
  preferences: AppearancePreferencesV2,
): AppearanceWriteResult {
  const current = inspectAppearancePreferences(storage);
  if (current.status === "future-version") {
    return {
      status: "future-version",
      v2Saved: false,
      legacyProjected: false,
      backupSaved: false,
    };
  }

  let backupSaved = false;
  if (current.status === "corrupt" && current.raw) {
    backupSaved = safeSet(
      storage,
      APPEARANCE_CORRUPT_BACKUP_STORAGE_KEY,
      current.raw,
    );
    if (!backupSaved) {
      return {
        status: "backup-failed",
        v2Saved: false,
        legacyProjected: false,
        backupSaved: false,
      };
    }
  } else if (current.status === "legacy" && current.raw) {
    const existingBackup = storage.getItem(
      APPEARANCE_LEGACY_BACKUP_STORAGE_KEY,
    );
    if (existingBackup === null) {
      backupSaved = safeSet(
        storage,
        APPEARANCE_LEGACY_BACKUP_STORAGE_KEY,
        current.raw,
      );
      if (!backupSaved) {
        return {
          status: "backup-failed",
          v2Saved: false,
          legacyProjected: false,
          backupSaved: false,
        };
      }
    } else {
      backupSaved = true;
    }
  }

  const normalized = normalizeAppearancePreferences(preferences);
  const existing =
    current.status === "valid" ? parseJson(current.raw ?? null) : undefined;
  const payload = {
    ...(isRecord(existing) ? existing : {}),
    ...normalized,
  };

  if (!safeSet(storage, APPEARANCE_STORAGE_KEY, JSON.stringify(payload))) {
    return {
      status: "primary-failed",
      v2Saved: false,
      legacyProjected: false,
      backupSaved,
    };
  }

  const legacyProjected = safeSet(
    storage,
    LEGACY_THEME_SKIN_STORAGE_KEY,
    JSON.stringify({ mode: normalized.mode, skin: normalized.preset }),
  );

  return {
    status: legacyProjected ? "saved" : "legacy-projection-failed",
    v2Saved: true,
    legacyProjected,
    backupSaved,
  };
}

export function resolveAppearance(
  preferences: AppearancePreferencesV2,
  environment: AppearanceEnvironment,
): AppearanceResolution {
  const normalized = normalizeAppearancePreferences(preferences);
  const mode =
    normalized.mode === "system"
      ? environment.prefersColorSchemeDark
        ? "dark"
        : "light"
      : normalized.mode;
  const effective = {
    ...PRESET_DEFAULTS[normalized.preset],
    ...normalized.overrides,
  };

  return {
    mode,
    preset: normalized.preset,
    preferences: normalized,
    effective,
    density: normalized.presentation.density,
    motion: normalized.accessibility.motion,
    reducedMotion:
      normalized.accessibility.motion === "reduced" ||
      environment.prefersReducedMotion,
  };
}

const ACCENT_COLORS: Record<
  PresetId,
  Record<"dark" | "light", Record<AccentId, string>>
> = {
  default: {
    dark: { cyan: "#06b6d4", red: "#ef4444", violet: "#8b5cf6" },
    light: { cyan: "#0e7490", red: "#dc2626", violet: "#7c3aed" },
  },
  crateRed: {
    dark: { cyan: "#06b6d4", red: "#ff375f", violet: "#8b5cf6" },
    light: { cyan: "#0e7490", red: "#d61f45", violet: "#7c3aed" },
  },
};

const SURFACE_COLORS: Record<
  PresetId,
  Record<"dark" | "light", Record<string, string>>
> = {
  default: {
    dark: {
      "--crate-token-color-background": "#0a0a0f",
      "--crate-token-color-foreground": "#f1f5f9",
      "--crate-token-color-muted-foreground": "#64748b",
      "--crate-token-surface-app": "#0a0a0f",
      "--crate-token-surface-card-solid": "#16161e",
      "--crate-token-surface-card-foreground-solid": "#f1f5f9",
      "--crate-token-surface-panel-solid": "#0c0c14",
      "--crate-token-surface-raised-solid": "#12121a",
      "--crate-token-surface-modal-solid": "rgba(16, 16, 24, 0.95)",
    },
    light: {
      "--crate-token-color-background": "#f8fafc",
      "--crate-token-color-foreground": "#0f172a",
      "--crate-token-color-muted-foreground": "#64748b",
      "--crate-token-surface-app": "#f8fafc",
      "--crate-token-surface-card-solid": "#ffffff",
      "--crate-token-surface-card-foreground-solid": "#0f172a",
      "--crate-token-surface-panel-solid": "#ffffff",
      "--crate-token-surface-raised-solid": "#f1f5f9",
      "--crate-token-surface-modal-solid": "rgba(255, 255, 255, 0.96)",
    },
  },
  crateRed: {
    dark: {
      "--crate-token-color-background": "#1c1c1e",
      "--crate-token-color-foreground": "#f5f5f7",
      "--crate-token-color-muted-foreground": "#a1a1aa",
      "--crate-token-surface-app": "#1c1c1e",
      "--crate-token-surface-card-solid": "#242426",
      "--crate-token-surface-card-foreground-solid": "#f5f5f7",
      "--crate-token-surface-panel-solid": "#232326",
      "--crate-token-surface-raised-solid": "#2c2c2e",
      "--crate-token-surface-modal-solid": "rgba(44, 44, 46, 0.96)",
    },
    light: {
      "--crate-token-color-background": "#f5f5f7",
      "--crate-token-color-foreground": "#1d1d1f",
      "--crate-token-color-muted-foreground": "#6e6e73",
      "--crate-token-surface-app": "#f5f5f7",
      "--crate-token-surface-card-solid": "#ffffff",
      "--crate-token-surface-card-foreground-solid": "#1d1d1f",
      "--crate-token-surface-panel-solid": "#ffffff",
      "--crate-token-surface-raised-solid": "#f2f2f7",
      "--crate-token-surface-modal-solid": "rgba(255, 255, 255, 0.96)",
    },
  },
};

const RADIUS_VALUES: Record<Radius, Record<string, string>> = {
  subtle: {
    "--crate-token-radius-sm": "0.125rem",
    "--crate-token-radius-md": "0.25rem",
    "--crate-token-radius-lg": "0.375rem",
    "--crate-token-radius-xl": "0.5rem",
  },
  rounded: {
    "--crate-token-radius-sm": "0.25rem",
    "--crate-token-radius-md": "0.5rem",
    "--crate-token-radius-lg": "0.75rem",
    "--crate-token-radius-xl": "1rem",
  },
};

function appearanceRuntimeVariables(
  appearance: AppearanceResolution,
): Record<string, string> {
  const accent =
    ACCENT_COLORS[appearance.preset][appearance.mode][
      appearance.effective.accent
    ];
  const surfaceColors = SURFACE_COLORS[appearance.preset][appearance.mode];

  return {
    ...surfaceColors,
    "--crate-token-color-primary": accent,
    "--crate-token-color-primary-foreground":
      appearance.mode === "dark" ? "#0a0a0f" : "#ffffff",
    "--crate-token-color-ring": accent,
    ...RADIUS_VALUES[appearance.effective.radius],
    "--font-brand":
      appearance.effective.typography === "system"
        ? "system-ui, sans-serif"
        : "Poppins",
  };
}

const SCOPE_ATTRIBUTES = [
  "crateMode",
  "crateModePreference",
  "crateSkin",
  "crateEffects",
  "surface",
] as const;

export function applyAppearanceToRoot(
  root: HTMLElement,
  appearance: AppearanceResolution,
): () => void {
  const variables = appearanceRuntimeVariables(appearance);
  const previousVariables = new Map<string, [string, string]>();
  Object.keys(variables).forEach((name) => {
    previousVariables.set(name, [
      root.style.getPropertyValue(name),
      root.style.getPropertyPriority(name),
    ]);
    root.style.setProperty(name, variables[name]!);
  });

  const previousAttributes = new Map<string, string | null>();
  SCOPE_ATTRIBUTES.forEach((attribute) => {
    previousAttributes.set(attribute, root.dataset[attribute] ?? null);
  });
  root.dataset.crateMode = appearance.mode;
  root.dataset.crateModePreference = appearance.preferences.mode;
  root.dataset.crateSkin = appearance.preset;
  root.dataset.crateEffects = appearance.effective.effects;
  root.dataset.surface = appearance.effective.material;

  const previousColorScheme = root.style.colorScheme;
  root.style.colorScheme = appearance.mode;

  return () => {
    previousVariables.forEach(([value, priority], name) => {
      if (value) root.style.setProperty(name, value, priority);
      else root.style.removeProperty(name);
    });
    SCOPE_ATTRIBUTES.forEach((attribute) => {
      const value = previousAttributes.get(attribute);
      if (value === null || value === undefined) delete root.dataset[attribute];
      else root.dataset[attribute] = value;
    });
    root.style.colorScheme = previousColorScheme;
  };
}
