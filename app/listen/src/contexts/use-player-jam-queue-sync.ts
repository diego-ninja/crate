import {
  useCallback,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import { getJamQueueSyncPlan, tracksMatch } from "@/contexts/player-session";
import type { PlaySource, Track } from "@/contexts/player-types";
import { toFreshEngineTrack } from "@/contexts/player-engine-adapter";
import {
  insertTrack as gpInsertTrack,
  removeTrack as gpRemoveTrack,
} from "@/lib/gapless-player";
import {
  androidNativeEngine as nativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";

const JAM_EXPLICIT_SYNC_TOLERANCE_SECONDS = 0.005;

type QueueEdit =
  | { type: "remove"; index: number; track: Track }
  | { type: "insert"; index: number; track: Track };

function planQueueEdits(
  currentQueue: Track[],
  nextQueue: Track[],
): QueueEdit[] {
  const workingQueue = [...currentQueue];
  const edits: QueueEdit[] = [];

  for (let index = workingQueue.length - 1; index >= 0; index -= 1) {
    const track = workingQueue[index];
    if (
      track &&
      !nextQueue.some((candidate) => tracksMatch(candidate, track))
    ) {
      edits.push({ type: "remove", index, track });
      workingQueue.splice(index, 1);
    }
  }

  for (let index = 0; index < nextQueue.length; index += 1) {
    const target = nextQueue[index];
    if (!target) continue;
    const current = workingQueue[index];
    if (current && tracksMatch(current, target)) continue;

    const existingIndex = workingQueue.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index && tracksMatch(candidate, target),
    );
    if (existingIndex >= 0) {
      const [moved] = workingQueue.splice(existingIndex, 1);
      if (!moved) continue;
      edits.push({ type: "remove", index: existingIndex, track: moved });
      edits.push({ type: "insert", index, track: target });
      workingQueue.splice(index, 0, target);
      continue;
    }

    edits.push({ type: "insert", index, track: target });
    workingQueue.splice(index, 0, target);
  }

  return edits;
}

function playSourcesMatch(
  left: PlaySource | null | undefined,
  right: PlaySource | null | undefined,
): boolean {
  return left?.type === right?.type && left?.name === right?.name;
}

interface UsePlayerJamQueueSyncOptions {
  queueRef: MutableRefObject<Track[]>;
  jamQueueLockedRef: MutableRefObject<boolean>;
  currentIndexRef: MutableRefObject<number>;
  currentTimeRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  playSourceRef: MutableRefObject<PlaySource | null>;
  setPlaySource: Dispatch<SetStateAction<PlaySource | null>>;
  ensureJamQueueLocked?: () => void;
  commitQueue: (queue: Track[]) => void;
  commitCurrentIndex: (index: number) => void;
  pushToEngine: (
    queue: Track[],
    requestedIndex: number,
    options?: {
      autoplay?: boolean;
      positionMs?: number;
      preservePlayback?: boolean;
    },
  ) => void;
  registerEngineTrack: (track: Track) => string;
  unregisterEngineTrack: (track: Track) => void;
  seek: (time: number) => void;
  pause: () => void;
  resume: () => void;
}

export function usePlayerJamQueueSync({
  queueRef,
  jamQueueLockedRef,
  currentIndexRef,
  currentTimeRef,
  isPlayingRef,
  playSourceRef,
  setPlaySource,
  ensureJamQueueLocked,
  commitQueue,
  commitCurrentIndex,
  pushToEngine,
  registerEngineTrack,
  unregisterEngineTrack,
  seek,
  pause,
  resume,
}: UsePlayerJamQueueSyncOptions) {
  const jamQueueSyncRevisionRef = useRef(0);
  const initialJamQueueMutation = useMemo(() => Promise.resolve(), []);
  const nativeJamQueueMutationRef = useRef(initialJamQueueMutation);

  const syncJamQueue = useCallback(
    (
      tracks: Track[],
      options?: {
        currentTrack?: Track | null;
        positionSeconds?: number;
        playing?: boolean;
        queueOnly?: boolean;
        forcePosition?: boolean;
        source?: PlaySource;
      },
    ) => {
      const source = options?.source ||
        playSourceRef.current || {
          type: "queue" as const,
          name: "Jam session",
        };
      if (!jamQueueLockedRef.current) {
        if (source.type !== "queue" || !source.name.startsWith("Jam:")) return;
        ensureJamQueueLocked?.();
        if (!jamQueueLockedRef.current) return;
      }

      const plan = getJamQueueSyncPlan({
        currentQueue: queueRef.current,
        currentIndex: currentIndexRef.current,
        currentTime: currentTimeRef.current,
        isPlaying: isPlayingRef.current,
        nextQueue: tracks,
        currentTrack: options?.currentTrack,
        positionSeconds: options?.positionSeconds,
        playing: options?.playing,
      });
      const currentTrack =
        options?.currentTrack !== undefined
          ? options.currentTrack
          : queueRef.current[currentIndexRef.current];
      const nextTrack = tracks[plan.currentIndex];
      const queueOrderMatches =
        tracks.length === queueRef.current.length &&
        tracks.every((track, index) =>
          tracksMatch(track, queueRef.current[index]),
        );
      const activeTrackMatches =
        nextTrack === undefined && currentTrack == null
          ? true
          : tracksMatch(nextTrack, currentTrack);
      const currentIndexMatches = currentIndexRef.current === plan.currentIndex;

      if (!playSourcesMatch(playSourceRef.current, source)) {
        playSourceRef.current = source;
        setPlaySource(source);
      }

      if (!queueOrderMatches || !activeTrackMatches || !currentIndexMatches) {
        const jamQueueSyncRevision = ++jamQueueSyncRevisionRef.current;
        if (options?.queueOnly && activeTrackMatches && currentTrack) {
          const edits = planQueueEdits(queueRef.current, tracks);
          if (shouldUseAndroidNativePlayer()) {
            const applyNativeEdits = async () => {
              for (const edit of edits) {
                if (jamQueueSyncRevisionRef.current !== jamQueueSyncRevision) {
                  return;
                }
                if (edit.type === "remove") {
                  // Native queue indices change after each edit, so these operations must remain ordered.
                  // react-doctor-disable-next-line async-await-in-loop
                  await nativeEngine.removeTrack(edit.index);
                  if (
                    jamQueueSyncRevisionRef.current !== jamQueueSyncRevision
                  ) {
                    return;
                  }
                  unregisterEngineTrack(edit.track);
                } else {
                  const engineTrack = await toFreshEngineTrack(
                    edit.track,
                    undefined,
                    { target: "android-native" },
                  );
                  if (
                    jamQueueSyncRevisionRef.current !== jamQueueSyncRevision
                  ) {
                    return;
                  }
                  await nativeEngine.insertTrack(edit.index, engineTrack);
                }
              }
            };
            nativeJamQueueMutationRef.current =
              nativeJamQueueMutationRef.current
                .catch(() => undefined)
                .then(applyNativeEdits)
                .catch((error) => {
                  if (
                    jamQueueSyncRevisionRef.current === jamQueueSyncRevision
                  ) {
                    console.error(
                      "[native-player] failed to apply Jam queue update:",
                      error,
                    );
                  }
                });
          } else {
            for (const edit of edits) {
              if (edit.type === "remove") {
                gpRemoveTrack(edit.index);
                unregisterEngineTrack(edit.track);
              } else {
                gpInsertTrack(edit.index, registerEngineTrack(edit.track));
              }
            }
          }
          commitQueue(tracks);
          if (currentIndexRef.current !== plan.currentIndex) {
            commitCurrentIndex(plan.currentIndex);
          }
        } else {
          const preservePlayback = tracksMatch(currentTrack, nextTrack);
          pushToEngine(tracks, plan.currentIndex, {
            autoplay: plan.playing,
            positionMs: plan.positionSeconds * 1000,
            ...(preservePlayback ? { preservePlayback: true } : {}),
          });
          return;
        }
      }

      if (options?.positionSeconds !== undefined) {
        const drift = Math.abs(
          options.positionSeconds - currentTimeRef.current,
        );
        if (
          drift >
          (options.forcePosition ? JAM_EXPLICIT_SYNC_TOLERANCE_SECONDS : 1)
        ) {
          seek(plan.positionSeconds);
        }
      }
      if (options?.playing !== undefined) {
        if (options.playing && !isPlayingRef.current) resume();
        else if (!options.playing && isPlayingRef.current) pause();
      }
    },
    [
      commitCurrentIndex,
      commitQueue,
      currentIndexRef,
      currentTimeRef,
      ensureJamQueueLocked,
      isPlayingRef,
      jamQueueLockedRef,
      pause,
      playSourceRef,
      pushToEngine,
      queueRef,
      registerEngineTrack,
      resume,
      seek,
      setPlaySource,
      unregisterEngineTrack,
    ],
  );

  return { syncJamQueue };
}
