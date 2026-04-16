import { useEffect, useState, type MutableRefObject } from "react";

import type { Track } from "@/contexts/player-types";
import { extractPalette } from "@/lib/palette";
import {
  DEFAULT_VISUALIZER_SETTINGS,
  PLAYER_VIZ_PREFS_EVENT,
  getTrackAdaptiveVisualizerPreference,
  getUseAlbumPalettePreference,
  getVisualizerEnabledPreference,
  getVisualizerSettingsPreference,
  setTrackAdaptiveVisualizerPreference,
  setUseAlbumPalettePreference,
  setVisualizerEnabledPreference,
  setVisualizerSettingsPreference,
  type VisualizerSettingsPreference,
} from "@/lib/player-visualizer-prefs";
import type { MusicVisualizer } from "./MusicVisualizer";
import { useTrackVisualizerProfile, type VisualizerTrackProfile } from "./useTrackVisualizerProfile";

type PaletteTriplet = [number, number, number];

const DEFAULT_VIZ_COLORS: [PaletteTriplet, PaletteTriplet, PaletteTriplet] = [
  [0.024, 0.714, 0.831],
  [0.4, 0.9, 1],
  [0.1, 0.3, 0.8],
];

const ZERO_VIZ_DELTA = {
  separation: 0,
  glow: 0,
  scale: 0,
  persistence: 0,
  octaves: 0,
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rgbToHsl([r, g, b]: PaletteTriplet): PaletteTriplet {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;
  switch (max) {
    case r: hue = (g - b) / delta + (g < b ? 6 : 0); break;
    case g: hue = (b - r) / delta + 2; break;
    default: hue = (r - g) / delta + 4; break;
  }
  return [hue / 6, saturation, lightness];
}

function hueToRgb(p: number, q: number, t: number) {
  let c = t;
  if (c < 0) c += 1;
  if (c > 1) c -= 1;
  if (c < 1 / 6) return p + (q - p) * 6 * c;
  if (c < 1 / 2) return q;
  if (c < 2 / 3) return p + (q - p) * (2 / 3 - c) * 6;
  return p;
}

function hslToRgb([h, s, l]: PaletteTriplet): PaletteTriplet {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

function adjustPaletteColor(
  [r, g, b]: PaletteTriplet,
  brightness: number,
  coolness: number,
  saturation: number,
  hueShift: number,
): PaletteTriplet {
  const avg = (r + g + b) / 3;
  const sat = 1 + saturation;
  const sr = avg + (r - avg) * sat;
  const sg = avg + (g - avg) * sat;
  const sb = avg + (b - avg) * sat;
  const [h, s, l] = rgbToHsl([
    clamp(sr + brightness - coolness * 0.4, 0, 1),
    clamp(sg + brightness * 0.8 - coolness * 0.05, 0, 1),
    clamp(sb + brightness * 0.45 + coolness, 0, 1),
  ]);
  return hslToRgb([
    (h + hueShift + 1) % 1,
    clamp(s + Math.abs(hueShift) * 0.12, 0, 1),
    l,
  ]);
}

export interface VisualizerConfigState {
  vizEnabled: boolean;
  useAlbumPalette: boolean;
  trackAdaptiveViz: boolean;
  vizConfig: VisualizerSettingsPreference;
  effectiveVizConfig: VisualizerSettingsPreference;
  trackVizProfile: VisualizerTrackProfile;
  toggleEnabled: () => void;
  toggleAlbumPalette: () => void;
  toggleTrackAdaptive: () => void;
  updateConfig: (next: VisualizerSettingsPreference) => void;
  resetConfig: () => void;
}

export function useVisualizerConfig(
  vizRef: MutableRefObject<MusicVisualizer | null>,
  currentTrack: Track | undefined,
  isOpen: boolean,
): VisualizerConfigState {
  const [vizEnabled, setVizEnabled] = useState(getVisualizerEnabledPreference);
  const [useAlbumPalette, setUseAlbumPalette] = useState(getUseAlbumPalettePreference);
  const [trackAdaptiveViz, setTrackAdaptiveViz] = useState(getTrackAdaptiveVisualizerPreference);
  const [vizConfig, setVizConfig] = useState(getVisualizerSettingsPreference);
  const trackVizProfile = useTrackVisualizerProfile(currentTrack, trackAdaptiveViz);

  const effectiveVizDelta = trackAdaptiveViz ? trackVizProfile.settingsDelta : ZERO_VIZ_DELTA;
  const effectiveVizConfig = {
    separation: clamp(vizConfig.separation + effectiveVizDelta.separation, 0, 0.5),
    glow: clamp(vizConfig.glow + effectiveVizDelta.glow, 0, 15),
    scale: clamp(vizConfig.scale + effectiveVizDelta.scale, 0.2, 3),
    persistence: clamp(vizConfig.persistence + effectiveVizDelta.persistence, 0, 2),
    octaves: clamp(vizConfig.octaves + effectiveVizDelta.octaves, 1, 5),
  };

  // Sync preferences from storage events
  useEffect(() => {
    const sync = () => {
      setUseAlbumPalette(getUseAlbumPalettePreference());
      setVizConfig(getVisualizerSettingsPreference());
      setVizEnabled(getVisualizerEnabledPreference());
      setTrackAdaptiveViz(getTrackAdaptiveVisualizerPreference());
    };
    window.addEventListener("storage", sync);
    window.addEventListener(PLAYER_VIZ_PREFS_EVENT, sync as EventListener);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(PLAYER_VIZ_PREFS_EVENT, sync as EventListener);
    };
  }, []);

  // Apply colors to visualizer
  useEffect(() => {
    if (!isOpen || !vizEnabled) return;

    const [defaultC1, defaultC2, defaultC3] = DEFAULT_VIZ_COLORS;
    const paletteBias = trackAdaptiveViz
      ? trackVizProfile.paletteBias
      : { brightness: 0, coolness: 0, saturation: 0, hueShift: 0 };
    const timers: number[] = [];

    const applyColors = (colors: [PaletteTriplet, PaletteTriplet, PaletteTriplet]) => {
      const [c1, c2, c3] = colors.map((color) =>
        adjustPaletteColor(color, paletteBias.brightness, paletteBias.coolness, paletteBias.saturation, paletteBias.hueShift),
      ) as [PaletteTriplet, PaletteTriplet, PaletteTriplet];
      return { c1, c2, c3 };
    };

    const scheduleColorApply = (colors: [PaletteTriplet, PaletteTriplet, PaletteTriplet]) => {
      const apply = (attempt = 0) => {
        const mapped = applyColors(colors);
        if (vizRef.current) {
          vizRef.current.color1 = mapped.c1;
          vizRef.current.color2 = mapped.c2;
          vizRef.current.color3 = mapped.c3;
          return;
        }
        if (attempt < 8) {
          timers.push(window.setTimeout(() => apply(attempt + 1), 80));
        }
      };
      apply();
      timers.push(window.setTimeout(() => apply(), 120));
      timers.push(window.setTimeout(() => apply(), 420));
      timers.push(window.setTimeout(() => apply(), 900));
    };

    if (!useAlbumPalette) {
      scheduleColorApply([defaultC1, defaultC2, defaultC3]);
      return () => { for (const t of timers) window.clearTimeout(t); };
    }

    if (!currentTrack?.albumCover) return;

    let cancelled = false;
    extractPalette(currentTrack.albumCover)
      .then(([c1, c2, c3]) => {
        if (cancelled) return;
        scheduleColorApply([c1, c2, c3]);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      for (const t of timers) window.clearTimeout(t);
    };
  }, [currentTrack?.albumCover, currentTrack?.id, isOpen, trackAdaptiveViz, trackVizProfile.paletteBias, useAlbumPalette, vizEnabled, vizRef]);

  // Apply config to visualizer
  useEffect(() => {
    const timers: number[] = [];

    const apply = (attempt = 0) => {
      if (vizRef.current) {
        vizRef.current.setMode("spheres");
        vizRef.current.separation = effectiveVizConfig.separation;
        vizRef.current.glow = effectiveVizConfig.glow;
        vizRef.current.scale = effectiveVizConfig.scale;
        vizRef.current.persistence = effectiveVizConfig.persistence;
        vizRef.current.octaves = effectiveVizConfig.octaves;
        vizRef.current.orbitSpeed = trackAdaptiveViz ? trackVizProfile.motion.orbitSpeed : 1;
        vizRef.current.cameraDrift = trackAdaptiveViz ? trackVizProfile.motion.cameraDrift : 1;
        vizRef.current.cameraDepth = trackAdaptiveViz ? trackVizProfile.motion.cameraDepth : 0;
        vizRef.current.pulseGain = trackAdaptiveViz ? trackVizProfile.motion.pulseGain : 1;
        vizRef.current.turbulence = trackAdaptiveViz ? trackVizProfile.motion.turbulence : 1;
        vizRef.current.orbitPhase = trackAdaptiveViz ? trackVizProfile.motion.orbitPhase : 0;
        vizRef.current.shellDensity = trackAdaptiveViz ? trackVizProfile.motion.shellDensity : 1;
        vizRef.current.beatResponse = trackAdaptiveViz ? trackVizProfile.motion.beatResponse : 1;
        vizRef.current.beatDecay = trackAdaptiveViz ? trackVizProfile.motion.beatDecay : 0.88;
        vizRef.current.sectionRate = trackAdaptiveViz ? trackVizProfile.motion.sectionRate : 1;
        vizRef.current.sectionDepth = trackAdaptiveViz ? trackVizProfile.motion.sectionDepth : 0.12;
        vizRef.current.lowBandWeight = trackAdaptiveViz ? trackVizProfile.motion.lowBandWeight : 1;
        vizRef.current.midBandWeight = trackAdaptiveViz ? trackVizProfile.motion.midBandWeight : 1;
        vizRef.current.highBandWeight = trackAdaptiveViz ? trackVizProfile.motion.highBandWeight : 1;
        return;
      }
      if (attempt < 8) {
        timers.push(window.setTimeout(() => apply(attempt + 1), 80));
      }
    };
    apply();
    timers.push(window.setTimeout(() => apply(), 300));
    return () => { for (const t of timers) window.clearTimeout(t); };
  }, [currentTrack?.id, effectiveVizConfig, isOpen, trackAdaptiveViz, trackVizProfile, vizRef]);

  // Accent on track change
  useEffect(() => {
    if (!isOpen || !vizEnabled || !currentTrack) return;
    let attempts = 0;
    let timer = 0;
    const applyAccent = () => {
      attempts += 1;
      if (vizRef.current) {
        vizRef.current.accentTrackChange(trackAdaptiveViz ? 1 : 0.75);
        return;
      }
      if (attempts < 8) timer = window.setTimeout(applyAccent, 80);
    };
    applyAccent();
    return () => window.clearTimeout(timer);
  }, [currentTrack?.id, isOpen, trackAdaptiveViz, vizEnabled, vizRef]);

  const toggleEnabled = () => {
    const next = !vizEnabled;
    setVizEnabled(next);
    setVisualizerEnabledPreference(next);
  };

  const toggleAlbumPalette = () => {
    const next = !useAlbumPalette;
    setUseAlbumPalette(next);
    setUseAlbumPalettePreference(next);
  };

  const toggleTrackAdaptive = () => {
    const next = !trackAdaptiveViz;
    setTrackAdaptiveViz(next);
    setTrackAdaptiveVisualizerPreference(next);
  };

  const updateConfig = (next: VisualizerSettingsPreference) => {
    setVizConfig(next);
    setVisualizerSettingsPreference(next);
  };

  const resetConfig = () => updateConfig(DEFAULT_VISUALIZER_SETTINGS);

  return {
    vizEnabled,
    useAlbumPalette,
    trackAdaptiveViz,
    vizConfig,
    effectiveVizConfig,
    trackVizProfile,
    toggleEnabled,
    toggleAlbumPalette,
    toggleTrackAdaptive,
    updateConfig,
    resetConfig,
  };
}
