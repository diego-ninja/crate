import { useCallback, useEffect, useRef } from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import {
  createPlayerQueueSnapshot,
  type PlayerQueueSnapshot,
} from "@/contexts/player-session";

type ValueRef<T> = { readonly current: T };
type MutableValueRef<T> = { current: T };

type UseJamQueueSessionOptions = {
  commitCurrentTime: (time: number) => void;
  commitJamQueueLocked: (locked: boolean) => void;
  currentIndexRef: ValueRef<number>;
  currentTimeRef: ValueRef<number>;
  ensureJamQueueLockedRef: MutableValueRef<(() => void) | null>;
  isPlayingRef: ValueRef<boolean>;
  jamQueueLockedRef: MutableValueRef<boolean>;
  playSourceRef: MutableValueRef<PlaySource | null>;
  pushToEngine: (
    queue: Track[],
    currentIndex: number,
    options?: {
      autoplay?: boolean;
      positionMs?: number;
      preservePlayback?: boolean;
    },
  ) => void;
  queueRef: ValueRef<Track[]>;
  repeatRef: MutableValueRef<RepeatMode>;
  setPlaySource: (source: PlaySource | null) => void;
  setRepeatState: (repeat: RepeatMode) => void;
  setShuffleState: (shuffle: boolean) => void;
  shuffleRef: MutableValueRef<boolean>;
  unshuffledQueueRef: MutableValueRef<Track[] | null>;
};

export function useJamQueueSession({
  commitCurrentTime,
  commitJamQueueLocked,
  currentIndexRef,
  currentTimeRef,
  ensureJamQueueLockedRef,
  isPlayingRef,
  jamQueueLockedRef,
  playSourceRef,
  pushToEngine,
  queueRef,
  repeatRef,
  setPlaySource,
  setRepeatState,
  setShuffleState,
  shuffleRef,
  unshuffledQueueRef,
}: UseJamQueueSessionOptions) {
  const jamQueueSnapshotRef = useRef<PlayerQueueSnapshot | null>(null);

  const captureQueueSnapshot = useCallback(
    () =>
      createPlayerQueueSnapshot({
        queue: queueRef.current,
        currentIndex: currentIndexRef.current,
        currentTime: currentTimeRef.current,
        isPlaying: isPlayingRef.current,
        shuffle: shuffleRef.current,
        repeat: repeatRef.current,
        playSource: playSourceRef.current,
        unshuffledQueue: unshuffledQueueRef.current,
      }),
    [
      currentIndexRef,
      currentTimeRef,
      isPlayingRef,
      playSourceRef,
      queueRef,
      repeatRef,
      shuffleRef,
      unshuffledQueueRef,
    ],
  );

  const restoreQueueSnapshot = useCallback(
    (snapshot: PlayerQueueSnapshot) => {
      jamQueueLockedRef.current = false;
      commitJamQueueLocked(false);
      repeatRef.current = snapshot.repeat;
      shuffleRef.current = snapshot.shuffle;
      playSourceRef.current = snapshot.playSource;
      unshuffledQueueRef.current = snapshot.unshuffledQueue
        ? [...snapshot.unshuffledQueue]
        : null;
      setRepeatState(snapshot.repeat);
      setShuffleState(snapshot.shuffle);
      setPlaySource(snapshot.playSource);
      pushToEngine(snapshot.queue, snapshot.currentIndex, {
        autoplay: snapshot.isPlaying,
        positionMs: snapshot.currentTime * 1000,
        preservePlayback: snapshot.isPlaying,
      });
      commitCurrentTime(snapshot.currentTime);
    },
    [
      commitCurrentTime,
      commitJamQueueLocked,
      jamQueueLockedRef,
      playSourceRef,
      pushToEngine,
      repeatRef,
      setPlaySource,
      setRepeatState,
      setShuffleState,
      shuffleRef,
      unshuffledQueueRef,
    ],
  );

  const enterJamSession = useCallback(() => {
    if (jamQueueLockedRef.current) return;
    jamQueueSnapshotRef.current = captureQueueSnapshot();
    commitJamQueueLocked(true);
  }, [captureQueueSnapshot, commitJamQueueLocked, jamQueueLockedRef]);

  const leaveJamSession = useCallback(() => {
    const snapshot = jamQueueSnapshotRef.current;
    jamQueueSnapshotRef.current = null;
    if (!snapshot) {
      commitJamQueueLocked(false);
      return;
    }
    restoreQueueSnapshot(snapshot);
  }, [commitJamQueueLocked, restoreQueueSnapshot]);

  useEffect(() => {
    ensureJamQueueLockedRef.current = enterJamSession;
    return () => {
      if (ensureJamQueueLockedRef.current === enterJamSession) {
        ensureJamQueueLockedRef.current = null;
      }
    };
  }, [ensureJamQueueLockedRef, enterJamSession]);

  return {
    captureQueueSnapshot,
    enterJamSession,
    leaveJamSession,
    restoreQueueSnapshot,
  };
}
