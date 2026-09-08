export const APPEARANCE_STORAGE_KEY = "crate.listen.appearance.v2";
export const LEGACY_THEME_SKIN_STORAGE_KEY = "crate.listen.theme-skin";
export const APPEARANCE_LEGACY_BACKUP_STORAGE_KEY =
  "crate.listen.theme-skin.backup.v1";
export const APPEARANCE_CORRUPT_BACKUP_STORAGE_KEY =
  "crate.listen.appearance.corrupt-backup";

export type ColorModePreference = "dark" | "light" | "system";
export type ResolvedColorMode = "dark" | "light";
export type PresetId = "default" | "crateRed";
export type AccentId = "cyan" | "red" | "violet";
export type ContentDensity = "comfortable" | "compact";
export type SurfaceTone = "neutral" | "warm" | "tinted";
export type Material = "solid" | "glass";
export type Radius = "subtle" | "rounded";
export type Typography = "brand" | "system";
export type Effects = "off" | "subtle" | "expressive";
export type MotionPreference = "system" | "reduced";

export interface AppearanceOverrides {
  accent?: AccentId;
  surfaceTone?: SurfaceTone;
  material?: Material;
  radius?: Radius;
  typography?: Typography;
  effects?: Effects;
}

export interface AppearancePreferencesV2 {
  version: 2;
  mode: ColorModePreference;
  preset: PresetId;
  overrides: AppearanceOverrides;
  presentation: {
    density: ContentDensity;
  };
  accessibility: {
    motion: MotionPreference;
  };
}

export interface AppearanceEnvironment {
  prefersColorSchemeDark: boolean;
  prefersReducedMotion: boolean;
}

export interface AppearanceEffectiveValues {
  accent: AccentId;
  surfaceTone: SurfaceTone;
  material: Material;
  radius: Radius;
  typography: Typography;
  effects: Effects;
}

export interface AppearanceResolution {
  mode: ResolvedColorMode;
  preset: PresetId;
  preferences: AppearancePreferencesV2;
  effective: AppearanceEffectiveValues;
  density: ContentDensity;
  motion: MotionPreference;
  reducedMotion: boolean;
}

export type AppearanceReadStatus =
  | "default"
  | "legacy"
  | "valid"
  | "corrupt"
  | "future-version";

export interface AppearanceReadResult {
  preferences: AppearancePreferencesV2;
  status: AppearanceReadStatus;
  raw?: string;
}

export type AppearanceWriteStatus =
  | "saved"
  | "legacy-projection-failed"
  | "backup-failed"
  | "primary-failed"
  | "future-version";

export interface AppearanceWriteResult {
  status: AppearanceWriteStatus;
  v2Saved: boolean;
  legacyProjected: boolean;
  backupSaved: boolean;
}

export type StorageReader = Pick<Storage, "getItem">;
export type StorageWriter = Pick<Storage, "setItem">;
export type AppearanceStorage = StorageReader & StorageWriter;

export const DEFAULT_APPEARANCE_PREFERENCES = {
  version: 2,
  mode: "dark",
  preset: "default",
  overrides: {},
  presentation: { density: "comfortable" },
  accessibility: { motion: "system" },
} as const satisfies AppearancePreferencesV2;

export function createDefaultAppearancePreferences(): AppearancePreferencesV2 {
  return {
    version: 2,
    mode: DEFAULT_APPEARANCE_PREFERENCES.mode,
    preset: DEFAULT_APPEARANCE_PREFERENCES.preset,
    overrides: {},
    presentation: {
      density: DEFAULT_APPEARANCE_PREFERENCES.presentation.density,
    },
    accessibility: {
      motion: DEFAULT_APPEARANCE_PREFERENCES.accessibility.motion,
    },
  };
}
