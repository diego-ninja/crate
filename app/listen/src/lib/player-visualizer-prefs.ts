const USE_ALBUM_PALETTE_KEY = "listen-viz-use-album-palette";
const VISUALIZER_MODE_KEY = "listen-viz-mode";
export const PLAYER_VIZ_PREFS_EVENT = "listen:viz-prefs-changed";
export type VisualizerMode = "spheres" | "halo" | "tunnel";

const DEFAULT_VISUALIZER_MODE: VisualizerMode = "spheres";

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

export function getVisualizerModePreference(): VisualizerMode {
  try {
    const raw = localStorage.getItem(VISUALIZER_MODE_KEY);
    if (raw === "halo" || raw === "spheres") {
      return raw;
    }
    if (raw === "tunnel") {
      localStorage.setItem(VISUALIZER_MODE_KEY, DEFAULT_VISUALIZER_MODE);
    }
  } catch {
    // ignore storage failures
  }
  return DEFAULT_VISUALIZER_MODE;
}

export function setVisualizerModePreference(mode: VisualizerMode) {
  try {
    localStorage.setItem(VISUALIZER_MODE_KEY, mode);
  } catch {
    // ignore storage failures
  }
  window.dispatchEvent(
    new CustomEvent(PLAYER_VIZ_PREFS_EVENT, {
      detail: { visualizerMode: mode },
    }),
  );
}
