import { useCallback, useEffect, useState } from "react";

import { usePlayerActions } from "@/contexts/PlayerContext";
import { useEqFeatures } from "@/hooks/use-eq-features";
import { useTrackGenre } from "@/hooks/use-track-genre";
import { computeAdaptiveGains } from "@/lib/adaptive-eq";
import {
  applyEqualizerPreset,
  EQ_PREFS_EVENT,
  getEqualizerSnapshot,
  setCustomEqualizerGains,
  setEqualizerEnabled,
  setEqualizerAdaptive,
  setEqualizerGenreAdaptive,
  type EqualizerSnapshot,
} from "@/lib/equalizer-prefs";
import { EQ_BAND_COUNT, EQ_PRESETS, type EqGains, type EqPresetName } from "@/lib/equalizer";
import { setEqualizer as engineSetEqualizer } from "@/lib/gapless-player";

const FLAT_GAINS: EqGains = new Array(EQ_BAND_COUNT).fill(0);

/**
 * Subscribes a React component to equalizer preferences and keeps the
 * Gapless-5 engine chain in sync. Returns the current snapshot + setters
 * that both persist and push to the engine in one call.
 */
export function useEqualizer() {
  const [snapshot, setSnapshot] = useState<EqualizerSnapshot>(getEqualizerSnapshot);
  const { currentTrack } = usePlayerActions();

  // Fetch analysis features only while feature-adaptive mode is on.
  const featuresState = useEqFeatures(snapshot.adaptive ? currentTrack : undefined);
  const features = featuresState.status === "ready" ? featuresState.features : null;

  // Fetch primary genre + resolved preset only while genre-adaptive
  // mode is on. The backend resolves preset gains via taxonomy
  // inheritance (direct hit or first ancestor with a preset), so the
  // frontend just applies whatever comes back.
  const genreState = useTrackGenre(snapshot.genreAdaptive ? currentTrack : undefined);
  const trackGenre = genreState.status === "ready" ? genreState.genre : null;

  // Effective gains — priority order:
  //   1. Feature-adaptive (uses track features; flat if missing)
  //   2. Genre-adaptive   (uses backend-resolved preset; flat if none)
  //   3. Manual (persisted preset / custom gains)
  const effectiveGains: EqGains = (() => {
    if (snapshot.adaptive) return computeAdaptiveGains(features);
    if (snapshot.genreAdaptive) {
      const preset = trackGenre?.preset;
      if (!preset || preset.gains.length !== EQ_BAND_COUNT) return FLAT_GAINS;
      return preset.gains;
    }
    return snapshot.gains;
  })();

  // Push to the engine whenever what we'd apply changes.
  useEffect(() => {
    engineSetEqualizer(snapshot.enabled, effectiveGains);
  }, [snapshot.enabled, effectiveGains]);

  // Listen for cross-component / cross-tab pref changes.
  useEffect(() => {
    const sync = () => setSnapshot(getEqualizerSnapshot());
    window.addEventListener(EQ_PREFS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EQ_PREFS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggleEnabled = useCallback((enabled: boolean) => {
    setEqualizerEnabled(enabled);
    setSnapshot((prev) => ({ ...prev, enabled }));
  }, []);

  const applyPreset = useCallback((preset: EqPresetName) => {
    const gains = applyEqualizerPreset(preset);
    setSnapshot((prev) => ({ ...prev, preset, gains: [...gains], adaptive: false, genreAdaptive: false }));
  }, []);

  const updateBand = useCallback((bandIndex: number, dB: number) => {
    setSnapshot((prev) => {
      const nextGains = [...prev.gains];
      nextGains[bandIndex] = dB;
      setCustomEqualizerGains(nextGains);
      return { ...prev, preset: "custom", gains: nextGains, adaptive: false, genreAdaptive: false };
    });
  }, []);

  const resetToFlat = useCallback(() => {
    applyPreset("flat");
  }, [applyPreset]);

  const toggleAdaptive = useCallback((value: boolean) => {
    setEqualizerAdaptive(value);
    setSnapshot((prev) => ({
      ...prev,
      adaptive: value,
      // Genre-adaptive loses mutually-exclusive fight with adaptive.
      genreAdaptive: value ? false : prev.genreAdaptive,
    }));
  }, []);

  const toggleGenreAdaptive = useCallback((value: boolean) => {
    setEqualizerGenreAdaptive(value);
    setSnapshot((prev) => ({
      ...prev,
      genreAdaptive: value,
      adaptive: value ? false : prev.adaptive,
    }));
  }, []);

  return {
    enabled: snapshot.enabled,
    preset: snapshot.preset,
    gains: effectiveGains,
    adaptive: snapshot.adaptive,
    genreAdaptive: snapshot.genreAdaptive,
    // Tagged status of the features fetch so the UI can distinguish
    // "loading", "ready", and "unavailable" (no analysis yet or 404).
    adaptiveStatus: snapshot.adaptive ? featuresState.status : "idle",
    // Raw track features when ready. Null in any other state — the UI
    // uses adaptiveStatus to decide what placeholder to show.
    adaptiveFeatures: features,
    // Genre-adaptive readout — the full track-genre payload (primary
    // slug, top-level, source, resolved preset).
    genreAdaptiveStatus: snapshot.genreAdaptive ? genreState.status : "idle",
    trackGenre,
    presetNames: Object.keys(EQ_PRESETS) as EqPresetName[],
    toggleEnabled,
    toggleAdaptive,
    toggleGenreAdaptive,
    applyPreset,
    updateBand,
    resetToFlat,
  };
}
