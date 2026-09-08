import {
  applyAppearanceToRoot,
  createDefaultAppearancePreferences,
  inspectAppearancePreferences,
  readAppearancePreferences,
  resolveAppearance,
  writeAppearancePreferences,
} from "./appearance-resolver";
import type { AppearanceStorage } from "./appearance-types";

export const THEME_SKIN_STORAGE_KEY = "crate.listen.theme-skin";

export const MODE_REGISTRY = {
  dark: {
    id: "dark",
    colorScheme: "dark",
  },
  light: {
    id: "light",
    colorScheme: "light",
  },
  system: {
    id: "system",
    colorScheme: "dark light",
  },
} as const;

export const SKIN_VARIABLE_ALLOWLIST = [
  "--color-background",
  "--color-card",
  "--color-card-foreground",
  "--color-secondary",
  "--color-secondary-foreground",
  "--color-muted",
  "--color-accent",
  "--color-accent-foreground",
  "--color-popover",
  "--color-popover-foreground",
  "--color-border",
  "--color-input",
  "--color-primary",
  "--color-primary-foreground",
  "--color-foreground",
  "--color-muted-foreground",
  "--color-destructive",
  "--color-success",
  "--color-warning",
  "--color-info",
  "--color-ring",
  "--surface-app",
  "--surface-panel",
  "--surface-raised",
  "--surface-modal",
  "--surface-popover",
  "--scrollbar-thumb",
  "--scrollbar-hover",
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--text-subtle",
  "--text-faint",
  "--border-subtle",
  "--border-quiet",
  "--border-quiet-subtle",
  "--focus-ring",
  "--accent-action",
  "--accent-action-foreground",
  "--state-danger",
  "--state-danger-foreground",
  "--state-success",
  "--state-warning",
  "--state-info",
  "--idle-border",
  "--idle-bg",
  "--idle-text",
  "--idle-text-muted",
  "--idle-text-subtle",
  "--hover-border",
  "--hover-bg",
  "--hover-bg-strong",
  "--surface-glass-shadow",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--radius-xl",
  "--font-brand",
] as const;

type SkinVariableName = (typeof SKIN_VARIABLE_ALLOWLIST)[number];

type SkinVariables = Partial<Record<SkinVariableName, string>>;

interface SkinDefinition {
  id: string;
  modes: Record<ResolvedColorMode, SkinVariables>;
}

const DEFAULT_DARK_SKIN_VARIABLES: SkinVariables = {
  "--color-background": "#0a0a0f",
  "--color-card": "#16161e",
  "--color-card-foreground": "#f1f5f9",
  "--color-secondary": "#1c1c28",
  "--color-secondary-foreground": "#f1f5f9",
  "--color-muted": "#16161e",
  "--color-accent": "#1c1c28",
  "--color-accent-foreground": "#f1f5f9",
  "--color-popover": "#16161e",
  "--color-popover-foreground": "#f1f5f9",
  "--color-border": "#252535",
  "--color-input": "#141419",
  "--color-primary": "#06b6d4",
  "--color-primary-foreground": "#0a0a0f",
  "--color-foreground": "#f1f5f9",
  "--color-muted-foreground": "#94a3b8",
  "--color-destructive": "#ef4444",
  "--color-success": "#22c55e",
  "--color-warning": "#f59e0b",
  "--color-info": "#3b82f6",
  "--color-ring": "#06b6d4",
  "--surface-app": "#0a0a0f",
  "--surface-panel": "#0c0c14",
  "--surface-raised": "#12121a",
  "--surface-modal": "rgba(16, 16, 24, 0.95)",
  "--surface-popover": "rgba(18, 18, 26, 0.95)",
  "--scrollbar-thumb": "#252535",
  "--scrollbar-hover": "#353545",
  "--text-primary": "#f1f5f9",
  "--text-secondary": "#cbd5e1",
  "--text-muted": "#94a3b8",
  "--text-subtle": "#94a3b8",
  "--text-faint": "#475569",
  "--border-subtle": "#252535",
  "--border-quiet": "rgba(255, 255, 255, 0.1)",
  "--border-quiet-subtle": "rgba(255, 255, 255, 0.06)",
  "--focus-ring": "#06b6d4",
  "--accent-action": "#06b6d4",
  "--accent-action-foreground": "#0a0a0f",
  "--state-danger": "#ef4444",
  "--state-danger-foreground": "#f1f5f9",
  "--state-success": "#22c55e",
  "--state-warning": "#f59e0b",
  "--state-info": "#3b82f6",
  "--idle-border": "rgba(255, 255, 255, 0.06)",
  "--idle-bg": "rgba(255, 255, 255, 0.02)",
  "--idle-text": "rgba(255, 255, 255, 0.6)",
  "--idle-text-muted": "rgba(255, 255, 255, 0.45)",
  "--idle-text-subtle": "rgba(255, 255, 255, 0.35)",
  "--hover-border": "rgba(255, 255, 255, 0.2)",
  "--hover-bg": "rgba(255, 255, 255, 0.05)",
  "--hover-bg-strong": "rgba(255, 255, 255, 0.1)",
  "--surface-glass-shadow": "rgba(0, 0, 0, 0.48)",
  "--radius-sm": "0.125rem",
  "--radius-md": "0.25rem",
  "--radius-lg": "0.375rem",
  "--radius-xl": "0.5rem",
  "--font-brand": "Poppins",
};

const DEFAULT_LIGHT_SKIN_VARIABLES: SkinVariables = {
  ...DEFAULT_DARK_SKIN_VARIABLES,
  "--color-background": "#f8fafc",
  "--color-card": "#ffffff",
  "--color-card-foreground": "#0f172a",
  "--color-secondary": "#f1f5f9",
  "--color-secondary-foreground": "#0f172a",
  "--color-muted": "#f1f5f9",
  "--color-accent": "#e2e8f0",
  "--color-accent-foreground": "#0f172a",
  "--color-popover": "#ffffff",
  "--color-popover-foreground": "#0f172a",
  "--color-border": "#cbd5e1",
  "--color-input": "#e2e8f0",
  "--color-primary": "#0e7490",
  "--color-primary-foreground": "#ffffff",
  "--color-foreground": "#0f172a",
  "--color-muted-foreground": "#64748b",
  "--color-destructive": "#dc2626",
  "--color-success": "#15803d",
  "--color-warning": "#b45309",
  "--color-info": "#2563eb",
  "--color-ring": "#0e7490",
  "--surface-app": "#f8fafc",
  "--surface-panel": "#ffffff",
  "--surface-raised": "#f1f5f9",
  "--surface-modal": "rgba(255, 255, 255, 0.96)",
  "--surface-popover": "rgba(255, 255, 255, 0.98)",
  "--scrollbar-thumb": "#cbd5e1",
  "--scrollbar-hover": "#94a3b8",
  "--text-primary": "#0f172a",
  "--text-secondary": "#334155",
  "--text-muted": "#64748b",
  "--text-subtle": "#475569",
  "--text-faint": "#94a3b8",
  "--border-subtle": "#cbd5e1",
  "--border-quiet": "rgba(15, 23, 42, 0.12)",
  "--border-quiet-subtle": "rgba(15, 23, 42, 0.06)",
  "--focus-ring": "#0e7490",
  "--accent-action": "#0e7490",
  "--accent-action-foreground": "#ffffff",
  "--state-danger": "#dc2626",
  "--state-danger-foreground": "#ffffff",
  "--state-success": "#15803d",
  "--state-warning": "#b45309",
  "--state-info": "#2563eb",
  "--idle-border": "rgba(15, 23, 42, 0.12)",
  "--idle-bg": "rgba(15, 23, 42, 0.03)",
  "--idle-text": "rgba(15, 23, 42, 0.7)",
  "--idle-text-muted": "rgba(15, 23, 42, 0.55)",
  "--idle-text-subtle": "rgba(15, 23, 42, 0.45)",
  "--hover-border": "rgba(15, 23, 42, 0.2)",
  "--hover-bg": "rgba(15, 23, 42, 0.05)",
  "--hover-bg-strong": "rgba(15, 23, 42, 0.1)",
  "--surface-glass-shadow": "rgba(15, 23, 42, 0.18)",
};

const CRATE_RED_DARK_SKIN_VARIABLES: SkinVariables = {
  ...DEFAULT_DARK_SKIN_VARIABLES,
  "--color-background": "#1c1c1e",
  "--color-card": "#242426",
  "--color-card-foreground": "#f5f5f7",
  "--color-secondary": "#2c2c2e",
  "--color-secondary-foreground": "#f5f5f7",
  "--color-muted": "#242426",
  "--color-accent": "#2c2c2e",
  "--color-accent-foreground": "#f5f5f7",
  "--color-popover": "#242426",
  "--color-popover-foreground": "#f5f5f7",
  "--color-border": "#3a3a3c",
  "--color-input": "#2c2c2e",
  "--color-primary": "#ff375f",
  "--color-primary-foreground": "#1c1c1e",
  "--color-foreground": "#f5f5f7",
  "--color-muted-foreground": "#a1a1aa",
  "--color-ring": "#ff375f",
  "--surface-app": "#1c1c1e",
  "--surface-panel": "#232326",
  "--surface-raised": "#2c2c2e",
  "--surface-modal": "rgba(44, 44, 46, 0.96)",
  "--surface-popover": "rgba(44, 44, 46, 0.98)",
  "--scrollbar-thumb": "#48484a",
  "--scrollbar-hover": "#636366",
  "--text-primary": "#f5f5f7",
  "--text-secondary": "#d1d1d6",
  "--text-muted": "#a1a1aa",
  "--text-subtle": "#8e8e93",
  "--text-faint": "#636366",
  "--border-subtle": "#3a3a3c",
  "--border-quiet": "rgba(255, 255, 255, 0.12)",
  "--border-quiet-subtle": "rgba(255, 255, 255, 0.07)",
  "--focus-ring": "#ff375f",
  "--accent-action": "#ff375f",
  "--accent-action-foreground": "#1c1c1e",
  "--surface-glass-shadow": "rgba(0, 0, 0, 0.42)",
  "--radius-sm": "0.25rem",
  "--radius-md": "0.5rem",
  "--radius-lg": "0.75rem",
  "--radius-xl": "1rem",
  "--font-brand":
    '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
};

const CRATE_RED_LIGHT_SKIN_VARIABLES: SkinVariables = {
  ...DEFAULT_LIGHT_SKIN_VARIABLES,
  "--color-background": "#f5f5f7",
  "--color-card": "#ffffff",
  "--color-card-foreground": "#1d1d1f",
  "--color-secondary": "#f2f2f7",
  "--color-secondary-foreground": "#1d1d1f",
  "--color-muted": "#f2f2f7",
  "--color-accent": "#e5e5ea",
  "--color-accent-foreground": "#1d1d1f",
  "--color-popover": "#ffffff",
  "--color-popover-foreground": "#1d1d1f",
  "--color-border": "#d1d1d6",
  "--color-input": "#e5e5ea",
  "--color-primary": "#d61f45",
  "--color-primary-foreground": "#ffffff",
  "--color-foreground": "#1d1d1f",
  "--color-muted-foreground": "#6e6e73",
  "--color-ring": "#d61f45",
  "--surface-app": "#f5f5f7",
  "--surface-panel": "#ffffff",
  "--surface-raised": "#f2f2f7",
  "--surface-modal": "rgba(255, 255, 255, 0.96)",
  "--surface-popover": "rgba(255, 255, 255, 0.98)",
  "--scrollbar-thumb": "#d1d1d6",
  "--scrollbar-hover": "#aeaeb2",
  "--text-primary": "#1d1d1f",
  "--text-secondary": "#3a3a3c",
  "--text-muted": "#6e6e73",
  "--text-subtle": "#636366",
  "--text-faint": "#aeaeb2",
  "--border-subtle": "#d1d1d6",
  "--border-quiet": "rgba(29, 29, 31, 0.12)",
  "--border-quiet-subtle": "rgba(29, 29, 31, 0.07)",
  "--focus-ring": "#d61f45",
  "--accent-action": "#d61f45",
  "--accent-action-foreground": "#ffffff",
  "--surface-glass-shadow": "rgba(29, 29, 31, 0.16)",
};

export const SKIN_REGISTRY = {
  default: {
    id: "default",
    modes: {
      dark: DEFAULT_DARK_SKIN_VARIABLES,
      light: DEFAULT_LIGHT_SKIN_VARIABLES,
    },
  },
  crateRed: {
    id: "crateRed",
    modes: {
      dark: CRATE_RED_DARK_SKIN_VARIABLES,
      light: CRATE_RED_LIGHT_SKIN_VARIABLES,
    },
  },
} as const satisfies Record<string, SkinDefinition>;

export type ColorModePreference = keyof typeof MODE_REGISTRY;
export type ResolvedColorMode = Exclude<ColorModePreference, "system">;
export type SkinId = keyof typeof SKIN_REGISTRY;

export interface ThemeSkinSelection {
  mode: ColorModePreference;
  skin: SkinId;
}

export interface AppliedThemeSkinSelection extends ThemeSkinSelection {
  resolvedMode: ResolvedColorMode;
}

export const DEFAULT_THEME_SKIN = {
  mode: "dark",
  skin: "default",
} as const satisfies ThemeSkinSelection;

const THEME_SKIN_CHANGE_EVENT = "crate:theme-skin-change";
let currentThemeSkin: AppliedThemeSkinSelection = {
  ...DEFAULT_THEME_SKIN,
  resolvedMode: "dark",
};

export function getAppliedThemeSkin(): AppliedThemeSkinSelection {
  return currentThemeSkin;
}

export function subscribeThemeSkin(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  window.addEventListener(THEME_SKIN_CHANGE_EVENT, listener);
  return () => window.removeEventListener(THEME_SKIN_CHANGE_EVENT, listener);
}

function publishThemeSkin(selection: AppliedThemeSkinSelection): void {
  currentThemeSkin = selection;

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(THEME_SKIN_CHANGE_EVENT));
  }
}

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;
type MatchMedia = (query: string) => MediaQueryList;

interface ThemeSkinOptions {
  root?: HTMLElement;
  storage?: StorageReader & Partial<StorageWriter>;
  matchMedia?: MatchMedia;
}

function getBrowserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function getBrowserMatchMedia(): MatchMedia | undefined {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return undefined;
  }

  return window.matchMedia.bind(window);
}

function isColorModePreference(value: unknown): value is ColorModePreference {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(MODE_REGISTRY, value)
  );
}

function isSkinId(value: unknown): value is SkinId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SKIN_REGISTRY, value)
  );
}

export function resolveColorMode(
  mode: ColorModePreference,
  systemPrefersDark: boolean,
): ResolvedColorMode {
  if (mode === "system") return systemPrefersDark ? "dark" : "light";
  return mode;
}

export function resolveThemeSkin(
  mode: unknown,
  skin: unknown,
): ThemeSkinSelection {
  const resolvedMode = isColorModePreference(mode)
    ? mode
    : DEFAULT_THEME_SKIN.mode;
  const resolvedSkin = isSkinId(skin) ? skin : DEFAULT_THEME_SKIN.skin;

  if (
    resolvedMode === "system" ||
    Object.prototype.hasOwnProperty.call(SKIN_REGISTRY, resolvedSkin)
  ) {
    return { mode: resolvedMode, skin: resolvedSkin };
  }

  return { mode: resolvedMode, skin: DEFAULT_THEME_SKIN.skin };
}

function migrateStoredSelection(candidate: {
  mode?: unknown;
  skin?: unknown;
  theme?: unknown;
}): ThemeSkinSelection {
  if ("mode" in candidate) {
    return resolveThemeSkin(candidate.mode, candidate.skin);
  }

  if (candidate.theme === "dark" || candidate.theme === "light") {
    const migratedSkin =
      candidate.skin === "aurora" ? "crateRed" : candidate.skin;
    return resolveThemeSkin(candidate.theme, migratedSkin);
  }

  return DEFAULT_THEME_SKIN;
}

export function readStoredThemeSkin(
  storage: StorageReader | undefined = getBrowserStorage(),
): ThemeSkinSelection {
  if (!storage) return DEFAULT_THEME_SKIN;

  try {
    const inspected = inspectAppearancePreferences(storage);
    if (inspected.status !== "corrupt") {
      return {
        mode: inspected.preferences.mode,
        skin: inspected.preferences.preset,
      };
    }

    // Keep the legacy reader tolerant for callers that passed a storage
    // adapter returning the old payload regardless of the requested key.
    const legacyCandidate = inspected.raw
      ? JSON.parse(inspected.raw)
      : undefined;
    if (legacyCandidate && typeof legacyCandidate === "object") {
      return migrateStoredSelection(
        legacyCandidate as {
          mode?: unknown;
          skin?: unknown;
          theme?: unknown;
        },
      );
    }

    return DEFAULT_THEME_SKIN;
  } catch {
    return DEFAULT_THEME_SKIN;
  }
}

const systemListenerCleanup = new WeakMap<HTMLElement, () => void>();
const runtimeAppearanceCleanup = new WeakMap<HTMLElement, () => void>();

function clearSystemListener(root: HTMLElement): void {
  systemListenerCleanup.get(root)?.();
  systemListenerCleanup.delete(root);
}

function clearRuntimeAppearance(root: HTMLElement): void {
  runtimeAppearanceCleanup.get(root)?.();
  runtimeAppearanceCleanup.delete(root);
}

function clearAppliedVariables(root: HTMLElement): void {
  const appliedVariables = root.dataset.crateThemeSkinVars
    ?.split(",")
    .filter(Boolean);

  appliedVariables?.forEach((name) => root.style.removeProperty(name));
  delete root.dataset.crateThemeSkinVars;
}

function applySkinVariables(
  root: HTMLElement,
  skin: SkinId,
  mode: ResolvedColorMode,
): void {
  clearAppliedVariables(root);

  const appliedVariables: string[] = [];
  const variables = SKIN_REGISTRY[skin].modes[mode];

  Object.entries(variables).forEach(([name, value]) => {
    if (
      !value ||
      !SKIN_VARIABLE_ALLOWLIST.some((allowed) => allowed === name)
    ) {
      return;
    }

    root.style.setProperty(name, value);
    appliedVariables.push(name);
  });

  if (appliedVariables.length > 0) {
    root.dataset.crateThemeSkinVars = appliedVariables.join(",");
  }
}

function applyRuntimeAppearance(
  root: HTMLElement,
  selection: ThemeSkinSelection,
  resolvedMode: ResolvedColorMode,
  prefersReducedMotion: boolean,
  storage: ThemeSkinOptions["storage"],
): void {
  clearRuntimeAppearance(root);

  const storedPreferences = storage?.getItem
    ? readAppearancePreferences(storage)
    : createDefaultAppearancePreferences();
  const appearance = resolveAppearance(
    {
      ...storedPreferences,
      mode: selection.mode,
      preset: selection.skin,
    },
    {
      prefersColorSchemeDark: resolvedMode === "dark",
      prefersReducedMotion,
    },
  );

  runtimeAppearanceCleanup.set(root, applyAppearanceToRoot(root, appearance));
}

export function applyThemeSkin(
  mode: unknown,
  skin: unknown,
  options: ThemeSkinOptions = {},
): AppliedThemeSkinSelection {
  const selection = resolveThemeSkin(mode, skin);
  const root =
    options.root ??
    (typeof document === "undefined" ? undefined : document.documentElement);
  const matchMedia = options.matchMedia ?? getBrowserMatchMedia();
  const mediaQuery = matchMedia?.("(prefers-color-scheme: dark)");
  const reducedMotionQuery = matchMedia?.("(prefers-reduced-motion: reduce)");
  const storage = options.storage ?? getBrowserStorage();
  const resolvedMode = resolveColorMode(
    selection.mode,
    mediaQuery?.matches ?? true,
  );

  if (root) {
    clearSystemListener(root);
    clearRuntimeAppearance(root);
    root.dataset.crateApp = "listen";
    root.dataset.crateMode = resolvedMode;
    root.dataset.crateModePreference = selection.mode;
    root.dataset.crateSkin = selection.skin;
    root.style.colorScheme = MODE_REGISTRY[resolvedMode].colorScheme;
    applySkinVariables(root, selection.skin, resolvedMode);
    applyRuntimeAppearance(
      root,
      selection,
      resolvedMode,
      reducedMotionQuery?.matches ?? false,
      storage,
    );

    if (selection.mode === "system" && mediaQuery) {
      const onChange = (event: MediaQueryListEvent) => {
        const nextMode = event.matches ? "dark" : "light";
        root.dataset.crateMode = nextMode;
        root.style.colorScheme = MODE_REGISTRY[nextMode].colorScheme;
        applySkinVariables(root, selection.skin, nextMode);
        applyRuntimeAppearance(
          root,
          selection,
          nextMode,
          reducedMotionQuery?.matches ?? false,
          storage,
        );
        publishThemeSkin({
          ...selection,
          resolvedMode: nextMode,
        });
      };

      mediaQuery.addEventListener("change", onChange);
      systemListenerCleanup.set(root, () =>
        mediaQuery.removeEventListener("change", onChange),
      );
    }
  }

  if (storage?.getItem && storage.setItem) {
    const preferences = readAppearancePreferences(storage);
    writeAppearancePreferences(storage as AppearanceStorage, {
      ...preferences,
      mode: selection.mode,
      preset: selection.skin,
    });
  } else {
    try {
      storage?.setItem?.(
        THEME_SKIN_STORAGE_KEY,
        JSON.stringify({ mode: selection.mode, skin: selection.skin }),
      );
    } catch {
      // Persistence is best effort; the active selection still applies.
    }
  }

  const appliedSelection = { ...selection, resolvedMode };
  publishThemeSkin(appliedSelection);
  return appliedSelection;
}

export function initializeThemeSkin(
  options: ThemeSkinOptions = {},
): AppliedThemeSkinSelection {
  const stored = readStoredThemeSkin(options.storage);
  return applyThemeSkin(stored.mode, stored.skin, options);
}
