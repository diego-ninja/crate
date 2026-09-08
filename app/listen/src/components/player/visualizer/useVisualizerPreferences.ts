import { useEffect, useState } from "react";

import {
  DEFAULT_VISUALIZER_SETTINGS,
  PLAYER_VIZ_PREFS_EVENT,
  getTrackAdaptiveVisualizerPreference,
  getPlayerSurfaceModePreference,
  getUseAlbumPalettePreference,
  getVisualizerSettingsPreference,
  setPlayerSurfaceModePreference,
  setTrackAdaptiveVisualizerPreference,
  setUseAlbumPalettePreference,
  setVisualizerSettingsPreference,
  type PlayerSurfaceMode,
  type VisualizerSettingsPreference,
} from "@/lib/player-visualizer-prefs";

export function useVisualizerPreferences(visualizerAllowed: boolean) {
  const [surfaceModePreference, setSurfaceModeState] = useState(
    getPlayerSurfaceModePreference,
  );
  const [useAlbumPalette, setUseAlbumPalette] = useState(
    getUseAlbumPalettePreference,
  );
  const [trackAdaptiveViz, setTrackAdaptiveViz] = useState(
    getTrackAdaptiveVisualizerPreference,
  );
  const [vizConfig, setVizConfig] = useState(getVisualizerSettingsPreference);

  useEffect(() => {
    const sync = () => {
      setSurfaceModeState(getPlayerSurfaceModePreference());
      setUseAlbumPalette(getUseAlbumPalettePreference());
      setVizConfig(getVisualizerSettingsPreference());
      setTrackAdaptiveViz(getTrackAdaptiveVisualizerPreference());
    };
    window.addEventListener("storage", sync);
    window.addEventListener(PLAYER_VIZ_PREFS_EVENT, sync as EventListener);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(PLAYER_VIZ_PREFS_EVENT, sync as EventListener);
    };
  }, []);

  const setSurfaceMode = (mode: PlayerSurfaceMode) => {
    const next = !visualizerAllowed && mode === "visualizer" ? "cover" : mode;
    setSurfaceModeState(next);
    setPlayerSurfaceModePreference(next);
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

  return {
    surfaceModePreference,
    useAlbumPalette,
    trackAdaptiveViz,
    vizConfig,
    setSurfaceMode,
    toggleAlbumPalette,
    toggleTrackAdaptive,
    updateConfig,
    resetConfig: () => updateConfig(DEFAULT_VISUALIZER_SETTINGS),
  };
}
