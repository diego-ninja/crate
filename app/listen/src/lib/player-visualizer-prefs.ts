const USE_ALBUM_PALETTE_KEY = "listen-viz-use-album-palette";
const VISUALIZER_ENABLED_KEY = "listen-viz-enabled";
const VISUALIZER_SETTINGS_KEY = "listen-viz-settings";
export const PLAYER_VIZ_PREFS_EVENT = "listen:viz-prefs-changed";
export type VisualizerMode = "spheres" | "halo" | "tunnel";

export interface VisualizerSettingsPreference {
  separation: number;
  glow: number;
  scale: number;
  persistence: number;
  octaves: number;
}

export const DEFAULT_VISUALIZER_SETTINGS: VisualizerSettingsPreference = {
  separation: 0.15,
  glow: 6.0,
  scale: 1.4,
  persistence: 0.8,
  octaves: 2,
};

export function getUseAlbumPalettePreference(): boolean {
  try {
    return localStorage.getItem(USE_ALBUM_PALETTE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setUseAlbumPalettePreference(value: boolean) {
  try {
    localStorage.setItem(USE_ALBUM_PALETTE_KEY, String(value));
  } catch {
    // ignore storage failures
  }
  window.dispatchEvent(
    new CustomEvent(PLAYER_VIZ_PREFS_EVENT, {
      detail: { useAlbumPalette: value },
    }),
  );
}

export function getVisualizerEnabledPreference(): boolean {
  try {
    const raw = localStorage.getItem(VISUALIZER_ENABLED_KEY);
    return raw == null ? true : raw === "true";
  } catch {
    return true;
  }
}

export function setVisualizerEnabledPreference(value: boolean) {
  try {
    localStorage.setItem(VISUALIZER_ENABLED_KEY, String(value));
  } catch {
    // ignore storage failures
  }
  window.dispatchEvent(
    new CustomEvent(PLAYER_VIZ_PREFS_EVENT, {
      detail: { visualizerEnabled: value },
    }),
  );
}

export function getVisualizerSettingsPreference(): VisualizerSettingsPreference {
  try {
    const raw = localStorage.getItem(VISUALIZER_SETTINGS_KEY);
    if (!raw) return DEFAULT_VISUALIZER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<VisualizerSettingsPreference>;
    return {
      separation: typeof parsed.separation === "number" ? parsed.separation : DEFAULT_VISUALIZER_SETTINGS.separation,
      glow: typeof parsed.glow === "number" ? parsed.glow : DEFAULT_VISUALIZER_SETTINGS.glow,
      scale: typeof parsed.scale === "number" ? parsed.scale : DEFAULT_VISUALIZER_SETTINGS.scale,
      persistence: typeof parsed.persistence === "number" ? parsed.persistence : DEFAULT_VISUALIZER_SETTINGS.persistence,
      octaves: typeof parsed.octaves === "number" ? parsed.octaves : DEFAULT_VISUALIZER_SETTINGS.octaves,
    };
  } catch {
    return DEFAULT_VISUALIZER_SETTINGS;
  }
}

export function setVisualizerSettingsPreference(value: VisualizerSettingsPreference) {
  try {
    localStorage.setItem(VISUALIZER_SETTINGS_KEY, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
  window.dispatchEvent(
    new CustomEvent(PLAYER_VIZ_PREFS_EVENT, {
      detail: { visualizerSettings: value },
    }),
  );
}

export function getLegacyVisualizerModePreference(): VisualizerMode {
  try {
    const raw = localStorage.getItem("listen-viz-mode");
    if (raw === "halo" || raw === "spheres" || raw === "tunnel") {
      return raw;
    }
  } catch {
    // ignore storage failures
  }
  return "spheres";
}
