import { useEffect, useSyncExternalStore, type MutableRefObject } from "react";

import type { CrossfadeTransition } from "@/contexts/PlayerContext";
import type { Track } from "@/contexts/player-types";
import { extractPalette } from "@/lib/palette";
import type { MusicVisualizer } from "./MusicVisualizer";
import type { VisualizerTrackProfile } from "./useTrackVisualizerProfile";
import {
  readVisualizerColors,
  type VisualizerColorTriplet,
} from "./visualizer-colors";
import { adjustPaletteColor, clamp } from "./visualizer-palette-math";
import {
  getAppliedThemeSkin,
  subscribeThemeSkin,
} from "@crate/ui/lib/theme-skin";

type PaletteTriplet = VisualizerColorTriplet;

type VisualizerPaletteProps = {
  vizRef: MutableRefObject<MusicVisualizer | null>;
  currentTrack: Track | undefined;
  isOpen: boolean;
  crossfadeTransition: CrossfadeTransition | null;
  trackAdaptiveViz: boolean;
  trackVizProfile: VisualizerTrackProfile;
  useAlbumPalette: boolean;
  vizEnabled: boolean;
};

function readDefaultVisualizerColors(): [
  PaletteTriplet,
  PaletteTriplet,
  PaletteTriplet,
] {
  const probe = document.createElement("span");
  document.documentElement.appendChild(probe);
  try {
    return readVisualizerColors(probe);
  } finally {
    probe.remove();
  }
}

function getPaletteBias(
  trackAdaptiveViz: boolean,
  trackVizProfile: VisualizerTrackProfile,
) {
  return trackAdaptiveViz
    ? trackVizProfile.paletteBias
    : { brightness: 0, coolness: 0, saturation: 0, hueShift: 0 };
}

export function useVisualizerPalette({
  vizRef,
  currentTrack,
  isOpen,
  crossfadeTransition,
  trackAdaptiveViz,
  trackVizProfile,
  useAlbumPalette,
  vizEnabled,
}: VisualizerPaletteProps) {
  const appearanceVersion = useSyncExternalStore(
    subscribeThemeSkin,
    () => `${getAppliedThemeSkin().skin}:${getAppliedThemeSkin().resolvedMode}`,
    () => "default:dark",
  );

  useEffect(() => {
    if (!isOpen || !vizEnabled || crossfadeTransition) return;

    const [defaultC1, defaultC2, defaultC3] = readDefaultVisualizerColors();
    const paletteBias = getPaletteBias(trackAdaptiveViz, trackVizProfile);
    const timers: number[] = [];

    const applyColors = (
      colors: [PaletteTriplet, PaletteTriplet, PaletteTriplet],
    ) => {
      const [c1, c2, c3] = colors.map((color) =>
        adjustPaletteColor(
          color,
          paletteBias.brightness,
          paletteBias.coolness,
          paletteBias.saturation,
          paletteBias.hueShift,
        ),
      ) as [PaletteTriplet, PaletteTriplet, PaletteTriplet];
      return { c1, c2, c3 };
    };

    const scheduleColorApply = (
      colors: [PaletteTriplet, PaletteTriplet, PaletteTriplet],
    ) => {
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
      return () => {
        for (const timer of timers) window.clearTimeout(timer);
      };
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
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [
    crossfadeTransition,
    currentTrack,
    currentTrack?.albumCover,
    currentTrack?.id,
    isOpen,
    trackAdaptiveViz,
    trackVizProfile,
    trackVizProfile.paletteBias,
    useAlbumPalette,
    vizEnabled,
    vizRef,
    appearanceVersion,
  ]);

  useEffect(() => {
    if (!crossfadeTransition || !isOpen || !vizEnabled || !useAlbumPalette) {
      return;
    }
    if (!vizRef.current) return;

    const paletteBias = getPaletteBias(trackAdaptiveViz, trackVizProfile);
    let cancelled = false;
    let raf = 0;

    Promise.all([
      crossfadeTransition.outgoing.albumCover
        ? extractPalette(crossfadeTransition.outgoing.albumCover).catch(
            () => null,
          )
        : Promise.resolve(null),
      crossfadeTransition.incoming.albumCover
        ? extractPalette(crossfadeTransition.incoming.albumCover).catch(
            () => null,
          )
        : Promise.resolve(null),
    ]).then(([fromPalette, toPalette]) => {
      if (cancelled || !vizRef.current || !fromPalette || !toPalette) return;

      const [fromC1, fromC2, fromC3] = fromPalette.map((color) =>
        adjustPaletteColor(
          color,
          paletteBias.brightness,
          paletteBias.coolness,
          paletteBias.saturation,
          paletteBias.hueShift,
        ),
      ) as [PaletteTriplet, PaletteTriplet, PaletteTriplet];
      const [toC1, toC2, toC3] = toPalette.map((color) =>
        adjustPaletteColor(
          color,
          paletteBias.brightness,
          paletteBias.coolness,
          paletteBias.saturation,
          paletteBias.hueShift,
        ),
      ) as [PaletteTriplet, PaletteTriplet, PaletteTriplet];

      const lerpTriplet = (
        from: PaletteTriplet,
        to: PaletteTriplet,
        progress: number,
      ): PaletteTriplet => [
        from[0] + (to[0] - from[0]) * progress,
        from[1] + (to[1] - from[1]) * progress,
        from[2] + (to[2] - from[2]) * progress,
      ];

      const tick = () => {
        if (cancelled || !vizRef.current) return;
        const elapsed = performance.now() - crossfadeTransition.startedAt;
        const progress = clamp(elapsed / crossfadeTransition.durationMs, 0, 1);
        vizRef.current.color1 = lerpTriplet(fromC1, toC1, progress);
        vizRef.current.color2 = lerpTriplet(fromC2, toC2, progress);
        vizRef.current.color3 = lerpTriplet(fromC3, toC3, progress);
        if (progress < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [
    crossfadeTransition,
    isOpen,
    trackAdaptiveViz,
    trackVizProfile,
    trackVizProfile.paletteBias,
    useAlbumPalette,
    vizEnabled,
    vizRef,
  ]);
}
