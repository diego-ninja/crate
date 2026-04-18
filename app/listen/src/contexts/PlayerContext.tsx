import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import {
  getStoredQueue,
  getStoredRecentlyPlayed,
  getStoredVolume,
  getEffectiveCrossfadeSeconds,
  getPredictableNextTrack,
  getStreamUrl,
  getTrackCacheKey,
  MAX_RECENT,
  saveRecentlyPlayed,
  STORAGE_KEY,
} from "@/contexts/player-utils";
import {
  addTrack as gpAddTrack,
  fadeInAndPlay as gpFadeInAndPlay,
  fadeOutAndPause as gpFadeOutAndPause,
  getCurrentTrackDuration as gpGetCurrentTrackDuration,
  getPosition as gpGetPosition,
  getTrackIndex as gpGetTrackIndex,
  getTracks as gpGetTracks,
  gotoTrack as gpGotoTrack,
  initPlayer as initGaplessPlayer,
  insertTrack as gpInsertTrack,
  isCurrentTrackFullyBuffered,
  loadQueue as gpLoadQueue,
  next as gpNext,
  pause as gpPause,
  play as gpPlay,
  removeTrack as gpRemoveTrack,
  restoreVolume as gpRestoreVolume,
  seekTo as gpSeekTo,
  setCrossfadeDuration as gpSetCrossfadeDuration,
  setLoop as gpSetLoop,
  setSingleMode as gpSetSingleMode,
  setVolume as gpSetVolume,
  type GaplessPlayerCallbacks,
} from "@/lib/gapless-player";
import { useAuth } from "@/contexts/AuthContext";
import { usePlayEventTracker } from "@/contexts/use-play-event-tracker";
import { usePlaybackIntelligence } from "@/contexts/use-playback-intelligence";
import { usePlaybackPersistence } from "@/contexts/use-playback-persistence";
import { useRestoreOnMount } from "@/contexts/use-restore-on-mount";
import { useSoftInterruption } from "@/contexts/use-soft-interruption";
import { usePlayerShortcuts } from "@/contexts/use-player-shortcuts";
import { useMediaSession } from "@/contexts/use-media-session";
import { isOnline as isRuntimeOnline } from "@/lib/capacitor";
import { flushQueue as flushPlayEventQueue, postWithRetry } from "@/lib/play-event-queue";
import {
  getCrossfadeDurationPreference,
  getInfinitePlaybackPreference,
  getSmartCrossfadePreference,
  getSmartPlaylistSuggestionsCadencePreference,
  getSmartPlaylistSuggestionsPreference,
  PLAYER_PLAYBACK_PREFS_EVENT,
} from "@/lib/player-playback-prefs";

export type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";

export interface CrossfadeTransition {
  outgoing: Track;
  incoming: Track;
  /** Length of the crossfade in milliseconds. */
  durationMs: number;
  /** performance.now() at which the crossfade began. */
  startedAt: number;
  /**
   * Duration of the OUTGOING track in seconds, captured at the start of
   * the crossfade. UI components use this to keep the progress bar on
   * the outgoing track (sliding from `duration - crossfadeSec` to
   * `duration`) instead of jumping to position 0 of the incoming, which
   * makes the audio crossfade feel coherent with the visual.
   */
  outgoingDurationSeconds: number;
}

interface PlayerStateValue {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
  analyserVersion: number;
  /**
   * Active crossfade transition, or null when no crossfade is running.
   * Consumers use this + useCrossfadeProgress to fade artwork / title /
   * visualizer palette between the outgoing and incoming tracks.
   */
  crossfadeTransition: CrossfadeTransition | null;
}

interface PlayerActionsValue {
  queue: Track[];
  currentIndex: number;
  shuffle: boolean;
  repeat: RepeatMode;
  playSource: PlaySource | null;
  recentlyPlayed: Track[];
  currentTrack: Track | undefined;
  play: (track: Track, source?: PlaySource) => void;
  playAll: (tracks: Track[], startIndex?: number, source?: PlaySource) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  clearQueue: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  jumpTo: (index: number) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
}

type PlayerContextValue = PlayerStateValue & PlayerActionsValue;

const PlayerStateContext = createContext<PlayerStateValue | null>(null);
const PlayerActionsContext = createContext<PlayerActionsValue | null>(null);

const SOFT_PAUSE_FADE_MS = 220;
const PREV_RESTART_THRESHOLD_SECONDS = 3;
const PREV_DOUBLE_TAP_WINDOW_MS = 1500;

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

export function shouldRestartTrackBeforePrev(params: {
  currentTimeSeconds: number;
  justRestartedCurrentTrack: boolean;
}): boolean {
  return params.currentTimeSeconds > PREV_RESTART_THRESHOLD_SECONDS && !params.justRestartedCurrentTrack;
}

/**
 * Fisher-Yates shuffle that keeps `pinnedIndex` at position 0 of the
 * result so playback continues uninterrupted when shuffle is toggled on.
 * Returns a new array; does not mutate.
 */
function shuffleKeepingCurrent<T>(queue: T[], pinnedIndex: number): T[] {
  const pinned = queue[pinnedIndex];
  const others = queue.filter((_, i) => i !== pinnedIndex);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j]!, others[i]!];
  }
  return pinned ? [pinned, ...others] : others;
}

function resolveQueueFromUrls(
  urls: string[],
  sourceQueue: Track[],
  engineTrackMap: Map<string, Track[]>,
): Track[] {
  if (!urls.length) return sourceQueue;

  // Primary lookup: the map captured the URL → [Track, Track, ...] pairings
  // at load time (buckets preserve multiplicity — the same URL may map to
  // multiple Track instances if duplicates exist in the queue, e.g. album
  // with a hidden track repeated, or a playlist with the same song twice).
  //
  // Even if getStreamUrl(track) would now produce a different URL (e.g.
  // auth token rotated mid-session), the engine still holds the URL we
  // loaded, and the buckets still resolve to the right Track.
  //
  // We copy the buckets so this function stays pure; shift() consumes
  // them in FIFO order so duplicates map back to distinct Track objects.
  const buckets = new Map<string, Track[]>();
  for (const [url, tracks] of engineTrackMap) {
    buckets.set(url, tracks.slice());
  }

  const resolved: Track[] = [];
  for (const url of urls) {
    const bucket = buckets.get(url);
    if (bucket?.length) {
      resolved.push(bucket.shift()!);
      continue;
    }
    // Fallback: best-effort lookup via current getStreamUrl. Only useful
    // if nothing transport-side has changed since load.
    const fallback = sourceQueue.find((track) => getStreamUrl(track) === url);
    if (fallback) resolved.push(fallback);
  }

  return resolved.length > 0 ? resolved : sourceQueue;
}

export function usePlayerState(): PlayerStateValue {
  const ctx = useContext(PlayerStateContext);
  if (!ctx) throw new Error("usePlayerState must be used within PlayerProvider");
  return ctx;
}

export function usePlayerActions(): PlayerActionsValue {
  const ctx = useContext(PlayerActionsContext);
  if (!ctx) throw new Error("usePlayerActions must be used within PlayerProvider");
  return ctx;
}

export function usePlayer(): PlayerContextValue {
  const state = usePlayerState();
  const actions = usePlayerActions();
  return { ...state, ...actions };
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const stored = useRef(getStoredQueue());
  const [queue, setQueueState] = useState<Track[]>(stored.current.queue);
  const [currentIndex, setCurrentIndexState] = useState(
    clampIndex(stored.current.currentIndex, stored.current.queue.length),
  );
  const [isPlaying, setIsPlayingState] = useState(false);
  const [isBuffering, setIsBufferingState] = useState(false);
  const [currentTime, setCurrentTimeState] = useState(0);
  const [duration, setDurationState] = useState(0);
  const [volume, setVolumeState] = useState(getStoredVolume);
  const [analyserVersion, setAnalyserVersion] = useState(0);
  const [crossfadeTransition, setCrossfadeTransition] = useState<CrossfadeTransition | null>(null);
  const crossfadeTimerRef = useRef<number | null>(null);
  // Hydrate shuffle flag from the persisted session so the UI reflects
  // the actual order held in `queue` — not doing this caused a regression
  // where a reload could leave a shuffled queue with shuffle=false, with
  // no way to recover the original order.
  const [shuffle, setShuffleState] = useState(() => stored.current.shuffle);
  const [playSource, setPlaySource] = useState<PlaySource | null>(null);
  const [repeat, setRepeatState] = useState<RepeatMode>("off");
  const [smartCrossfadeEnabled, setSmartCrossfadeEnabled] = useState(getSmartCrossfadePreference);
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>(getStoredRecentlyPlayed);
  const [infinitePlaybackEnabled, setInfinitePlaybackEnabled] = useState(getInfinitePlaybackPreference);
  const [smartPlaylistSuggestionsEnabled, setSmartPlaylistSuggestionsEnabled] = useState(
    getSmartPlaylistSuggestionsPreference,
  );
  const [smartPlaylistSuggestionsCadence, setSmartPlaylistSuggestionsCadence] = useState(
    getSmartPlaylistSuggestionsCadencePreference,
  );

  const currentTrack = queue[currentIndex];

  const queueRef = useRef(queue);
  const currentIndexRef = useRef(currentIndex);
  const currentTrackRef = useRef(currentTrack);
  const repeatRef = useRef(repeat);
  const shuffleRef = useRef(shuffle);
  const playSourceRef = useRef(playSource);
  const smartCrossfadeEnabledRef = useRef(smartCrossfadeEnabled);
  const effectiveCrossfadeMsRef = useRef(getCrossfadeDurationPreference() * 1000);
  const isPlayingRef = useRef(isPlaying);
  const isBufferingRef = useRef(isBuffering);
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const bufferingIntentRef = useRef(false);
  const lastNonZeroVolumeRef = useRef(Math.max(getStoredVolume(), 0.5));
  const activatedTrackKeyRef = useRef<string | null>(null);
  const prevRestartTrackKeyRef = useRef<string | null>(null);
  const prevRestartedAtRef = useRef(0);
  // Callbacks the Gapless-5 engine will dispatch into. Populated below
  // in render body; the proxy we hand to initGaplessPlayer reads the
  // freshest handler on each dispatch.
  const callbacksRef = useRef<GaplessPlayerCallbacks>({});
  // Boot Gapless-5 synchronously on the first render so that effects
  // which depend on the engine existing (useRestoreOnMount's
  // gpLoadQueue, volume sync, etc.) all see an initialized instance.
  // If this moved to a useEffect([]), it would run AFTER the restore
  // effect and `gpLoadQueue` there would silently no-op.
  const engineInitRef = useRef(false);
  if (!engineInitRef.current) {
    engineInitRef.current = true;
    initGaplessPlayer({
      onTimeUpdate: (ms, idx) => callbacksRef.current.onTimeUpdate?.(ms, idx),
      onDurationChange: (ms) => callbacksRef.current.onDurationChange?.(ms),
      onLoad: (path, full, ms) => callbacksRef.current.onLoad?.(path, full, ms),
      onPlayRequest: (path) => callbacksRef.current.onPlayRequest?.(path),
      onPlay: (path) => callbacksRef.current.onPlay?.(path),
      onPause: (path) => callbacksRef.current.onPause?.(path),
      onPrev: (from, to) => callbacksRef.current.onPrev?.(from, to),
      onNext: (from, to) => callbacksRef.current.onNext?.(from, to),
      onTrackFinished: (path) => callbacksRef.current.onTrackFinished?.(path),
      onAllFinished: () => callbacksRef.current.onAllFinished?.(),
      onError: (path, err) => callbacksRef.current.onError?.(path, err),
      onBuffering: (path) => callbacksRef.current.onBuffering?.(path),
      onAnalyserReady: (analyser) => callbacksRef.current.onAnalyserReady?.(analyser),
    });
  }
  // When shuffle is active, we keep the un-shuffled queue here so we can
  // restore the original order when shuffle is turned off. Hydrated from
  // the persisted session so a reload preserves the round-trip.
  const unshuffledQueueRef = useRef<Track[] | null>(stored.current.unshuffledQueue);
  // Stable identity map: URL-loaded-into-engine → [Track, ...]. Buckets
  // preserve multiplicity — two queue slots with the same URL (e.g. the
  // same song repeated) map to distinct Track references. Keeps state-
  // machine reconciliation working even if getStreamUrl(track) would
  // later produce a different URL (token refresh, base URL change).
  const engineTrackMapRef = useRef<Map<string, Track[]>>(new Map());

  const commitQueue = useCallback((nextQueue: Track[]) => {
    queueRef.current = nextQueue;
    setQueueState(nextQueue);
  }, []);

  /**
   * Compute the URLs we will hand to the engine AND remember each
   * URL → Track pairing (as buckets, so duplicates are preserved) so
   * we can reverse it later regardless of any transport-level mutation
   * (token rotation, base URL change). Call before any gpLoadQueue.
   */
  const buildEngineUrls = useCallback((tracks: Track[]): string[] => {
    const urls = tracks.map(getStreamUrl);
    const nextMap = new Map<string, Track[]>();
    tracks.forEach((track, i) => {
      const url = urls[i];
      if (!url) return;
      const bucket = nextMap.get(url);
      if (bucket) bucket.push(track);
      else nextMap.set(url, [track]);
    });
    engineTrackMapRef.current = nextMap;
    return urls;
  }, []);

  /**
   * Append a single track to the identity map. For incremental
   * additions (playNext, addToQueue) — appends to the bucket so a
   * duplicate gets its own slot instead of overwriting.
   */
  const registerEngineTrack = useCallback((track: Track): string => {
    const url = getStreamUrl(track);
    const bucket = engineTrackMapRef.current.get(url);
    if (bucket) bucket.push(track);
    else engineTrackMapRef.current.set(url, [track]);
    return url;
  }, []);

  /**
   * Remove one instance of `track` from the identity map. Used when
   * gpRemoveTrack is called on a non-current slot, to keep the bucket
   * in sync with what the engine actually holds.
   */
  const unregisterEngineTrack = useCallback((track: Track): void => {
    const url = getStreamUrl(track);
    const bucket = engineTrackMapRef.current.get(url);
    if (!bucket) return;
    const key = getTrackCacheKey(track);
    const idx = bucket.findIndex((t) => getTrackCacheKey(t) === key);
    if (idx < 0) return;
    bucket.splice(idx, 1);
    if (bucket.length === 0) {
      engineTrackMapRef.current.delete(url);
    }
  }, []);

  const clearPrevRestartLatch = useCallback(() => {
    prevRestartTrackKeyRef.current = null;
    prevRestartedAtRef.current = 0;
  }, []);

  const commitCurrentIndex = useCallback((nextIndex: number) => {
    currentIndexRef.current = nextIndex;
    currentTrackRef.current = queueRef.current[nextIndex];
    setCurrentIndexState(nextIndex);
  }, []);

  const commitCurrentTime = useCallback((nextTime: number) => {
    currentTimeRef.current = nextTime;
    setCurrentTimeState(nextTime);
  }, []);

  const commitDuration = useCallback((nextDuration: number) => {
    durationRef.current = nextDuration;
    setDurationState(nextDuration);
  }, []);

  const commitIsPlaying = useCallback((nextIsPlaying: boolean) => {
    isPlayingRef.current = nextIsPlaying;
    setIsPlayingState(nextIsPlaying);
  }, []);

  const commitIsBuffering = useCallback((nextIsBuffering: boolean) => {
    isBufferingRef.current = nextIsBuffering;
    setIsBufferingState(nextIsBuffering);
  }, []);

  // queue, currentIndex, currentTrack, currentTime, duration, isPlaying are
  // kept in sync with their refs by their respective commit* helpers.
  // Only repeat, shuffle and playSource use setState directly, so mirror
  // them into refs here.
  useEffect(() => {
    repeatRef.current = repeat;
    shuffleRef.current = shuffle;
    playSourceRef.current = playSource;
    smartCrossfadeEnabledRef.current = smartCrossfadeEnabled;
  }, [playSource, repeat, shuffle, smartCrossfadeEnabled]);

  const syncEffectiveCrossfade = useCallback(() => {
    const nextTrack = getPredictableNextTrack(
      queueRef.current,
      currentIndexRef.current,
      repeatRef.current,
      shuffleRef.current,
    );
    const effectiveSeconds = getEffectiveCrossfadeSeconds(
      currentTrackRef.current,
      nextTrack,
      playSourceRef.current,
      shuffleRef.current,
      getCrossfadeDurationPreference(),
      smartCrossfadeEnabledRef.current,
    );
    const effectiveMs = Math.max(0, effectiveSeconds * 1000);
    effectiveCrossfadeMsRef.current = effectiveMs;
    gpSetCrossfadeDuration(effectiveMs);
    return effectiveMs;
  }, []);

  usePlaybackPersistence({
    queue,
    currentIndex,
    isPlaying,
    shuffle,
    queueRef,
    currentIndexRef,
    currentTimeRef,
    isPlayingRef,
    shuffleRef,
    unshuffledQueueRef,
  });

  const { user: authUser } = useAuth();

  // Flush the pending play-event/history queue only while authenticated.
  // Without this gate we'd burn through retry attempts during the
  // bootstrap window (auth hydrating, user signed out) — every 401 would
  // count toward MAX_ATTEMPTS and telemetry could be dropped before the
  // user ever re-authenticates. `flushQueue` also now preserves 401s
  // without bumping attempts as defense in depth.
  useEffect(() => {
    if (!authUser) return;

    void flushPlayEventQueue();

    const onOnline = () => { void flushPlayEventQueue(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("crate:network-restored", onOnline as EventListener);

    const interval = window.setInterval(() => {
      void flushPlayEventQueue();
    }, 30_000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("crate:network-restored", onOnline as EventListener);
      window.clearInterval(interval);
    };
  }, [authUser]);

  const addToRecentlyPlayed = useCallback((track: Track) => {
    setRecentlyPlayed((prev) => {
      const filtered = prev.filter((t) => t.id !== track.id);
      const updated = [track, ...filtered].slice(0, MAX_RECENT);
      saveRecentlyPlayed(updated);
      return updated;
    });
  }, []);

  const rememberActiveTrack = useCallback((track: Track | undefined) => {
    if (!track) {
      activatedTrackKeyRef.current = null;
      return;
    }
    const trackKey = getTrackCacheKey(track);
    if (activatedTrackKeyRef.current === trackKey) return;
    activatedTrackKeyRef.current = trackKey;
    addToRecentlyPlayed(track);
  }, [addToRecentlyPlayed]);

  const getPlaybackSnapshot = useCallback(() => ({
    currentTime: currentTimeRef.current,
    duration: durationRef.current,
  }), []);

  const {
    startSession: startTrackerSession,
    ensureSession: ensureTrackerSession,
    flushCurrentPlayEvent,
    markSeekPosition,
    recordProgress,
  } = usePlayEventTracker(getPlaybackSnapshot);

  const {
    beginSoftInterruption,
    cancelSoftInterruption,
    scheduleStallProtection,
    clearStallTimer,
    isSoftInterrupted,
  } = useSoftInterruption({
    currentTrackRef,
    isPlayingRef,
    isBufferingRef,
    bufferingIntentRef,
    commitIsBuffering,
  });

  const postTrackHistory = useCallback((track: Track) => {
    void postWithRetry("/api/me/history", {
      track_id: track.libraryTrackId ?? null,
      track_storage_id: track.storageId ?? null,
      track_path: track.path || track.id,
      title: track.title,
      artist: track.artist,
      album: track.album || "",
    });
  }, []);

  /**
   * Read queue/index/duration from the engine and reconcile React state
   * to match. Call after any engine-initiated change (onnext/onprev, or
   * when we've just told the engine something and need to resync).
   *
   * No-op at the state level when nothing actually changed thanks to
   * identity guards — safe to call generously.
   */
  const pullFromEngine = useCallback((sourceQueue?: Track[]) => {
    const resolvedQueue = resolveQueueFromUrls(
      gpGetTracks(),
      sourceQueue ?? queueRef.current,
      engineTrackMapRef.current,
    );
    const resolvedIndex = clampIndex(gpGetTrackIndex(), resolvedQueue.length);
    const resolvedTrack = resolvedQueue[resolvedIndex];
    const resolvedDuration = Math.max(gpGetCurrentTrackDuration() / 1000, 0);

    // Identity guards: avoid spurious state updates + cascading
    // re-renders when the engine just reports the same queue/index
    // we already hold (happens on every onNext, onPrev, onTimeUpdate
    // fallback etc. — most calls are no-ops at the state level).
    const prevQueue = queueRef.current;
    const sameQueue =
      resolvedQueue.length === prevQueue.length &&
      resolvedQueue.every((track, i) => track === prevQueue[i]);
    if (!sameQueue) commitQueue(resolvedQueue);

    if (resolvedIndex !== currentIndexRef.current) {
      commitCurrentIndex(resolvedIndex);
    }
    if (resolvedDuration !== durationRef.current) {
      commitDuration(resolvedDuration);
    }
    rememberActiveTrack(resolvedTrack);

    return {
      resolvedQueue,
      resolvedIndex,
      resolvedTrack,
    };
  }, [commitCurrentIndex, commitDuration, commitQueue, rememberActiveTrack]);

  /**
   * Replace the engine queue + React queue in one shot. Used for changes
   * that need a full reload (shuffle toggle, removing current track,
   * reordering the current track, radio/intelligence insert).
   *
   * For incremental mutations (addToQueue, playNext, removeFromQueue of
   * a non-current track, reordering non-current tracks) prefer the
   * gpInsert/gpRemove helpers — they don't interrupt playback.
   */
  const pushToEngine = useCallback((
    nextQueue: Track[],
    requestedIndex: number,
    options?: { autoplay?: boolean; positionMs?: number },
  ) => {
    const nextIndex = clampIndex(requestedIndex, nextQueue.length);
    const autoplay = options?.autoplay ?? isPlayingRef.current;
    const positionMs = options?.positionMs ?? 0;

    if (nextQueue.length === 0) {
      bufferingIntentRef.current = false;
      gpPause();
      gpLoadQueue([], 0);
      engineTrackMapRef.current = new Map();
      commitQueue([]);
      commitCurrentIndex(0);
      commitCurrentTime(0);
      commitDuration(0);
      commitIsPlaying(false);
      commitIsBuffering(false);
      activatedTrackKeyRef.current = null;
      return;
    }

    gpLoadQueue(buildEngineUrls(nextQueue), nextIndex);
    gpSetLoop(repeatRef.current === "all");
    gpSetSingleMode(repeatRef.current === "one");
    // NOTE: no gpSetShuffle here. The React queue is the source of truth
    // for play order; loadQueue normalizes Gapless's shuffledIndices so
    // the engine plays our list sequentially in the exact order passed.

    // Commits queue/index/duration internally.
    pullFromEngine(nextQueue);

    if (positionMs > 0) {
      gpSeekTo(positionMs);
      const positionSeconds = positionMs / 1000;
      commitCurrentTime(positionSeconds);
      markSeekPosition(positionSeconds);
    } else {
      commitCurrentTime(0);
    }

    if (autoplay) {
      bufferingIntentRef.current = true;
      commitIsBuffering(true);
      gpPlay();
    } else {
      bufferingIntentRef.current = false;
      gpPause();
      commitIsPlaying(false);
      commitIsBuffering(false);
    }
  }, [
    commitCurrentTime,
    commitIsBuffering,
    commitIsPlaying,
    commitQueue,
    commitCurrentIndex,
    commitDuration,
    buildEngineUrls,
    markSeekPosition,
    pullFromEngine,
  ]);

  /**
   * Advance the React cursor to a new index. Caller is responsible for
   * moving the engine (gpNext/gpPrev/gpGotoTrack) BEFORE calling this so
   * the duration read is from the new track.
   */
  const advanceCursorTo = useCallback((index: number) => {
    clearPrevRestartLatch();
    commitCurrentIndex(index);
    commitCurrentTime(0);
    commitDuration(Math.max(gpGetCurrentTrackDuration() / 1000, 0));
    rememberActiveTrack(queueRef.current[index]);
    bufferingIntentRef.current = true;
    commitIsBuffering(true);
  }, [clearPrevRestartLatch, commitCurrentIndex, commitCurrentTime, commitDuration, commitIsBuffering, rememberActiveTrack]);

  // Domain-level actions for usePlaybackIntelligence. Verb-oriented
  // instead of raw state setters — the hook no longer needs to reason
  // about engine sync, de-duplication or playback sequencing.
  const appendIntelligenceTracks = useCallback((tracks: Track[]) => {
    const queue = queueRef.current;
    const existingKeys = new Set(
      [...queue, ...recentlyPlayed].map((t) => getTrackCacheKey(t)),
    );
    const unique: Track[] = [];
    for (const track of tracks) {
      const key = getTrackCacheKey(track);
      if (!key || existingKeys.has(key)) continue;
      existingKeys.add(key);
      unique.push(track);
    }
    if (unique.length === 0) return;

    const nextQueue = [...queue, ...unique];
    for (const track of unique) {
      gpAddTrack(registerEngineTrack(track));
    }
    commitQueue(nextQueue);

    // Keep the un-shuffled snapshot in sync so restoring original order
    // later (toggle shuffle off / reload after shuffle-on session) doesn't
    // silently drop radio-refill or continuation tracks fetched while
    // shuffle was active.
    if (unshuffledQueueRef.current) {
      unshuffledQueueRef.current = [...unshuffledQueueRef.current, ...unique];
    }
  }, [commitQueue, recentlyPlayed, registerEngineTrack]);

  const insertSuggestionAfterCurrent = useCallback((candidates: Track[]) => {
    const queue = queueRef.current;
    const insertionIndex = currentIndexRef.current + 1;
    if (insertionIndex <= 0 || insertionIndex > queue.length) return;
    if (queue[insertionIndex]?.isSuggested) return;

    const existingKeys = new Set(
      [...queue, ...recentlyPlayed].map((t) => getTrackCacheKey(t)),
    );
    const suggestion = candidates.find((t) => {
      const k = getTrackCacheKey(t);
      return !!k && !existingKeys.has(k);
    });
    if (!suggestion) return;

    const marked: Track = {
      ...suggestion,
      isSuggested: true,
      suggestionSource: "playlist",
    };
    const nextQueue = [...queue];
    nextQueue.splice(insertionIndex, 0, marked);
    gpInsertTrack(insertionIndex, registerEngineTrack(marked));
    commitQueue(nextQueue);

    // Mirror into the un-shuffled snapshot. We don't know where the
    // suggestion would live in the original sequence, so we append it
    // at the end — good enough for restore fidelity (no track lost).
    if (unshuffledQueueRef.current) {
      unshuffledQueueRef.current = [...unshuffledQueueRef.current, marked];
    }
  }, [commitQueue, recentlyPlayed, registerEngineTrack]);

  const appendAndAdvance = useCallback((tracks: Track[]) => {
    const queue = queueRef.current;
    const existingKeys = new Set(
      [...queue, ...recentlyPlayed].map((t) => getTrackCacheKey(t)),
    );
    const unique: Track[] = [];
    for (const track of tracks) {
      const key = getTrackCacheKey(track);
      if (!key || existingKeys.has(key)) continue;
      existingKeys.add(key);
      unique.push(track);
    }
    if (unique.length === 0) {
      commitIsBuffering(false);
      return;
    }

    const nextQueue = [...queue, ...unique];
    for (const track of unique) {
      gpAddTrack(registerEngineTrack(track));
    }
    commitQueue(nextQueue);

    // Mirror into the un-shuffled snapshot so shuffle-off/reload
    // doesn't drop the freshly-fetched continuation tracks.
    if (unshuffledQueueRef.current) {
      unshuffledQueueRef.current = [...unshuffledQueueRef.current, ...unique];
    }

    // Advance to the first newly appended track. The old session is
    // ending by user request (they hit next at the end of the album),
    // so flush it explicitly before starting the new one.
    const nextIndex = queue.length;
    const outgoing = queueRef.current[currentIndexRef.current];
    flushCurrentPlayEvent("skipped", outgoing);
    gpGotoTrack(nextIndex, true);
    advanceCursorTo(nextIndex);
    const incoming = nextQueue[nextIndex];
    if (incoming) startTrackerSession(incoming, playSourceRef.current);
    commitIsPlaying(true);
  }, [
    advanceCursorTo,
    commitIsBuffering,
    commitIsPlaying,
    commitQueue,
    flushCurrentPlayEvent,
    recentlyPlayed,
    registerEngineTrack,
    startTrackerSession,
  ]);

  const {
    continueInfinitePlayback,
    resetPlaybackIntelligence,
  } = usePlaybackIntelligence({
    queue,
    currentIndex,
    isPlaying,
    playSource,
    shuffle,
    infinitePlaybackEnabled,
    smartPlaylistSuggestionsEnabled,
    smartPlaylistSuggestionsCadence,
    recentlyPlayed,
    actions: {
      appendTracks: appendIntelligenceTracks,
      insertSuggestionAfterCurrent,
      appendAndAdvance,
      setBuffering: commitIsBuffering,
    },
  });

  useEffect(() => {
    const onPrefsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{
        crossfadeSeconds?: number;
        smartCrossfadeEnabled?: boolean;
        infinitePlaybackEnabled?: boolean;
        smartPlaylistSuggestionsEnabled?: boolean;
        smartPlaylistSuggestionsCadence?: number;
      }>).detail;
      syncEffectiveCrossfade();
      if (typeof detail?.smartCrossfadeEnabled === "boolean") {
        setSmartCrossfadeEnabled(detail.smartCrossfadeEnabled);
      } else {
        setSmartCrossfadeEnabled(getSmartCrossfadePreference());
      }
      if (typeof detail?.infinitePlaybackEnabled === "boolean") {
        setInfinitePlaybackEnabled(detail.infinitePlaybackEnabled);
      } else {
        setInfinitePlaybackEnabled(getInfinitePlaybackPreference());
      }
      if (typeof detail?.smartPlaylistSuggestionsEnabled === "boolean") {
        setSmartPlaylistSuggestionsEnabled(detail.smartPlaylistSuggestionsEnabled);
      } else {
        setSmartPlaylistSuggestionsEnabled(getSmartPlaylistSuggestionsPreference());
      }
      if (typeof detail?.smartPlaylistSuggestionsCadence === "number") {
        setSmartPlaylistSuggestionsCadence(detail.smartPlaylistSuggestionsCadence);
      } else {
        setSmartPlaylistSuggestionsCadence(getSmartPlaylistSuggestionsCadencePreference());
      }
    };

    window.addEventListener(PLAYER_PLAYBACK_PREFS_EVENT, onPrefsChanged as EventListener);
    return () => {
      window.removeEventListener(PLAYER_PLAYBACK_PREFS_EVENT, onPrefsChanged as EventListener);
    };
  }, [syncEffectiveCrossfade]);

  useEffect(() => {
    syncEffectiveCrossfade();
  }, [syncEffectiveCrossfade, queue, currentIndex, playSource, repeat, shuffle, smartCrossfadeEnabled]);

  const {
    pendingRestoreTimeRef,
    resumeAfterReloadRef,
    tryRestoreAutoplay,
    cancelRestoreAutoplay,
  } = useRestoreOnMount({
    isPlayingRef,
    queueRef,
    repeatRef,
    bufferingIntentRef,
    buildEngineUrls,
    pullFromEngine,
    commitIsBuffering,
    commitCurrentTime,
    markSeekPosition,
  });

  // Populate the ref the engine proxy reads. Re-assigning here on every
  // render keeps the closures capturing fresh state without re-
  // registering listeners (the proxy was installed once on first render).
  callbacksRef.current = {
      onTimeUpdate: (positionMs, trackIndex) => {
        const positionSeconds = positionMs / 1000;
        clearStallTimer();
        commitCurrentTime(positionSeconds);
        recordProgress(positionSeconds);
        // Safety net: if the engine's trackIndex diverges from ours
        // (shouldn't happen — onnext/onprev already sync it), realign.
        if (trackIndex !== currentIndexRef.current && trackIndex >= 0) {
          pullFromEngine();
        }
      },
      onDurationChange: (durationMs) => {
        commitDuration(Math.max(durationMs / 1000, 0));
      },
      onLoad: (_path, _fullyLoaded, durationMs) => {
        const durationSeconds = Math.max(durationMs / 1000, 0);
        if (durationSeconds > 0) {
          commitDuration(durationSeconds);
        }
        clearPrevRestartLatch();
        if (pendingRestoreTimeRef.current > 0) {
          gpSeekTo(pendingRestoreTimeRef.current * 1000);
          commitCurrentTime(pendingRestoreTimeRef.current);
          markSeekPosition(pendingRestoreTimeRef.current);
          pendingRestoreTimeRef.current = 0;
        }
        if (!isPlayingRef.current) {
          commitIsBuffering(false);
        }
        bufferingIntentRef.current = false;
        clearStallTimer();
        tryRestoreAutoplay();
      },
      onPlayRequest: () => {
        bufferingIntentRef.current = true;
      },
      onPlay: () => {
        // Note: onnext/onprev already sync the engine selection before
        // onPlay fires, so no sync needed here — just flip UI state.
        resumeAfterReloadRef.current = false;
        cancelRestoreAutoplay();
        cancelSoftInterruption();
        commitIsPlaying(true);
        commitIsBuffering(false);
        bufferingIntentRef.current = false;
        // Safety net: if nothing else arranged a tracker session
        // (e.g. restore autoplay where no user-driven transition fired),
        // start one for whatever the engine is actually playing.
        ensureTrackerSession(currentTrackRef.current, playSourceRef.current);
      },
      onPause: () => {
        if (bufferingIntentRef.current && isPlayingRef.current) {
          commitIsBuffering(true);
          return;
        }
        if (isSoftInterrupted()) {
          commitIsPlaying(false);
          commitIsBuffering(true);
          return;
        }
        clearStallTimer();
        commitIsPlaying(false);
        commitIsBuffering(false);
        bufferingIntentRef.current = false;
      },
      onPrev: () => {
        clearPrevRestartLatch();
        commitCurrentTime(0);
        commitDuration(Math.max(gpGetCurrentTrackDuration() / 1000, 0));
        pullFromEngine();
        bufferingIntentRef.current = false;
        commitIsBuffering(false);
        clearStallTimer();
      },
      onNext: (fromPath, toPath) => {
        clearPrevRestartLatch();
        // Capture the outgoing duration BEFORE we overwrite durationRef
        // with the incoming's length — UI components need it for the
        // progress-bar-stays-on-outgoing trick during the crossfade.
        const outgoingDurationSeconds = durationRef.current;

        commitCurrentTime(0);
        commitDuration(Math.max(gpGetCurrentTrackDuration() / 1000, 0));
        pullFromEngine();

        // Visual crossfade: if audio crossfade is enabled and we have
        // both ends of the transition, emit a transition record so the
        // UI can fade artwork/title between outgoing and incoming AND
        // keep the progress bar coherent with the still-audible outgoing.
        const crossfadeMs = effectiveCrossfadeMsRef.current;
        if (crossfadeMs > 0) {
          const outgoing = engineTrackMapRef.current.get(fromPath)?.[0];
          const incoming = engineTrackMapRef.current.get(toPath)?.[0];
          if (outgoing && incoming) {
            if (crossfadeTimerRef.current != null) {
              window.clearTimeout(crossfadeTimerRef.current);
            }
            setCrossfadeTransition({
              outgoing,
              incoming,
              durationMs: crossfadeMs,
              startedAt: performance.now(),
              outgoingDurationSeconds,
            });
            crossfadeTimerRef.current = window.setTimeout(() => {
              setCrossfadeTransition(null);
              crossfadeTimerRef.current = null;
            }, crossfadeMs);
          }
        }
      },
      onTrackFinished: (path) => {
        // During a crossfade auto-advance, Gapless-5 fires onnext BEFORE
        // onfinishedtrack, so React state may already point to the incoming
        // track. We resolve the outgoing track via engineTrackMap (captured
        // at load time — buckets preserve multiplicity across duplicates,
        // and the URL is stable across token/base-URL rotation).
        const bucket = engineTrackMapRef.current.get(path);
        const endedTrack =
          bucket?.[0] ??
          queueRef.current.find((t) => getStreamUrl(t) === path);
        if (!endedTrack) return;

        // IMPORTANT: flush BEFORE we start the next session. Because
        // session rotation is now explicit (no useEffect magic), these
        // two calls are atomic regardless of React's render timing —
        // the completion is always credited to the outgoing track and
        // the new session starts clean for the incoming one.
        flushCurrentPlayEvent("completed", endedTrack);
        postTrackHistory(endedTrack);

        const incoming = currentTrackRef.current;
        if (incoming) startTrackerSession(incoming, playSourceRef.current);
      },
      onAllFinished: () => {
        resumeAfterReloadRef.current = false;
        cancelRestoreAutoplay();
        cancelSoftInterruption();
        commitIsPlaying(false);
        commitIsBuffering(false);
        bufferingIntentRef.current = false;
      },
      onError: (path, err) => {
        // Gapless-5 pre-loads upcoming tracks (controlled by loadLimit).
        // When the user loses connectivity, the XHR for the next track
        // can fail while the current track is happily playing from its
        // already-decoded WebAudio buffer in RAM. Escalating that
        // failure as a soft interruption would stop the audio the user
        // is actually listening to — so we filter errors by checking
        // whether they're on the current track at all.
        const currentTrack = currentTrackRef.current;
        const currentPath = currentTrack ? getStreamUrl(currentTrack) : null;
        if (currentPath && path && path !== currentPath) {
          console.warn("[gapless] preload error ignored (non-current track):", path, err);
          return;
        }
        // Also ignore when the current track is fully buffered in
        // WebAudio: the audio comes from RAM and the error is from a
        // dormant stream handle that we don't need any more.
        if (isCurrentTrackFullyBuffered()) {
          console.warn("[gapless] error ignored (current track fully buffered):", path, err);
          return;
        }
        console.error("[gapless] error:", err);
        cancelRestoreAutoplay();
        void isRuntimeOnline().then((online) => {
          beginSoftInterruption(online ? "stream" : "offline");
        });
      },
      onBuffering: () => {
        if (bufferingIntentRef.current || isPlayingRef.current) {
          commitIsBuffering(true);
        }
        scheduleStallProtection();
      },
      onAnalyserReady: () => {
        setAnalyserVersion((version) => version + 1);
      },
  };

  // Engine already booted synchronously at render body; initialize
  // volume from the stored preference.
  useEffect(() => {
    gpSetVolume(volume);
  }, [volume]);

  useEffect(() => {
    gpSetLoop(repeat === "all");
    gpSetSingleMode(repeat === "one");
  }, [repeat]);

  // NOTE: no gpSetShuffle effect. Shuffle is handled in React by reordering
  // the queue in toggleShuffle(); the engine always plays sequentially.
  //
  // The restore-on-mount flow + autoplay timeout live in useRestoreOnMount.
  // Online/offline listeners + stall timers live in useSoftInterruption.

  // Clean up the crossfade visual-transition timer on unmount.
  useEffect(() => () => {
    if (crossfadeTimerRef.current != null) {
      window.clearTimeout(crossfadeTimerRef.current);
      crossfadeTimerRef.current = null;
    }
  }, []);

  const startQueuePlayback = useCallback((tracks: Track[], startIndex: number, source?: PlaySource) => {
    if (!tracks.length) return;
    const normalizedIndex = clampIndex(startIndex, tracks.length);

    cancelSoftInterruption();
    pendingRestoreTimeRef.current = 0;
    resumeAfterReloadRef.current = false;
    cancelRestoreAutoplay();
    resetPlaybackIntelligence();
    flushCurrentPlayEvent("interrupted");

    // Load engine first; pullFromEngine commits queue/index/duration.
    // No gpSetShuffle: caller already passed tracks in desired play order
    // (shuffled or not), and loadQueue normalizes shuffledIndices.
    gpLoadQueue(buildEngineUrls(tracks), normalizedIndex);
    gpSetLoop(repeatRef.current === "all");
    gpSetSingleMode(repeatRef.current === "one");

    commitCurrentTime(0);
    commitIsBuffering(true);
    const nextSource = source || (tracks.length > 1
      ? { type: "queue" as const, name: "Queue" }
      : { type: "track" as const, name: tracks[normalizedIndex]!.title });
    setPlaySource(nextSource);

    const { resolvedTrack } = pullFromEngine(tracks);
    if (resolvedTrack) {
      rememberActiveTrack(resolvedTrack);
      startTrackerSession(resolvedTrack, nextSource);
    }

    bufferingIntentRef.current = true;
    gpPlay();
  }, [
    buildEngineUrls,
    cancelSoftInterruption,
    cancelRestoreAutoplay,
    commitCurrentTime,
    commitIsBuffering,
    flushCurrentPlayEvent,
    rememberActiveTrack,
    resetPlaybackIntelligence,
    pullFromEngine,
    startTrackerSession,
  ]);

  const play = useCallback((track: Track, source?: PlaySource) => {
    startQueuePlayback([track], 0, source || { type: "track", name: track.title });
  }, [startQueuePlayback]);

  const playAll = useCallback((tracks: Track[], startIndex = 0, source?: PlaySource) => {
    if (!tracks.length) return;
    const track = tracks[clampIndex(startIndex, tracks.length)];
    if (!track) return;
    startQueuePlayback(
      tracks,
      startIndex,
      source || (tracks.length > 1 ? { type: "queue", name: "Queue" } : { type: "track", name: track.title }),
    );
  }, [startQueuePlayback]);

  const pause = useCallback(() => {
    cancelSoftInterruption();
    bufferingIntentRef.current = false;
    commitIsBuffering(false);
    void gpFadeOutAndPause(SOFT_PAUSE_FADE_MS).catch(() => {
      gpPause();
    });
  }, [cancelSoftInterruption, commitIsBuffering]);

  const resume = useCallback(() => {
    if (!queueRef.current.length) return;
    cancelSoftInterruption();
    bufferingIntentRef.current = true;
    commitIsBuffering(true);
    void gpFadeInAndPlay(SOFT_PAUSE_FADE_MS).catch(() => {
      gpRestoreVolume();
      gpPlay();
    });
  }, [cancelSoftInterruption, commitIsBuffering]);

  const advanceToTrack = useCallback((targetIndex: number) => {
    const outgoing = queueRef.current[currentIndexRef.current];
    flushCurrentPlayEvent("skipped", outgoing);
    // Engine side handled by caller (gpNext/gpPrev/gpGotoTrack).
    advanceCursorTo(targetIndex);
    const incoming = queueRef.current[targetIndex];
    if (incoming) startTrackerSession(incoming, playSourceRef.current);
  }, [advanceCursorTo, flushCurrentPlayEvent, startTrackerSession]);

  const next = useCallback(() => {
    if (!queueRef.current.length) return;

    const nextIndex = currentIndexRef.current + 1;
    if (nextIndex < queueRef.current.length) {
      // Sequential skip: gpNext() preserves crossfade via Gapless-5's
      // native next() path (crossfadeEnabled=true).
      gpNext();
      advanceToTrack(nextIndex);
      return;
    }

    if (repeatRef.current === "all" && queueRef.current.length > 0) {
      // Wrapping to index 0 is a jump, not a sequential skip — no crossfade.
      gpGotoTrack(0, true);
      advanceToTrack(0);
      return;
    }

    if (continueInfinitePlayback()) {
      flushCurrentPlayEvent("skipped", queueRef.current[currentIndexRef.current]);
      // The continuation hook advances the cursor itself via appendAndAdvance,
      // which must restart the tracker when it lands — handled via onPlay.
    }
  }, [advanceToTrack, continueInfinitePlayback, flushCurrentPlayEvent]);

  const prev = useCallback(() => {
    if (!queueRef.current.length) return;
    const currentTrack = queueRef.current[currentIndexRef.current];
    const currentTrackKey = currentTrack ? getTrackCacheKey(currentTrack) : null;
    const now = performance.now();
    const justRestartedCurrentTrack =
      !!currentTrackKey &&
      prevRestartTrackKeyRef.current === currentTrackKey &&
      now - prevRestartedAtRef.current < PREV_DOUBLE_TAP_WINDOW_MS;
    const currentPositionSeconds = Math.max(currentTimeRef.current, gpGetPosition() / 1000);

    if (shouldRestartTrackBeforePrev({
      currentTimeSeconds: currentPositionSeconds,
      justRestartedCurrentTrack,
    })) {
      gpSeekTo(0);
      commitCurrentTime(0);
      markSeekPosition(0);
      prevRestartTrackKeyRef.current = currentTrackKey;
      prevRestartedAtRef.current = now;
      bufferingIntentRef.current = false;
      commitIsBuffering(false);
      return;
    }

    if (currentIndexRef.current > 0) {
      // Use gpGotoTrack instead of gpPrev: Gapless-5's prev() has its
      // own "restart if position > 0" guard that conflicts with ours —
      // after React seeks to 0, a few ms of playback elapse before the
      // second press, so the engine's position > 0 check fires and it
      // restarts the current track instead of going to the previous one,
      // while React still advances the cursor → engine/React desync.
      const targetIndex = currentIndexRef.current - 1;
      clearPrevRestartLatch();
      gpGotoTrack(targetIndex, true);
      advanceToTrack(targetIndex);
      return;
    }

    if (repeatRef.current === "all" && queueRef.current.length > 0) {
      const wrappedIndex = queueRef.current.length - 1;
      clearPrevRestartLatch();
      gpGotoTrack(wrappedIndex, true);
      advanceToTrack(wrappedIndex);
    }
  }, [advanceToTrack, clearPrevRestartLatch, commitCurrentTime, commitIsBuffering, markSeekPosition]);

  const seek = useCallback((time: number) => {
    const shouldResumeBufferingFlow = isPlayingRef.current;
    bufferingIntentRef.current = shouldResumeBufferingFlow;
    gpSeekTo(time * 1000);
    commitCurrentTime(time);
    commitIsBuffering(shouldResumeBufferingFlow);
    markSeekPosition(time);
  }, [commitCurrentTime, commitIsBuffering, markSeekPosition]);

  const setVolume = useCallback((vol: number) => {
    gpSetVolume(vol);
    setVolumeState(vol);
    if (vol > 0) {
      lastNonZeroVolumeRef.current = vol;
    }
    try {
      localStorage.setItem("listen-player-volume", String(vol));
    } catch {
      /* ignore */
    }
  }, []);

  const clearQueue = useCallback(() => {
    cancelSoftInterruption();
    pendingRestoreTimeRef.current = 0;
    resumeAfterReloadRef.current = false;
    cancelRestoreAutoplay();
    bufferingIntentRef.current = false;
    resetPlaybackIntelligence();
    flushCurrentPlayEvent("interrupted");
    gpPause();
    gpLoadQueue([], 0);
    engineTrackMapRef.current = new Map();
    commitQueue([]);
    commitCurrentIndex(0);
    commitCurrentTime(0);
    commitDuration(0);
    commitIsPlaying(false);
    commitIsBuffering(false);
    setPlaySource(null);
    activatedTrackKeyRef.current = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [
    cancelSoftInterruption,
    cancelRestoreAutoplay,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsBuffering,
    commitIsPlaying,
    commitQueue,
    flushCurrentPlayEvent,
    resetPlaybackIntelligence,
  ]);

  const toggleShuffle = useCallback(() => {
    const prevQueue = queueRef.current;
    if (!prevQueue.length) {
      setShuffleState((value) => !value);
      return;
    }

    const enabling = !shuffleRef.current;
    const currentTrack = prevQueue[currentIndexRef.current];

    if (enabling) {
      // Save the original order so we can restore it on toggle-off.
      unshuffledQueueRef.current = prevQueue.slice();
      const nextQueue = shuffleKeepingCurrent(prevQueue, currentIndexRef.current);

      setShuffleState(true);
      pushToEngine(nextQueue, 0, {
        autoplay: isPlayingRef.current,
        positionMs: gpGetPosition(),
      });
      return;
    }

    // Disabling: restore original order, keeping current track pointer.
    const original = unshuffledQueueRef.current ?? prevQueue;
    unshuffledQueueRef.current = null;
    const nextIndex = currentTrack
      ? Math.max(0, original.findIndex((t) => getTrackCacheKey(t) === getTrackCacheKey(currentTrack)))
      : 0;

    setShuffleState(false);
    pushToEngine(original, nextIndex, {
      autoplay: isPlayingRef.current,
      positionMs: gpGetPosition(),
    });
  }, [pushToEngine]);

  const cycleRepeat = useCallback(() => {
    setRepeatState((prevMode) => {
      if (prevMode === "off") return "all";
      if (prevMode === "all") return "one";
      return "off";
    });
  }, []);

  const jumpTo = useCallback((index: number) => {
    if (index < 0 || index >= queueRef.current.length) return;
    pendingRestoreTimeRef.current = 0;
    gpGotoTrack(index, true);
    advanceToTrack(index);
    commitIsPlaying(true);
  }, [advanceToTrack, commitIsPlaying]);

  const playNext = useCallback((track: Track) => {
    // Insert at currentIndex + 1 without reloading the queue, so the
    // currently playing track keeps playing uninterrupted.
    const insertAt = currentIndexRef.current + 1;
    const nextQueue = [...queueRef.current];
    nextQueue.splice(insertAt, 0, track);

    gpInsertTrack(insertAt, registerEngineTrack(track));
    commitQueue(nextQueue);

    // Keep the un-shuffled snapshot in sync so restoring original order
    // later doesn't silently drop this track. We don't know the original
    // position so append it at the end — good enough for restore fidelity.
    if (unshuffledQueueRef.current) {
      unshuffledQueueRef.current = [...unshuffledQueueRef.current, track];
    }
  }, [commitQueue, registerEngineTrack]);

  const addToQueue = useCallback((track: Track) => {
    // Append without reloading.
    const nextQueue = [...queueRef.current, track];
    gpAddTrack(registerEngineTrack(track));
    commitQueue(nextQueue);

    if (unshuffledQueueRef.current) {
      unshuffledQueueRef.current = [...unshuffledQueueRef.current, track];
    }
  }, [commitQueue, registerEngineTrack]);

  const removeFromQueue = useCallback((index: number) => {
    const prevQueue = queueRef.current;
    if (index < 0 || index >= prevQueue.length) return;

    const removedTrack = prevQueue[index];
    const removingCurrent = index === currentIndexRef.current;
    const nextQueue = prevQueue.filter((_, queueIndex) => queueIndex !== index);

    // Keep the un-shuffled snapshot in sync by removing the same Track
    // reference (positions don't align between shuffled and original).
    if (unshuffledQueueRef.current && removedTrack) {
      const removedKey = getTrackCacheKey(removedTrack);
      unshuffledQueueRef.current = unshuffledQueueRef.current.filter(
        (t) => getTrackCacheKey(t) !== removedKey,
      );
    }

    if (removingCurrent) {
      flushCurrentPlayEvent("skipped");
      // Removing the currently playing track: recreate the engine queue,
      // so playback advances to the next valid item.
      const nextIndex = Math.min(currentIndexRef.current, nextQueue.length - 1);
      pushToEngine(nextQueue, nextIndex, {
        autoplay: isPlayingRef.current && nextQueue.length > 0,
        positionMs: 0,
      });
      return;
    }

    // Removing a non-current track: use incremental op, keep playback.
    gpRemoveTrack(index);
    if (removedTrack) unregisterEngineTrack(removedTrack);
    const nextIndex =
      index < currentIndexRef.current
        ? currentIndexRef.current - 1
        : currentIndexRef.current;
    commitQueue(nextQueue);
    if (nextIndex !== currentIndexRef.current) {
      commitCurrentIndex(nextIndex);
    }
  }, [commitCurrentIndex, commitQueue, flushCurrentPlayEvent, pushToEngine, unregisterEngineTrack]);

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    const prevQueue = queueRef.current;
    if (
      fromIndex < 0 ||
      fromIndex >= prevQueue.length ||
      toIndex < 0 ||
      toIndex >= prevQueue.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const nextQueue = [...prevQueue];
    const [moved] = nextQueue.splice(fromIndex, 1);
    if (!moved) return;
    nextQueue.splice(toIndex, 0, moved);

    // Any manual reorder during shuffle invalidates the "original order"
    // snapshot — the new manual layout becomes the user's intent, so
    // disabling shuffle afterwards keeps this order instead of jumping
    // back to a stale pre-shuffle arrangement.
    if (unshuffledQueueRef.current) {
      unshuffledQueueRef.current = null;
    }

    const currentIdx = currentIndexRef.current;
    const movingCurrent = fromIndex === currentIdx;

    // If we're moving the currently playing track, a full reload is
    // unavoidable (Gapless-5 can't move a playing source without
    // tearing it down). Fall back to pushToEngine with position
    // preservation so we resume from the same spot.
    if (movingCurrent) {
      pushToEngine(nextQueue, toIndex, {
        autoplay: isPlayingRef.current,
        positionMs: gpGetPosition(),
      });
      return;
    }

    // Incremental reorder: remove + insert on the engine without
    // touching the currently playing source. Playback continues
    // uninterrupted. Unregister first so the identity map stays in
    // sync; registerEngineTrack re-adds at the new slot.
    gpRemoveTrack(fromIndex);
    unregisterEngineTrack(moved);
    gpInsertTrack(toIndex, registerEngineTrack(moved));

    let nextIndex = currentIdx;
    if (fromIndex < currentIdx && toIndex >= currentIdx) {
      nextIndex = currentIdx - 1;
    } else if (fromIndex > currentIdx && toIndex <= currentIdx) {
      nextIndex = currentIdx + 1;
    }

    commitQueue(nextQueue);
    if (nextIndex !== currentIdx) {
      commitCurrentIndex(nextIndex);
    }
  }, [commitCurrentIndex, commitQueue, registerEngineTrack, pushToEngine, unregisterEngineTrack]);

  usePlayerShortcuts({
    hasCurrentTrack: !!currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    lastNonZeroVolume: lastNonZeroVolumeRef.current,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
  });

  useMediaSession({ currentTrack, isPlaying, currentTime, duration, pause, resume, next, prev, seek });

  const stateValue = useMemo<PlayerStateValue>(
    () => ({ currentTime, duration, isPlaying, isBuffering, volume, analyserVersion, crossfadeTransition }),
    [analyserVersion, crossfadeTransition, currentTime, duration, isPlaying, isBuffering, volume],
  );

  const actionsValue = useMemo<PlayerActionsValue>(
    () => ({
      queue,
      currentIndex,
      shuffle,
      playSource,
      repeat,
      smartCrossfadeEnabled,
      recentlyPlayed,
      currentTrack,
      play,
      playAll,
      pause,
      resume,
      next,
      prev,
      seek,
      setVolume,
      clearQueue,
      toggleShuffle,
      cycleRepeat,
      jumpTo,
      playNext,
      addToQueue,
      removeFromQueue,
      reorderQueue,
    }),
    [
      queue,
      currentIndex,
      shuffle,
      playSource,
      repeat,
      smartCrossfadeEnabled,
      recentlyPlayed,
      currentTrack,
      play,
      playAll,
      pause,
      resume,
      next,
      prev,
      seek,
      setVolume,
      clearQueue,
      toggleShuffle,
      cycleRepeat,
      jumpTo,
      playNext,
      addToQueue,
      removeFromQueue,
      reorderQueue,
    ],
  );

  return (
    <PlayerActionsContext.Provider value={actionsValue}>
      <PlayerStateContext.Provider value={stateValue}>
        {children}
      </PlayerStateContext.Provider>
    </PlayerActionsContext.Provider>
  );
}
