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
import {
  chooseAccessibleForeground,
  contrastRatioComposited,
  DEFAULT_DARK_FOREGROUND,
} from "./color-contrast";

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

export interface AppearanceContrastIssue {
  token: string;
  ratio: number | null;
  minimum: number;
}

export interface AppearanceContrastReport {
  valid: boolean;
  issues: AppearanceContrastIssue[];
}

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

function accentColorFor(appearance: AppearanceResolution): string {
  return ACCENT_COLORS[appearance.preset][appearance.mode][
    appearance.effective.accent
  ];
}

export function resolveAccentForeground(
  appearance: AppearanceResolution,
): string {
  return (
    chooseAccessibleForeground(accentColorFor(appearance)) ??
    DEFAULT_DARK_FOREGROUND
  );
}

const DANGER_COLORS: Record<PresetId, Record<"dark" | "light", string>> = {
  default: { dark: "#ef4444", light: "#dc2626" },
  crateRed: { dark: "#ff453a", light: "#d70015" },
};

function dangerColorFor(appearance: AppearanceResolution): string {
  return DANGER_COLORS[appearance.preset][appearance.mode];
}

export function resolveDangerForeground(
  appearance: AppearanceResolution,
): string {
  return (
    chooseAccessibleForeground(dangerColorFor(appearance)) ??
    DEFAULT_DARK_FOREGROUND
  );
}

export function validateAppearanceContrast(
  appearance: AppearanceResolution,
): AppearanceContrastReport {
  const palette = SURFACE_COLORS[appearance.preset][appearance.mode];
  const appSurface = palette["--crate-token-surface-app"]!;
  const solidSurface = palette["--crate-token-surface-card-solid"]!;
  const glassSurface =
    appearance.mode === "dark"
      ? "rgba(18, 18, 26, 0.78)"
      : "rgba(255, 255, 255, 0.84)";
  const surface =
    appearance.effective.material === "glass" ? glassSurface : solidSurface;
  const foreground = palette["--crate-token-color-foreground"]!;
  const accent = accentColorFor(appearance);
  const checks = [
    {
      token: "text-on-surface",
      ratio: contrastRatioComposited(foreground, surface, appSurface),
      minimum: 4.5,
    },
    {
      token: "accent-control",
      ratio: contrastRatioComposited(
        resolveAccentForeground(appearance),
        accent,
      ),
      minimum: 4.5,
    },
    {
      token: "focus-ring",
      ratio: contrastRatioComposited(accent, appSurface),
      minimum: 3,
    },
    {
      token: "danger-control",
      ratio: contrastRatioComposited(
        resolveDangerForeground(appearance),
        dangerColorFor(appearance),
      ),
      minimum: 4.5,
    },
  ];
  const issues = checks.filter(
    ({ ratio, minimum }) => ratio === null || ratio < minimum,
  );

  return { valid: issues.length === 0, issues };
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
      "--crate-token-surface-card-glass": "rgba(18, 18, 26, 0.78)",
      "--crate-token-surface-card-foreground-glass": "#f1f5f9",
      "--crate-token-surface-secondary-glass": "rgba(28, 28, 40, 0.88)",
      "--crate-token-surface-secondary-foreground-glass": "#f1f5f9",
      "--crate-token-surface-muted-glass": "rgba(22, 22, 30, 0.72)",
      "--crate-token-surface-accent-glass": "rgba(255, 255, 255, 0.06)",
      "--crate-token-surface-accent-foreground-glass": "#f1f5f9",
      "--crate-token-surface-popover-glass": "rgba(18, 18, 26, 0.95)",
      "--crate-token-surface-popover-foreground-glass": "#f1f5f9",
      "--crate-token-surface-border-glass": "rgba(255, 255, 255, 0.08)",
      "--crate-token-surface-input-glass": "rgba(20, 20, 25, 0.72)",
      "--crate-token-surface-panel-glass": "#0c0c14",
      "--crate-token-surface-raised-glass": "rgba(18, 18, 26, 0.92)",
      "--crate-token-surface-modal-glass": "rgba(16, 16, 24, 0.95)",
      "--crate-token-surface-overlay-glass": "rgba(18, 18, 26, 0.95)",
      "--crate-token-surface-secondary-solid": "#1c1c28",
      "--crate-token-surface-secondary-foreground-solid": "#f1f5f9",
      "--crate-token-surface-muted-solid": "#16161e",
      "--crate-token-surface-accent-solid": "#1c1c28",
      "--crate-token-surface-accent-foreground-solid": "#f1f5f9",
      "--crate-token-surface-popover-solid": "#16161e",
      "--crate-token-surface-popover-foreground-solid": "#f1f5f9",
      "--crate-token-surface-border-solid": "#252535",
      "--crate-token-surface-input-solid": "#141419",
      "--crate-token-surface-overlay-solid": "rgba(18, 18, 26, 0.95)",
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
      "--crate-token-surface-card-glass": "rgba(255, 255, 255, 0.78)",
      "--crate-token-surface-card-foreground-glass": "#0f172a",
      "--crate-token-surface-secondary-glass": "rgba(241, 245, 249, 0.88)",
      "--crate-token-surface-secondary-foreground-glass": "#0f172a",
      "--crate-token-surface-muted-glass": "rgba(241, 245, 249, 0.72)",
      "--crate-token-surface-accent-glass": "rgba(15, 23, 42, 0.06)",
      "--crate-token-surface-accent-foreground-glass": "#0f172a",
      "--crate-token-surface-popover-glass": "rgba(255, 255, 255, 0.95)",
      "--crate-token-surface-popover-foreground-glass": "#0f172a",
      "--crate-token-surface-border-glass": "rgba(15, 23, 42, 0.08)",
      "--crate-token-surface-input-glass": "rgba(226, 232, 240, 0.72)",
      "--crate-token-surface-panel-glass": "#ffffff",
      "--crate-token-surface-raised-glass": "rgba(241, 245, 249, 0.92)",
      "--crate-token-surface-modal-glass": "rgba(255, 255, 255, 0.96)",
      "--crate-token-surface-overlay-glass": "rgba(255, 255, 255, 0.98)",
      "--crate-token-surface-secondary-solid": "#f1f5f9",
      "--crate-token-surface-secondary-foreground-solid": "#0f172a",
      "--crate-token-surface-muted-solid": "#f1f5f9",
      "--crate-token-surface-accent-solid": "#e2e8f0",
      "--crate-token-surface-accent-foreground-solid": "#0f172a",
      "--crate-token-surface-popover-solid": "#ffffff",
      "--crate-token-surface-popover-foreground-solid": "#0f172a",
      "--crate-token-surface-border-solid": "#cbd5e1",
      "--crate-token-surface-input-solid": "#e2e8f0",
      "--crate-token-surface-overlay-solid": "rgba(255, 255, 255, 0.98)",
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
      "--crate-token-surface-card-glass": "rgba(36, 36, 38, 0.78)",
      "--crate-token-surface-card-foreground-glass": "#f5f5f7",
      "--crate-token-surface-secondary-glass": "rgba(44, 44, 46, 0.88)",
      "--crate-token-surface-secondary-foreground-glass": "#f5f5f7",
      "--crate-token-surface-muted-glass": "rgba(36, 36, 38, 0.72)",
      "--crate-token-surface-accent-glass": "rgba(255, 255, 255, 0.06)",
      "--crate-token-surface-accent-foreground-glass": "#f5f5f7",
      "--crate-token-surface-popover-glass": "rgba(44, 44, 46, 0.95)",
      "--crate-token-surface-popover-foreground-glass": "#f5f5f7",
      "--crate-token-surface-border-glass": "rgba(255, 255, 255, 0.08)",
      "--crate-token-surface-input-glass": "rgba(44, 44, 46, 0.72)",
      "--crate-token-surface-panel-glass": "#232326",
      "--crate-token-surface-raised-glass": "rgba(44, 44, 46, 0.92)",
      "--crate-token-surface-modal-glass": "rgba(44, 44, 46, 0.96)",
      "--crate-token-surface-overlay-glass": "rgba(44, 44, 46, 0.98)",
      "--crate-token-surface-secondary-solid": "#2c2c2e",
      "--crate-token-surface-secondary-foreground-solid": "#f5f5f7",
      "--crate-token-surface-muted-solid": "#242426",
      "--crate-token-surface-accent-solid": "#2c2c2e",
      "--crate-token-surface-accent-foreground-solid": "#f5f5f7",
      "--crate-token-surface-popover-solid": "#242426",
      "--crate-token-surface-popover-foreground-solid": "#f5f5f7",
      "--crate-token-surface-border-solid": "#3a3a3c",
      "--crate-token-surface-input-solid": "#2c2c2e",
      "--crate-token-surface-overlay-solid": "rgba(44, 44, 46, 0.98)",
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
      "--crate-token-surface-card-glass": "rgba(255, 255, 255, 0.78)",
      "--crate-token-surface-card-foreground-glass": "#1d1d1f",
      "--crate-token-surface-secondary-glass": "rgba(242, 242, 247, 0.88)",
      "--crate-token-surface-secondary-foreground-glass": "#1d1d1f",
      "--crate-token-surface-muted-glass": "rgba(242, 242, 247, 0.72)",
      "--crate-token-surface-accent-glass": "rgba(29, 29, 31, 0.06)",
      "--crate-token-surface-accent-foreground-glass": "#1d1d1f",
      "--crate-token-surface-popover-glass": "rgba(255, 255, 255, 0.95)",
      "--crate-token-surface-popover-foreground-glass": "#1d1d1f",
      "--crate-token-surface-border-glass": "rgba(29, 29, 31, 0.08)",
      "--crate-token-surface-input-glass": "rgba(229, 229, 234, 0.72)",
      "--crate-token-surface-panel-glass": "#ffffff",
      "--crate-token-surface-raised-glass": "rgba(242, 242, 247, 0.92)",
      "--crate-token-surface-modal-glass": "rgba(255, 255, 255, 0.96)",
      "--crate-token-surface-overlay-glass": "rgba(255, 255, 255, 0.98)",
      "--crate-token-surface-secondary-solid": "#f2f2f7",
      "--crate-token-surface-secondary-foreground-solid": "#1d1d1f",
      "--crate-token-surface-muted-solid": "#f2f2f7",
      "--crate-token-surface-accent-solid": "#e5e5ea",
      "--crate-token-surface-accent-foreground-solid": "#1d1d1f",
      "--crate-token-surface-popover-solid": "#ffffff",
      "--crate-token-surface-popover-foreground-solid": "#1d1d1f",
      "--crate-token-surface-border-solid": "#d1d1d6",
      "--crate-token-surface-input-solid": "#e5e5ea",
      "--crate-token-surface-overlay-solid": "rgba(255, 255, 255, 0.98)",
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
  const accent = accentColorFor(appearance);
  const accentForeground = resolveAccentForeground(appearance);
  const surfaceColors = SURFACE_COLORS[appearance.preset][appearance.mode];
  const materialSuffix =
    appearance.effective.material === "glass" ? "glass" : "solid";
  const surfaceValue = (name: string): string => surfaceColors[name]!;
  const radiusValues = RADIUS_VALUES[appearance.effective.radius];
  const secondaryText =
    appearance.mode === "dark"
      ? "rgba(255, 255, 255, 0.78)"
      : "rgba(15, 23, 42, 0.75)";

  return {
    ...surfaceColors,
    // Runtime bridge: @theme aliases are resolved at :root, so scoped
    // previews must receive the effective aliases on the scope itself.
    "--color-background": surfaceValue("--crate-token-color-background"),
    "--color-foreground": surfaceValue("--crate-token-color-foreground"),
    "--crate-token-color-primary": accent,
    "--crate-token-color-primary-foreground": accentForeground,
    "--crate-token-color-ring": accent,
    "--crate-token-color-destructive": dangerColorFor(appearance),
    "--crate-token-color-destructive-foreground":
      resolveDangerForeground(appearance),
    "--color-primary": accent,
    "--color-primary-foreground": accentForeground,
    "--color-muted-foreground": surfaceValue(
      "--crate-token-color-muted-foreground",
    ),
    "--color-destructive": dangerColorFor(appearance),
    "--color-success": appearance.mode === "dark" ? "#22c55e" : "#15803d",
    "--color-warning": appearance.mode === "dark" ? "#f59e0b" : "#b45309",
    "--color-info": appearance.mode === "dark" ? "#3b82f6" : "#2563eb",
    "--color-ring": accent,
    "--color-card": surfaceValue(
      `--crate-token-surface-card-${materialSuffix}`,
    ),
    "--color-card-foreground": surfaceValue(
      `--crate-token-surface-card-foreground-${materialSuffix}`,
    ),
    "--color-secondary": surfaceValue(
      `--crate-token-surface-secondary-${materialSuffix}`,
    ),
    "--color-secondary-foreground": surfaceValue(
      `--crate-token-surface-secondary-foreground-${materialSuffix}`,
    ),
    "--color-muted": surfaceValue(
      `--crate-token-surface-muted-${materialSuffix}`,
    ),
    "--color-accent": surfaceValue(
      `--crate-token-surface-accent-${materialSuffix}`,
    ),
    "--color-accent-foreground": surfaceValue(
      `--crate-token-surface-accent-foreground-${materialSuffix}`,
    ),
    "--color-popover": surfaceValue(
      `--crate-token-surface-popover-${materialSuffix}`,
    ),
    "--color-popover-foreground": surfaceValue(
      `--crate-token-surface-popover-foreground-${materialSuffix}`,
    ),
    "--color-border": surfaceValue(
      `--crate-token-surface-border-${materialSuffix}`,
    ),
    "--color-input": surfaceValue(
      `--crate-token-surface-input-${materialSuffix}`,
    ),
    "--surface-app": surfaceValue("--crate-token-surface-app"),
    "--surface-panel": surfaceValue(
      `--crate-token-surface-panel-${materialSuffix}`,
    ),
    "--surface-raised": surfaceValue(
      `--crate-token-surface-raised-${materialSuffix}`,
    ),
    "--surface-modal": surfaceValue(
      `--crate-token-surface-modal-${materialSuffix}`,
    ),
    "--surface-popover": surfaceValue(
      `--crate-token-surface-overlay-${materialSuffix}`,
    ),
    "--text-primary": surfaceValue("--crate-token-color-foreground"),
    "--text-secondary": secondaryText,
    "--text-muted": surfaceValue("--crate-token-color-muted-foreground"),
    "--accent-action": accent,
    "--accent-action-foreground": accentForeground,
    "--focus-ring": accent,
    "--state-danger": dangerColorFor(appearance),
    "--state-danger-foreground": resolveDangerForeground(appearance),
    "--state-success": appearance.mode === "dark" ? "#22c55e" : "#15803d",
    "--state-warning": appearance.mode === "dark" ? "#f59e0b" : "#b45309",
    "--state-info": appearance.mode === "dark" ? "#3b82f6" : "#2563eb",
    "--brand-logo-start": accent,
    "--brand-logo-end": accent,
    "--brand-logo-glow": `color-mix(in srgb, ${accent} 28%, transparent)`,
    ...radiusValues,
    "--radius-sm": radiusValues["--crate-token-radius-sm"]!,
    "--radius-md": radiusValues["--crate-token-radius-md"]!,
    "--radius-lg": radiusValues["--crate-token-radius-lg"]!,
    "--radius-xl": radiusValues["--crate-token-radius-xl"]!,
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
  "crateMotion",
  "crateDensity",
  "crateSurfaceTone",
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
  root.dataset.crateMotion = appearance.reducedMotion ? "reduced" : "system";
  root.dataset.crateDensity = appearance.density;
  root.dataset.crateSurfaceTone = appearance.effective.surfaceTone;
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
