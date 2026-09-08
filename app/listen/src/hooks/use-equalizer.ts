import { useCallback } from "react";

import { usePlayerActions } from "@/contexts/PlayerContext";
import {
  useEqualizerSnapshotState,
  useResolvedEqualizer,
} from "@/hooks/use-equalizer-runtime";
import {
  clearTrackEqPreset,
  saveTrackEqPreset,
} from "@/hooks/use-effective-eq";
import {
  applyEqualizerPreset,
  setCustomEqualizerGains,
  setEqualizerEnabled,
  setEqualizerAdaptive,
  setEqualizerGenreAdaptive,
  setEqualizerSmart,
} from "@/lib/equalizer-prefs";
import { EQ_PRESETS, type EqPresetName } from "@/lib/equalizer";

/**
 * Subscribes a React component to equalizer preferences and keeps the
 * current snapshot in sync. Returns the current snapshot + setters.
 *
 * Audio application is handled by useEqualizerRuntime; this hook is UI-only
 * so mounting/unmounting an EQ panel cannot alter the output chain.
 */
export function useEqualizer() {
  const [snapshot, setSnapshot] = useEqualizerSnapshotState();
  const { currentTrack } = usePlayerActions();
  const {
    effectiveGains,
    effectiveEqState,
    effectiveEq,
    featuresState,
    features,
    genreState,
    trackGenre,
  } = useResolvedEqualizer(snapshot, currentTrack);

  const toggleEnabled = useCallback(
    (enabled: boolean) => {
      setEqualizerEnabled(enabled);
      setSnapshot((prev) => ({ ...prev, enabled }));
    },
    [setSnapshot],
  );

  const applyPreset = useCallback(
    (preset: EqPresetName) => {
      const gains = applyEqualizerPreset(preset);
      setSnapshot((prev) => ({
        ...prev,
        preset,
        gains: [...gains],
        smart: false,
        adaptive: false,
        genreAdaptive: false,
      }));
    },
    [setSnapshot],
  );

  const updateBand = useCallback(
    (bandIndex: number, dB: number) => {
      setSnapshot((prev) => {
        const nextGains = [...prev.gains];
        nextGains[bandIndex] = dB;
        setCustomEqualizerGains(nextGains);
        return {
          ...prev,
          preset: "custom",
          gains: nextGains,
          smart: false,
          adaptive: false,
          genreAdaptive: false,
        };
      });
    },
    [setSnapshot],
  );

  const resetToFlat = useCallback(() => {
    applyPreset("flat");
  }, [applyPreset]);

  const toggleAdaptive = useCallback(
    (value: boolean) => {
      setEqualizerAdaptive(value);
      setSnapshot((prev) => ({
        ...prev,
        adaptive: value,
        smart: value ? false : prev.smart,
        // Genre-adaptive loses mutually-exclusive fight with adaptive.
        genreAdaptive: value ? false : prev.genreAdaptive,
      }));
    },
    [setSnapshot],
  );

  const toggleGenreAdaptive = useCallback(
    (value: boolean) => {
      setEqualizerGenreAdaptive(value);
      setSnapshot((prev) => ({
        ...prev,
        genreAdaptive: value,
        smart: value ? false : prev.smart,
        adaptive: value ? false : prev.adaptive,
      }));
    },
    [setSnapshot],
  );

  const toggleSmart = useCallback(
    (value: boolean) => {
      setEqualizerSmart(value);
      setSnapshot((prev) => ({
        ...prev,
        smart: value,
        adaptive: value ? false : prev.adaptive,
        genreAdaptive: value ? false : prev.genreAdaptive,
      }));
    },
    [setSnapshot],
  );

  const saveForCurrentTrack = useCallback(async () => {
    if (!currentTrack) return null;
    const preset = await saveTrackEqPreset(currentTrack, [...effectiveGains]);
    effectiveEqState.refetch?.();
    if (preset) {
      setEqualizerSmart(true);
      setSnapshot((prev) => ({
        ...prev,
        smart: true,
        adaptive: false,
        genreAdaptive: false,
        gains: [...preset.gains],
      }));
    }
    return preset;
  }, [currentTrack, effectiveEqState, effectiveGains, setSnapshot]);

  const clearCurrentTrackPreset = useCallback(async () => {
    if (!currentTrack) return null;
    const preset = await clearTrackEqPreset(currentTrack);
    effectiveEqState.refetch?.();
    setEqualizerSmart(true);
    setSnapshot((prev) => ({
      ...prev,
      smart: true,
      adaptive: false,
      genreAdaptive: false,
      gains: preset ? [...preset.gains] : prev.gains,
    }));
    return preset;
  }, [currentTrack, effectiveEqState, setSnapshot]);

  return {
    enabled: snapshot.enabled,
    preset: snapshot.preset,
    gains: effectiveGains,
    smart: snapshot.smart,
    adaptive: snapshot.adaptive,
    genreAdaptive: snapshot.genreAdaptive,
    smartStatus: snapshot.smart ? effectiveEqState.status : "idle",
    effectiveEq,
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
    toggleSmart,
    toggleAdaptive,
    toggleGenreAdaptive,
    applyPreset,
    updateBand,
    resetToFlat,
    saveForCurrentTrack,
    clearCurrentTrackPreset,
  };
}
