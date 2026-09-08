import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { Track } from "@/contexts/player-types";
import {
  androidNativeEngine as nativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import { isNative } from "@/lib/capacitor-runtime";
import {
  fadeInAndPlay as gpFadeInAndPlay,
  fadeOutAndPause as gpFadeOutAndPause,
  pause as gpPause,
  play as gpPlay,
  restoreVolume as gpRestoreVolume,
  seekTo as gpSeekTo,
  setPlaybackRate as gpSetPlaybackRate,
  setVolume as gpSetVolume,
} from "@/lib/gapless-player";
import {
  castPause,
  castPlay,
  castSeek,
  castSetVolume,
  isCastSessionActive,
} from "@/lib/cast-sender";

const SOFT_PAUSE_FADE_MS = 220;

function shouldUseImmediateTransportAction(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

export interface UsePlayerTransportControlsParams {
  queueRef: MutableRefObject<Track[]>;
  isPlayingRef: MutableRefObject<boolean>;
  bufferingIntentRef: MutableRefObject<boolean>;
  lastNonZeroVolumeRef: MutableRefObject<number>;
  commitIsPlaying: (isPlaying: boolean) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  commitCurrentTime: (time: number) => void;
  setVolumeState: Dispatch<SetStateAction<number>>;
  markSeekPosition: (seconds: number) => void;
  cancelSoftInterruption: () => void;
  silenceGaplessEngine: () => void;
}

export function usePlayerTransportControls({
  queueRef,
  isPlayingRef,
  bufferingIntentRef,
  lastNonZeroVolumeRef,
  commitIsPlaying,
  commitIsBuffering,
  commitCurrentTime,
  setVolumeState,
  markSeekPosition,
  cancelSoftInterruption,
  silenceGaplessEngine,
}: UsePlayerTransportControlsParams) {
  const pause = useCallback(() => {
    if (isCastSessionActive()) {
      void castPause().catch((error) => {
        console.error("[cast] failed to pause:", error);
      });
      commitIsPlaying(false);
      return;
    }
    cancelSoftInterruption();
    bufferingIntentRef.current = false;
    commitIsBuffering(false);
    if (shouldUseAndroidNativePlayer()) {
      silenceGaplessEngine();
      void nativeEngine.pause().catch((error) => {
        console.error("[native-player] failed to pause:", error);
      });
      commitIsPlaying(false);
      return;
    }
    if (shouldUseImmediateTransportAction()) {
      gpPause();
      return;
    }
    void gpFadeOutAndPause(SOFT_PAUSE_FADE_MS).catch(() => {
      gpPause();
    });
  }, [
    bufferingIntentRef,
    cancelSoftInterruption,
    commitIsBuffering,
    commitIsPlaying,
    silenceGaplessEngine,
  ]);

  const resume = useCallback(() => {
    if (!queueRef.current.length) return;
    if (isCastSessionActive()) {
      void castPlay().catch((error) => {
        console.error("[cast] failed to resume:", error);
      });
      commitIsPlaying(true);
      return;
    }
    cancelSoftInterruption();
    bufferingIntentRef.current = true;
    commitIsBuffering(true);
    if (shouldUseAndroidNativePlayer()) {
      silenceGaplessEngine();
      void nativeEngine.play().catch((error) => {
        console.error("[native-player] failed to resume:", error);
        commitIsBuffering(false);
      });
      return;
    }
    if (shouldUseImmediateTransportAction()) {
      gpRestoreVolume();
      gpPlay();
      return;
    }
    void gpFadeInAndPlay(SOFT_PAUSE_FADE_MS).catch(() => {
      gpRestoreVolume();
      gpPlay();
    });
  }, [
    bufferingIntentRef,
    cancelSoftInterruption,
    commitIsBuffering,
    commitIsPlaying,
    queueRef,
    silenceGaplessEngine,
  ]);

  const seek = useCallback(
    (time: number) => {
      if (isCastSessionActive()) {
        void castSeek(time).catch((error) => {
          console.error("[cast] failed to seek:", error);
        });
        commitCurrentTime(time);
        markSeekPosition(time);
        return;
      }
      const shouldResumeBufferingFlow = isPlayingRef.current;
      bufferingIntentRef.current = shouldResumeBufferingFlow;
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.seekTo(time * 1000).catch((error) => {
          console.error("[native-player] failed to seek:", error);
        });
      } else {
        gpSeekTo(time * 1000);
      }
      commitCurrentTime(time);
      commitIsBuffering(shouldResumeBufferingFlow);
      markSeekPosition(time);
    },
    [
      bufferingIntentRef,
      commitCurrentTime,
      commitIsBuffering,
      isPlayingRef,
      markSeekPosition,
    ],
  );

  const setVolume = useCallback(
    (volume: number) => {
      if (isCastSessionActive()) {
        void castSetVolume(volume).catch((error) => {
          console.error("[cast] failed to set volume:", error);
        });
        setVolumeState(volume);
        if (volume > 0) {
          lastNonZeroVolumeRef.current = volume;
        }
        try {
          localStorage.setItem("listen-player-volume", String(volume));
        } catch {
          // ignore persistence failures
        }
        return;
      }
      const effectiveVolume = isNative ? 1 : volume;
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.setVolume(effectiveVolume).catch((error) => {
          console.error("[native-player] failed to set volume:", error);
        });
      }
      gpSetVolume(effectiveVolume);
      setVolumeState(effectiveVolume);
      if (effectiveVolume > 0) {
        lastNonZeroVolumeRef.current = effectiveVolume;
      }
      if (isNative) return;
      try {
        localStorage.setItem("listen-player-volume", String(effectiveVolume));
      } catch {
        // ignore persistence failures
      }
    },
    [lastNonZeroVolumeRef, setVolumeState],
  );

  const setPlaybackRate = useCallback((rate: number) => {
    const safeRate = Math.max(0.25, Math.min(rate, 4));
    if (shouldUseAndroidNativePlayer()) {
      void nativeEngine.setPlaybackRate(safeRate).catch((error) => {
        console.error("[native-player] failed to set playback rate:", error);
      });
    } else {
      gpSetPlaybackRate(safeRate);
    }
  }, []);

  return { pause, resume, seek, setVolume, setPlaybackRate };
}
