import { EQ_BAND_COUNT, EQ_PRESETS, type EqGains, type EqPresetName } from "@/lib/equalizer";

export const EQ_PREFS_EVENT = "listen-equalizer-prefs";

const ENABLED_KEY = "listen-eq-enabled";
const PRESET_KEY = "listen-eq-preset"; // "custom" or one of EQ_PRESETS keys
const GAINS_KEY = "listen-eq-gains";   // JSON array of numbers
const ADAPTIVE_KEY = "listen-eq-adaptive";
const GENRE_ADAPTIVE_KEY = "listen-eq-genre-adaptive";

export interface EqualizerSnapshot {
  enabled: boolean;
  preset: EqPresetName | "custom";
  gains: number[];
  /**
   * When true, the EQ ignores `gains`/`preset` and derives bands from
   * per-track analysis features. Incompatible with manual preset/custom
   * edits — selecting one of those turns adaptive off.
   */
  adaptive: boolean;
  /**
   * When true, the EQ picks a preset based on the track's primary
   * genre (canonical slug → preset map, with top-level family
   * fallback). Mutually exclusive with `adaptive`: toggling one turns
   * the other off.
   */
  genreAdaptive: boolean;
}

export function getEqualizerEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function setEqualizerEnabled(value: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, value ? "true" : "false");
    dispatchPrefsEvent();
  } catch { /* ignore */ }
}

export function getEqualizerPreset(): EqPresetName | "custom" {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (!raw) return "flat";
    if (raw === "custom") return "custom";
    if (raw in EQ_PRESETS) return raw as EqPresetName;
    return "flat";
  } catch {
    return "flat";
  }
}

export function getEqualizerGains(): number[] {
  try {
    const raw = localStorage.getItem(GAINS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === EQ_BAND_COUNT) {
        return parsed.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0));
      }
    }
  } catch { /* ignore */ }
  // Default: whatever the persisted preset says, or flat.
  const preset = getEqualizerPreset();
  if (preset === "custom") return new Array(EQ_BAND_COUNT).fill(0);
  return [...EQ_PRESETS[preset]!];
}

/**
 * Apply a preset: stores both the preset name and the resolved gains so
 * that subsequent reads are consistent even if EQ_PRESETS definitions
 * later change.
 */
export function applyEqualizerPreset(preset: EqPresetName): EqGains {
  const gains = EQ_PRESETS[preset];
  if (!gains) return [];
  try {
    localStorage.setItem(PRESET_KEY, preset);
    localStorage.setItem(GAINS_KEY, JSON.stringify(gains));
    dispatchPrefsEvent();
  } catch { /* ignore */ }
  return gains;
}

/**
 * Persist a fully custom gain set. The preset label becomes "custom"
 * so the UI can show the picker as un-selected.
 */
export function setCustomEqualizerGains(gains: EqGains): void {
  try {
    localStorage.setItem(PRESET_KEY, "custom");
    localStorage.setItem(GAINS_KEY, JSON.stringify(gains));
    dispatchPrefsEvent();
  } catch { /* ignore */ }
}

export function getEqualizerAdaptive(): boolean {
  try {
    return localStorage.getItem(ADAPTIVE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setEqualizerAdaptive(value: boolean): void {
  try {
    localStorage.setItem(ADAPTIVE_KEY, value ? "true" : "false");
    // Genre-adaptive and feature-adaptive are rivals — turning one on
    // must turn the other off. We do it here rather than leaving it to
    // callers so the persisted state can never end up with both flags.
    if (value) {
      localStorage.setItem(GENRE_ADAPTIVE_KEY, "false");
    }
    dispatchPrefsEvent();
  } catch { /* ignore */ }
}

export function getEqualizerGenreAdaptive(): boolean {
  try {
    return localStorage.getItem(GENRE_ADAPTIVE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setEqualizerGenreAdaptive(value: boolean): void {
  try {
    localStorage.setItem(GENRE_ADAPTIVE_KEY, value ? "true" : "false");
    if (value) {
      localStorage.setItem(ADAPTIVE_KEY, "false");
    }
    dispatchPrefsEvent();
  } catch { /* ignore */ }
}

export function getEqualizerSnapshot(): EqualizerSnapshot {
  return {
    enabled: getEqualizerEnabled(),
    preset: getEqualizerPreset(),
    gains: getEqualizerGains(),
    adaptive: getEqualizerAdaptive(),
    genreAdaptive: getEqualizerGenreAdaptive(),
  };
}

function dispatchPrefsEvent(): void {
  try {
    window.dispatchEvent(new CustomEvent(EQ_PREFS_EVENT));
  } catch { /* ignore (SSR, etc.) */ }
}
