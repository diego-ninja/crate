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
