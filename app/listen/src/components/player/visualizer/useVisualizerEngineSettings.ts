import { useEffect, type MutableRefObject } from "react";

import type { Track } from "@/contexts/player-types";
import type { VisualizerSettingsPreference } from "@/lib/player-visualizer-prefs";
import type { MusicVisualizer } from "./MusicVisualizer";
import type { VisualizerTrackProfile } from "./useTrackVisualizerProfile";

type VisualizerEngineSettingsProps = {
  vizRef: MutableRefObject<MusicVisualizer | null>;
  currentTrack: Track | undefined;
  isOpen: boolean;
  trackAdaptiveViz: boolean;
  trackVizProfile: VisualizerTrackProfile;
  effectiveVizConfig: VisualizerSettingsPreference;
  vizEnabled: boolean;
};

export function useVisualizerEngineSettings({
  vizRef,
  currentTrack,
  isOpen,
  trackAdaptiveViz,
  trackVizProfile,
  effectiveVizConfig,
  vizEnabled,
}: VisualizerEngineSettingsProps) {
  useEffect(() => {
    if (!isOpen || !vizEnabled) return;

    const timers: number[] = [];

    const apply = (attempt = 0) => {
      if (vizRef.current) {
        vizRef.current.setMode("spheres");
        vizRef.current.separation = effectiveVizConfig.separation;
        vizRef.current.glow = effectiveVizConfig.glow;
        vizRef.current.scale = effectiveVizConfig.scale;
        vizRef.current.persistence = effectiveVizConfig.persistence;
        vizRef.current.octaves = effectiveVizConfig.octaves;
        vizRef.current.orbitSpeed = trackAdaptiveViz
          ? trackVizProfile.motion.orbitSpeed
          : 1;
        vizRef.current.cameraDrift = trackAdaptiveViz
          ? trackVizProfile.motion.cameraDrift
          : 1;
        vizRef.current.cameraDepth = trackAdaptiveViz
          ? trackVizProfile.motion.cameraDepth
          : 0;
        vizRef.current.pulseGain = trackAdaptiveViz
          ? trackVizProfile.motion.pulseGain
          : 1;
        vizRef.current.turbulence = trackAdaptiveViz
          ? trackVizProfile.motion.turbulence
          : 1;
        vizRef.current.orbitPhase = trackAdaptiveViz
          ? trackVizProfile.motion.orbitPhase
          : 0;
        vizRef.current.shellDensity = trackAdaptiveViz
          ? trackVizProfile.motion.shellDensity
          : 1;
        vizRef.current.beatResponse = trackAdaptiveViz
          ? trackVizProfile.motion.beatResponse
          : 1;
        vizRef.current.beatDecay = trackAdaptiveViz
          ? trackVizProfile.motion.beatDecay
          : 0.88;
        vizRef.current.sectionRate = trackAdaptiveViz
          ? trackVizProfile.motion.sectionRate
          : 1;
        vizRef.current.sectionDepth = trackAdaptiveViz
          ? trackVizProfile.motion.sectionDepth
          : 0.12;
        vizRef.current.lowBandWeight = trackAdaptiveViz
          ? trackVizProfile.motion.lowBandWeight
          : 1;
        vizRef.current.midBandWeight = trackAdaptiveViz
          ? trackVizProfile.motion.midBandWeight
          : 1;
        vizRef.current.highBandWeight = trackAdaptiveViz
          ? trackVizProfile.motion.highBandWeight
          : 1;
        return;
      }
      if (attempt < 8) {
        timers.push(window.setTimeout(() => apply(attempt + 1), 80));
      }
    };
    apply();
    timers.push(window.setTimeout(() => apply(), 300));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [
    currentTrack,
    currentTrack?.id,
    effectiveVizConfig,
    isOpen,
    trackAdaptiveViz,
    trackVizProfile,
    vizEnabled,
    vizRef,
  ]);

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
  }, [
    currentTrack,
    currentTrack?.id,
    isOpen,
    trackAdaptiveViz,
    vizEnabled,
    vizRef,
  ]);
}
