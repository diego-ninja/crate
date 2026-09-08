import { useEffect } from "react";

import type { PlaySource, RepeatMode } from "@/contexts/player-types";
import {
  setLoop as gpSetLoop,
  setSingleMode as gpSetSingleMode,
  setVolume as gpSetVolume,
} from "@/lib/gapless-player";

interface Ref<T> {
  current: T;
}

interface UsePlayerEnginePreferenceRuntimeOptions {
  playSource: PlaySource | null;
  repeat: RepeatMode;
  shuffle: boolean;
  smartCrossfadeEnabled: boolean;
  volume: number;
  playSourceRef: Ref<PlaySource | null>;
  repeatRef: Ref<RepeatMode>;
  shuffleRef: Ref<boolean>;
  smartCrossfadeEnabledRef: Ref<boolean>;
}

export function usePlayerEnginePreferenceRuntime({
  playSource,
  repeat,
  shuffle,
  smartCrossfadeEnabled,
  volume,
  playSourceRef,
  repeatRef,
  shuffleRef,
  smartCrossfadeEnabledRef,
}: UsePlayerEnginePreferenceRuntimeOptions): void {
  useEffect(() => {
    repeatRef.current = repeat;
    shuffleRef.current = shuffle;
    playSourceRef.current = playSource;
    smartCrossfadeEnabledRef.current = smartCrossfadeEnabled;
  }, [
    playSource,
    repeat,
    shuffle,
    smartCrossfadeEnabled,
    playSourceRef,
    repeatRef,
    shuffleRef,
    smartCrossfadeEnabledRef,
  ]);

  useEffect(() => {
    gpSetVolume(volume);
  }, [volume]);

  useEffect(() => {
    gpSetLoop(repeat === "all");
    gpSetSingleMode(repeat === "one");
  }, [repeat]);
}
