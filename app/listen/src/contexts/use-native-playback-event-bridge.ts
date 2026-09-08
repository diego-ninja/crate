import { useCallback, useEffect } from "react";

import type { Track } from "@/contexts/player-types";
import { subscribeNativePlayerEvents } from "@/contexts/subscribe-native-player-events";
import {
  androidNativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import type {
  EngineEventMap,
  EngineEventName,
  EnginePositionEvent,
  EngineState,
} from "@/lib/playback-engine";
import {
  nativePlaybackErrorMessage,
  persistNativePlaybackDiagnostic,
  redactDiagnosticUrl,
} from "@/contexts/use-native-buffering-recovery";
import { toast } from "sonner";

type ValueRef<T> = { readonly current: T };
type MutableValueRef<T> = { current: T };

type PlaybackStateOptions = {
  rotateIndexChange?: boolean;
  passiveLifecycle?: boolean;
};

export interface UseNativePlaybackEventBridgeParams {
  applyNativePosition: (event: EnginePositionEvent) => void;
  applyNativeState: (
    state: EngineState,
    options?: PlaybackStateOptions,
  ) => void;
  applyNativeTrackChange: (
    event: EnginePositionEvent & { reason?: string },
  ) => void;
  beginSoftInterruption: (reason: "stream") => void;
  bufferingIntentRef: MutableValueRef<boolean>;
  clearNativeBufferingWatchdog: () => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  currentIndexRef: ValueRef<number>;
  flushCurrentPlayEvent: (
    reason: "completed" | "skipped",
    track?: Track,
  ) => void;
  queueRef: ValueRef<Track[]>;
  recoverNativeBuffering: (options: {
    forceRefresh: boolean;
    probeStatus: string;
  }) => Promise<boolean>;
  retryNativePlaybackAfterAuthError: (
    nativeError: EngineEventMap["error"],
  ) => boolean;
  scheduleNativeBufferingWatchdog: () => void;
}

export function useNativePlaybackEventBridge({
  applyNativePosition,
  applyNativeState,
  applyNativeTrackChange,
  beginSoftInterruption,
  bufferingIntentRef,
  clearNativeBufferingWatchdog,
  commitIsBuffering,
  commitIsPlaying,
  currentIndexRef,
  flushCurrentPlayEvent,
  queueRef,
  recoverNativeBuffering,
  retryNativePlaybackAfterAuthError,
  scheduleNativeBufferingWatchdog,
}: UseNativePlaybackEventBridgeParams) {
  const handleNativeEvent = useCallback(
    <K extends EngineEventName>(eventName: K, payload: EngineEventMap[K]) => {
      if (eventName === "positionChanged") {
        applyNativePosition(payload as EnginePositionEvent);
        return;
      }
      if (eventName === "playEventCheckpoint") {
        applyNativePosition(payload as EnginePositionEvent);
        return;
      }
      if (eventName === "stateChanged") {
        applyNativeState(payload as EngineState);
        return;
      }
      if (eventName === "trackChanged") {
        applyNativeTrackChange(
          payload as EnginePositionEvent & { reason?: string },
        );
        return;
      }
      if (eventName === "bufferingChanged") {
        const isNativeBuffering = (payload as { isBuffering: boolean })
          .isBuffering;
        commitIsBuffering(isNativeBuffering);
        if (isNativeBuffering) {
          scheduleNativeBufferingWatchdog();
        } else {
          clearNativeBufferingWatchdog();
        }
        return;
      }
      if (eventName === "nearQueueEnd") {
        // Native near-end is only a signal that the queue is getting short.
        // The regular playback-intelligence effect handles prefetching without
        // moving the cursor; advancing here skips the rest of the album/playlist.
        return;
      }
      if (eventName === "queueEnded") {
        const endedTrack = queueRef.current[currentIndexRef.current];
        clearNativeBufferingWatchdog();
        flushCurrentPlayEvent("completed", endedTrack);
        bufferingIntentRef.current = false;
        commitIsPlaying(false);
        commitIsBuffering(false);
        return;
      }
      if (eventName === "resumeAuthorizationRequired") {
        void recoverNativeBuffering({
          forceRefresh: false,
          probeStatus: "resume-authorization",
        }).catch((error) => {
          console.error(
            "[native-player] failed to authorize restored playback:",
            error,
          );
          toast.error("Open Crate to resume playback", {
            description: "The saved queue needs fresh server authorization.",
          });
        });
        return;
      }
      if (eventName === "error") {
        const nativeError = payload as EngineEventMap["error"];
        const summary = nativePlaybackErrorMessage(nativeError);
        persistNativePlaybackDiagnostic({
          type: "error",
          ...nativeError,
          url: redactDiagnosticUrl(nativeError.url),
        });
        clearNativeBufferingWatchdog();
        console.error("[native-player] playback error:", payload);
        if (retryNativePlaybackAfterAuthError(nativeError)) {
          return;
        }
        toast.error("Native playback failed", {
          description: summary,
          duration: 9000,
        });
        bufferingIntentRef.current = false;
        commitIsPlaying(false);
        commitIsBuffering(false);
        beginSoftInterruption("stream");
      }
    },
    [
      applyNativePosition,
      applyNativeState,
      applyNativeTrackChange,
      beginSoftInterruption,
      bufferingIntentRef,
      clearNativeBufferingWatchdog,
      commitIsBuffering,
      commitIsPlaying,
      currentIndexRef,
      flushCurrentPlayEvent,
      queueRef,
      recoverNativeBuffering,
      retryNativePlaybackAfterAuthError,
      scheduleNativeBufferingWatchdog,
    ],
  );

  const reconcileNativePlayback = useCallback(
    (options: PlaybackStateOptions = {}) => {
      if (!shouldUseAndroidNativePlayer()) return;
      void androidNativeEngine
        .getState()
        .then((state) => {
          if (!state) return;
          applyNativeState(state, options);
        })
        .catch(() => {});
    },
    [applyNativeState],
  );

  useEffect(() => {
    if (!shouldUseAndroidNativePlayer()) return;
    let disposed = false;
    const subscription = subscribeNativePlayerEvents(androidNativeEngine, {
      positionChanged: (event) => {
        if (disposed) return;
        applyNativePosition(event);
      },
      playEventCheckpoint: (event) => {
        if (disposed) return;
        applyNativePosition(event);
      },
      stateChanged: (event) => {
        if (disposed) return;
        applyNativeState(event);
      },
      trackChanged: (event) => {
        if (disposed) return;
        applyNativeTrackChange(event);
      },
      bufferingChanged: (event) => {
        if (disposed) return;
        handleNativeEvent("bufferingChanged", event);
      },
      nearQueueEnd: (event) => {
        if (disposed) return;
        handleNativeEvent("nearQueueEnd", event);
      },
      queueEnded: (event) => {
        if (disposed) return;
        handleNativeEvent("queueEnded", event);
      },
      resumeAuthorizationRequired: (event) => {
        if (disposed) return;
        handleNativeEvent("resumeAuthorizationRequired", event);
      },
      error: (event) => {
        if (disposed) return;
        handleNativeEvent("error", event);
      },
    });

    void subscription.ready.catch((error) => {
      console.error("[native-player] failed to attach listeners:", error);
    });

    void androidNativeEngine
      .drainEvents()
      .then((events) => {
        if (disposed) return;
        for (const event of events) {
          handleNativeEvent(event.event, event.payload);
        }
      })
      .catch(() => {});

    reconcileNativePlayback();
    const onNativeResume = () => {
      reconcileNativePlayback({
        rotateIndexChange: true,
        passiveLifecycle: true,
      });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        reconcileNativePlayback({
          rotateIndexChange: true,
          passiveLifecycle: true,
        });
      }
    };
    window.addEventListener("crate:app-resumed", onNativeResume);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      window.removeEventListener("crate:app-resumed", onNativeResume);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearNativeBufferingWatchdog();
      subscription.dispose();
    };
  }, [
    applyNativePosition,
    applyNativeState,
    applyNativeTrackChange,
    clearNativeBufferingWatchdog,
    handleNativeEvent,
    reconcileNativePlayback,
  ]);
}
