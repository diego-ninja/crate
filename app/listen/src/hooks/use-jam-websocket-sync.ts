import { useCallback, useRef } from "react";

import type { Track } from "@/contexts/PlayerContext";
import type { PlaySource } from "@/contexts/player-types";
import { tracksMatch } from "@/contexts/player-session";
import { payloadToTrack } from "@/pages/jam-reducer";

const JAM_HARD_CORRECTION_THRESHOLD_MS = 180;
const JAM_FORCED_CORRECTION_TOLERANCE_MS = 5;
const JAM_HARD_CORRECTION_COOLDOWN_MS = 1_500;

function trackIdentity(track: Track | null | undefined) {
  if (!track) return null;
  return (
    track.globalTrackUid ||
    track.entityUid ||
    (track.libraryTrackId != null ? `library:${track.libraryTrackId}` : null) ||
    track.id ||
    track.path ||
    null
  );
}

export type JamPlayerActionsRef = {
  play: (track: Track, source?: PlaySource) => void;
  playAll: (tracks: Track[], startIndex?: number, source?: PlaySource) => void;
  pause: () => void;
  resume: () => void;
  seek: (time: number) => void;
  syncJamQueue: (
    tracks: Track[],
    options?: {
      currentTrack?: Track | null;
      positionSeconds?: number;
      playing?: boolean;
      queueOnly?: boolean;
      forcePosition?: boolean;
      source?: PlaySource;
    },
  ) => void;
  setPlaybackRate?: (rate: number) => void;
  currentTrack: Track | undefined;
  isPlaying?: boolean;
  playSource?: PlaySource | null;
};

interface UseJamWebSocketSyncOptions {
  dispatch: React.Dispatch<import("@/pages/jam-reducer").JamSessionAction>;
  playerActionsRef: React.MutableRefObject<JamPlayerActionsRef>;
  currentTimeRef: React.MutableRefObject<number>;
  roomNameRef: React.MutableRefObject<string>;
}

export function useJamWebSocketSync({
  dispatch,
  playerActionsRef,
  currentTimeRef,
  roomNameRef,
}: UseJamWebSocketSyncOptions) {
  const pendingSyncTrackRef = useRef<{
    identity: string;
    requestedAt: number;
  } | null>(null);
  const awaitingInitialClockRef = useRef(false);
  const jamRateCorrectionRef = useRef(false);
  const authoritativeQueueRef = useRef<Track[]>([]);
  const serverClockOffsetMsRef = useRef(0);
  const hasServerClockOffsetRef = useRef(false);
  const lastHardCorrectionAtRef = useRef(0);

  const syncSeek = useCallback(
    (
      track: Record<string, unknown> | null | undefined,
      positionMs: number,
      playing = true,
      forcePosition = false,
    ) => {
      const targetTrack = payloadToTrack(track);
      const {
        currentTrack: ct,
        seek: sk,
        play: pl,
        pause: pa,
        resume: re,
        syncJamQueue,
        setPlaybackRate,
      } = playerActionsRef.current;
      const currentPositionMs = currentTimeRef.current * 1000;
      const localIsPlaying = playerActionsRef.current.isPlaying === true;

      if (targetTrack && ct && tracksMatch(targetTrack, ct)) {
        pendingSyncTrackRef.current = null;
        const signedDriftSeconds = (positionMs - currentPositionMs) / 1000;
        const drift = Math.abs(signedDriftSeconds) * 1000;
        // Keep small drift corrections smooth, but close a large phase gap
        // quickly enough to avoid audible echo between room members. The
        // cooldown prevents a slow/stale media position update from turning
        // this into a seek loop.
        const nowMs = Date.now();
        const hardCorrectionRequested =
          drift >
          (forcePosition
            ? JAM_FORCED_CORRECTION_TOLERANCE_MS
            : JAM_HARD_CORRECTION_THRESHOLD_MS);
        const hardCorrection =
          hardCorrectionRequested &&
          (forcePosition ||
            nowMs - lastHardCorrectionAtRef.current >=
              JAM_HARD_CORRECTION_COOLDOWN_MS);
        if (hardCorrection) {
          sk(positionMs / 1000);
          lastHardCorrectionAtRef.current = nowMs;
        }
        if (
          setPlaybackRate &&
          playing &&
          localIsPlaying &&
          drift >= 35 &&
          !hardCorrection
        ) {
          // Close normal clock drift without repeatedly seeking the media
          // element. A short, bounded rate adjustment avoids the audible
          // restart/echo caused by hard-seeking on every room interaction.
          const correction = Math.max(
            0.95,
            Math.min(1.05, 1 + signedDriftSeconds * 0.2),
          );
          setPlaybackRate(correction);
          jamRateCorrectionRef.current = correction !== 1;
        } else if (setPlaybackRate && jamRateCorrectionRef.current) {
          setPlaybackRate(1);
          jamRateCorrectionRef.current = false;
        }
        if (drift < 100) {
          dispatch({ type: "SET_SYNC_STATUS", payload: "synced" });
        } else {
          dispatch({ type: "SET_SYNC_STATUS", payload: "drifting" });
        }
        if (playing && !localIsPlaying) re();
        else if (!playing && localIsPlaying) pa();
      } else if (targetTrack) {
        if (setPlaybackRate && jamRateCorrectionRef.current) {
          setPlaybackRate(1);
          jamRateCorrectionRef.current = false;
        }
        const identity = trackIdentity(targetTrack);
        const pendingSync = pendingSyncTrackRef.current;
        if (
          identity &&
          pendingSync?.identity === identity &&
          Date.now() - pendingSync.requestedAt < 2_500
        ) {
          // The room sends a clock immediately and then on a heartbeat. While
          // the first async queue load is pending, those messages must not
          // restart the same track from the beginning.
          dispatch({
            type: "SET_SYNC_STATUS",
            payload: playing ? "drifting" : "idle",
          });
          return;
        }
        pendingSyncTrackRef.current = identity
          ? { identity, requestedAt: Date.now() }
          : null;
        const authoritativeQueue = authoritativeQueueRef.current;
        if (
          authoritativeQueue.length > 0 &&
          authoritativeQueue.some((candidate) =>
            tracksMatch(candidate, targetTrack),
          )
        ) {
          syncJamQueue(authoritativeQueue, {
            currentTrack: targetTrack,
            positionSeconds: positionMs / 1000,
            playing,
            source: {
              type: "queue",
              name: `Jam: ${roomNameRef.current}`,
            },
          });
          dispatch({
            type: "SET_SYNC_STATUS",
            payload: playing ? "synced" : "idle",
          });
          return;
        }
        pl(targetTrack, { type: "queue", name: `Jam: ${roomNameRef.current}` });
        window.setTimeout(() => {
          if (identity && pendingSyncTrackRef.current?.identity !== identity) {
            return;
          }
          sk(positionMs / 1000);
          if (!playing) pa();
        }, 160);
        dispatch({
          type: "SET_SYNC_STATUS",
          payload: playing ? "synced" : "idle",
        });
      } else if (setPlaybackRate && jamRateCorrectionRef.current) {
        setPlaybackRate(1);
        jamRateCorrectionRef.current = false;
      }
    },
    [
      dispatch,
      playerActionsRef,
      currentTimeRef,
      roomNameRef,
      authoritativeQueueRef,
    ],
  );

  return {
    authoritativeQueueRef,
    awaitingInitialClockRef,
    hasServerClockOffsetRef,
    jamRateCorrectionRef,
    lastHardCorrectionAtRef,
    pendingSyncTrackRef,
    serverClockOffsetMsRef,
    syncSeek,
  };
}
