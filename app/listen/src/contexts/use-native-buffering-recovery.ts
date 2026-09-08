import { useCallback, useRef } from "react";

import type { Track } from "@/contexts/player-types";
import { clampIndex } from "@/contexts/player-queue-helpers";
import { toStartupEngineTracks } from "@/contexts/player-engine-adapter";
import { getStreamUrl } from "@/contexts/player-utils";
import { refreshAuthToken } from "@/lib/api";
import {
  androidNativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import type { EngineEventMap } from "@/lib/playback-engine";
import { createQueueRevision } from "@/lib/playback-engine";
import { recordDevLog } from "@/lib/dev-logs";
import { toast } from "sonner";

const NATIVE_BUFFERING_WATCHDOG_MS = 12000;
const NATIVE_PLAYBACK_DIAGNOSTIC_KEY = "listen-native-playback-diagnostic:v1";

type ValueRef<T> = { readonly current: T };
type MutableValueRef<T> = { current: T };

export function redactDiagnosticUrl(url: string | undefined): string {
  if (!url) return "";
  return url.replace(/([?&]token=)[^&]+/g, "$1<redacted>");
}

export function persistNativePlaybackDiagnostic(
  payload: Record<string, unknown>,
) {
  try {
    localStorage.setItem(
      NATIVE_PLAYBACK_DIAGNOSTIC_KEY,
      JSON.stringify({
        at: new Date().toISOString(),
        ...payload,
      }),
    );
  } catch {
    // Diagnostics are best-effort.
  }
}

export function nativePlaybackErrorMessage(
  error: EngineEventMap["error"],
): string {
  if (typeof error.httpStatus === "number") {
    return `HTTP ${error.httpStatus}`;
  }
  if (error.causeMessage) return error.causeMessage;
  if (error.message) return error.message;
  if (error.cause) return error.cause;
  return "Unknown native playback error";
}

export interface UseNativeBufferingRecoveryParams {
  beginSoftInterruption: (reason: "stream") => void;
  bufferingIntentRef: MutableValueRef<boolean>;
  commitIsBuffering: (isBuffering: boolean) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  currentIndexRef: ValueRef<number>;
  currentTimeRef: ValueRef<number>;
  currentTrackRef: ValueRef<Track | undefined>;
  effectiveCrossfadeMsRef: ValueRef<number>;
  lastNonZeroVolumeRef: ValueRef<number>;
  queueRef: ValueRef<Track[]>;
  repeatRef: ValueRef<"off" | "one" | "all">;
}

export function useNativeBufferingRecovery({
  beginSoftInterruption,
  bufferingIntentRef,
  commitIsBuffering,
  commitIsPlaying,
  currentIndexRef,
  currentTimeRef,
  currentTrackRef,
  effectiveCrossfadeMsRef,
  lastNonZeroVolumeRef,
  queueRef,
  repeatRef,
}: UseNativeBufferingRecoveryParams) {
  const nativeBufferingWatchdogRef = useRef<number | null>(null);
  const nativeBufferingProbeIdRef = useRef(0);
  const nativeAuthRetryKeyRef = useRef<string | null>(null);
  const nativeBufferingRecoveryKeyRef = useRef<string | null>(null);

  const clearNativeBufferingWatchdog = useCallback(() => {
    if (nativeBufferingWatchdogRef.current === null) return;
    window.clearTimeout(nativeBufferingWatchdogRef.current);
    nativeBufferingWatchdogRef.current = null;
  }, []);

  const clearNativeBufferingRecovery = useCallback(() => {
    nativeBufferingRecoveryKeyRef.current = null;
  }, []);

  const recoverNativeBuffering = useCallback(
    async (options: { forceRefresh: boolean; probeStatus: string }) => {
      if (!shouldUseAndroidNativePlayer()) return false;

      const queueSnapshot = queueRef.current;
      if (queueSnapshot.length === 0) return false;

      const index = clampIndex(currentIndexRef.current, queueSnapshot.length);
      const targetTrack = queueSnapshot[index];
      const positionMs = Math.max(0, Math.round(currentTimeRef.current * 1000));
      const retryKey = [
        targetTrack?.id || index,
        Math.floor(positionMs / 10_000),
        options.probeStatus,
      ].join(":");
      if (nativeBufferingRecoveryKeyRef.current === retryKey) return false;
      nativeBufferingRecoveryKeyRef.current = retryKey;

      if (options.forceRefresh && !(await refreshAuthToken())) {
        return false;
      }

      const engineTracks = await toStartupEngineTracks(
        queueSnapshot,
        index,
        undefined,
        { target: "android-native" },
      );
      await androidNativeEngine.loadQueue({
        revision: createQueueRevision(),
        tracks: engineTracks,
        currentIndex: index,
        positionMs,
        autoplay: true,
        repeat: repeatRef.current,
        crossfadeMs: effectiveCrossfadeMsRef.current,
        volume: lastNonZeroVolumeRef.current,
      });
      return true;
    },
    [
      currentIndexRef,
      currentTimeRef,
      effectiveCrossfadeMsRef,
      lastNonZeroVolumeRef,
      queueRef,
      repeatRef,
    ],
  );

  const probeNativeBuffering = useCallback(async () => {
    const track = currentTrackRef.current;
    const probeId = nativeBufferingProbeIdRef.current + 1;
    nativeBufferingProbeIdRef.current = probeId;
    const streamUrl = track ? getStreamUrl(track) : "";
    const redactedUrl = redactDiagnosticUrl(streamUrl);

    let status: number | "network-error" | "timeout" | "no-track" = track
      ? "network-error"
      : "no-track";
    let detail = "";
    const isNativeLocalUrl =
      streamUrl.startsWith("file:") ||
      streamUrl.startsWith("capacitor:") ||
      streamUrl.startsWith("content:");

    if (track && streamUrl && isNativeLocalUrl) {
      status = 206;
      detail = "Native local media URL; skipping WebView range probe";
    } else if (track && streamUrl) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(streamUrl, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        response.body?.cancel().catch(() => {});
        status = response.status;
        detail =
          response.ok || response.status === 206
            ? "Range probe succeeded from WebView"
            : response.statusText;
      } catch (error) {
        status =
          error instanceof DOMException && error.name === "AbortError"
            ? "timeout"
            : "network-error";
        detail = error instanceof Error ? error.message : String(error);
      } finally {
        window.clearTimeout(timeout);
      }
    }

    if (probeId !== nativeBufferingProbeIdRef.current) return;
    persistNativePlaybackDiagnostic({
      type: "buffering-timeout",
      track: track
        ? { id: track.id, title: track.title, artist: track.artist }
        : null,
      streamUrl: redactedUrl,
      probeStatus: status,
      detail,
    });
    const canRecover =
      status === 200 || status === 206 || status === 401 || isNativeLocalUrl;
    if (canRecover) {
      try {
        const recovered = await recoverNativeBuffering({
          forceRefresh: status === 401,
          probeStatus: String(status),
        });
        if (recovered) {
          recordDevLog(
            "native-player",
            "recovered stuck native buffering",
            {
              track: track?.title,
              artist: track?.artist,
              probeStatus: status,
              url: redactedUrl,
            },
            "warn",
          );
          return;
        }
      } catch (error) {
        persistNativePlaybackDiagnostic({
          type: "buffering-recovery-failed",
          track: track
            ? { id: track.id, title: track.title, artist: track.artist }
            : null,
          streamUrl: redactedUrl,
          probeStatus: status,
          detail,
          recoveryError: error instanceof Error ? error.message : String(error),
        });
      }
    }
    toast.error("Native playback is stuck buffering", {
      description: `Stream probe: ${status}${detail ? ` · ${detail}` : ""}`,
      duration: 9000,
    });
  }, [currentTrackRef, recoverNativeBuffering]);

  const scheduleNativeBufferingWatchdog = useCallback(() => {
    clearNativeBufferingWatchdog();
    nativeBufferingWatchdogRef.current = window.setTimeout(() => {
      nativeBufferingWatchdogRef.current = null;
      void probeNativeBuffering();
    }, NATIVE_BUFFERING_WATCHDOG_MS);
  }, [clearNativeBufferingWatchdog, probeNativeBuffering]);

  const retryNativePlaybackAfterAuthError = useCallback(
    (nativeError: EngineEventMap["error"]): boolean => {
      if (nativeError.httpStatus !== 401) return false;
      if (!shouldUseAndroidNativePlayer()) return false;

      const queueSnapshot = queueRef.current;
      if (queueSnapshot.length === 0) return false;

      const nativeIndex =
        typeof nativeError.index === "number" &&
        Number.isFinite(nativeError.index)
          ? nativeError.index
          : currentIndexRef.current;
      const index = clampIndex(nativeIndex, queueSnapshot.length);
      const targetTrack = queueSnapshot[index];
      const positionMs = Math.max(0, Math.round(currentTimeRef.current * 1000));
      const retryKey = [
        nativeError.revision,
        nativeError.trackId || targetTrack?.id || index,
        Math.floor(positionMs / 10_000),
      ].join(":");
      if (nativeAuthRetryKeyRef.current === retryKey) return false;
      nativeAuthRetryKeyRef.current = retryKey;

      bufferingIntentRef.current = true;
      commitIsBuffering(true);
      commitIsPlaying(true);

      void (async () => {
        if (!(await refreshAuthToken())) {
          throw new Error("Could not refresh the native playback token");
        }
        const engineTracks = await toStartupEngineTracks(
          queueSnapshot,
          index,
          undefined,
          { target: "android-native" },
        );
        await androidNativeEngine.loadQueue({
          revision: createQueueRevision(),
          tracks: engineTracks,
          currentIndex: index,
          positionMs,
          autoplay: true,
          repeat: repeatRef.current,
          crossfadeMs: effectiveCrossfadeMsRef.current,
          volume: lastNonZeroVolumeRef.current,
        });
      })().catch((error) => {
        const summary = nativePlaybackErrorMessage(nativeError);
        console.error("[native-player] failed to recover auth error:", error);
        persistNativePlaybackDiagnostic({
          type: "auth-retry-failed",
          ...nativeError,
          url: redactDiagnosticUrl(nativeError.url),
          retryError: error instanceof Error ? error.message : String(error),
        });
        toast.error("Native playback failed", {
          description: summary,
          duration: 9000,
        });
        bufferingIntentRef.current = false;
        commitIsPlaying(false);
        commitIsBuffering(false);
        beginSoftInterruption("stream");
      });

      return true;
    },
    [
      beginSoftInterruption,
      bufferingIntentRef,
      commitIsBuffering,
      commitIsPlaying,
      currentIndexRef,
      currentTimeRef,
      effectiveCrossfadeMsRef,
      lastNonZeroVolumeRef,
      queueRef,
      repeatRef,
    ],
  );

  return {
    clearNativeBufferingWatchdog,
    clearNativeBufferingRecovery,
    recoverNativeBuffering,
    retryNativePlaybackAfterAuthError,
    scheduleNativeBufferingWatchdog,
  };
}
