import { useMemo, type MutableRefObject } from "react";

import type { CrossfadeTransition } from "@/contexts/PlayerContext";
import type { Track } from "@/contexts/player-types";
import {
  type PlayerSurfaceMode,
  type VisualizerSettingsPreference,
} from "@/lib/player-visualizer-prefs";
import type { MusicVisualizer } from "./MusicVisualizer";
import {
  useTrackVisualizerProfile,
  type VisualizerTrackProfile,
} from "./useTrackVisualizerProfile";
import { clamp } from "./visualizer-palette-math";
import { useVisualizerEngineSettings } from "./useVisualizerEngineSettings";
import { useVisualizerPalette } from "./useVisualizerPalette";
import { useVisualizerPreferences } from "./useVisualizerPreferences";

const ZERO_VIZ_DELTA = {
  separation: 0,
  glow: 0,
  scale: 0,
  persistence: 0,
  octaves: 0,
} as const;

export interface VisualizerConfigState {
  surfaceMode: PlayerSurfaceMode;
  vizEnabled: boolean;
  useAlbumPalette: boolean;
  trackAdaptiveViz: boolean;
  vizConfig: VisualizerSettingsPreference;
  effectiveVizConfig: VisualizerSettingsPreference;
  trackVizProfile: VisualizerTrackProfile;
  setSurfaceMode: (mode: PlayerSurfaceMode) => void;
  toggleAlbumPalette: () => void;
  toggleTrackAdaptive: () => void;
  updateConfig: (next: VisualizerSettingsPreference) => void;
  resetConfig: () => void;
}

export function useVisualizerConfig(
  vizRef: MutableRefObject<MusicVisualizer | null>,
  currentTrack: Track | undefined,
  isOpen: boolean,
  crossfadeTransition: CrossfadeTransition | null = null,
  visualizerAllowed = true,
): VisualizerConfigState {
  const {
    surfaceModePreference,
    useAlbumPalette,
    trackAdaptiveViz,
    vizConfig,
    setSurfaceMode,
    toggleAlbumPalette,
    toggleTrackAdaptive,
    updateConfig,
    resetConfig,
  } = useVisualizerPreferences(visualizerAllowed);
  const surfaceMode =
    visualizerAllowed || surfaceModePreference !== "visualizer"
      ? surfaceModePreference
      : "cover";
  const trackVizProfile = useTrackVisualizerProfile(
    currentTrack,
    visualizerAllowed && trackAdaptiveViz,
  );
  const vizEnabled = visualizerAllowed && surfaceMode === "visualizer";

  const effectiveVizDelta = trackAdaptiveViz
    ? trackVizProfile.settingsDelta
    : ZERO_VIZ_DELTA;
  const effectiveVizConfig = useMemo(
    () => ({
      separation: clamp(
        vizConfig.separation + effectiveVizDelta.separation,
        0,
        0.5,
      ),
      glow: clamp(vizConfig.glow + effectiveVizDelta.glow, 0, 15),
      scale: clamp(vizConfig.scale + effectiveVizDelta.scale, 0.2, 3),
      persistence: clamp(
        vizConfig.persistence + effectiveVizDelta.persistence,
        0,
        2,
      ),
      octaves: clamp(vizConfig.octaves + effectiveVizDelta.octaves, 1, 5),
    }),
    [effectiveVizDelta, vizConfig],
  );

  useVisualizerPalette({
    vizRef,
    currentTrack,
    isOpen,
    crossfadeTransition,
    trackAdaptiveViz,
    trackVizProfile,
    useAlbumPalette,
    vizEnabled,
  });

  useVisualizerEngineSettings({
    vizRef,
    currentTrack,
    isOpen,
    trackAdaptiveViz,
    trackVizProfile,
    effectiveVizConfig,
    vizEnabled,
  });

  return {
    surfaceMode,
    vizEnabled,
    useAlbumPalette,
    trackAdaptiveViz,
    vizConfig,
    effectiveVizConfig,
    trackVizProfile,
    setSurfaceMode,
    toggleAlbumPalette,
    toggleTrackAdaptive,
    updateConfig,
    resetConfig,
  };
}
