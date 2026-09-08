import { useMemo } from "react";

import type { Track } from "@/contexts/player-types";
import { useTrackInfo } from "@/hooks/use-track-info";
import {
  buildVisualizerTrackProfile,
  toVisualizerInfo,
} from "./visualizer-track-profile";

export type { VisualizerTrackProfile } from "./visualizer-track-profile";

export function useTrackVisualizerProfile(
  track: Track | undefined,
  enabled: boolean,
) {
  const { info } = useTrackInfo(track, { enabled });
  const visualizerInfo = useMemo(() => toVisualizerInfo(info), [info]);
  return useMemo(
    () => buildVisualizerTrackProfile(visualizerInfo),
    [visualizerInfo],
  );
}
