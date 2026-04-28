import { useCallback, useRef } from "react";

import type { PlaySource, Track } from "@/contexts/player-types";
import { getTrackCacheKey } from "@/contexts/player-utils";
import { postWithRetry } from "@/lib/play-event-queue";

interface PlayEventSession {
  trackKey: string;
  track: Track;
  playSource: PlaySource | null;
  startedAt: string;
  trackDurationSeconds: number | null;
  lastKnownTime: number;
  listenedSeconds: number;
  maxProgressSeconds: number;
}

type FlushReason = "completed" | "skipped" | "interrupted";

const PLAY_EVENT_MIN_SECONDS = 2;
const PLAY_EVENT_DELTA_CAP_SECONDS = 5;

function nowIso(): string {
  return new Date().toISOString();
}

function generateClientEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildSession(
  track: Track,
  source: PlaySource | null,
  snapshot: { currentTime: number; duration: number },
): PlayEventSession {
  return {
    trackKey: getTrackCacheKey(track),
    track,
    playSource: source,
    startedAt: nowIso(),
    trackDurationSeconds:
      Number.isFinite(snapshot.duration) && snapshot.duration > 0 ? snapshot.duration : null,
    lastKnownTime: snapshot.currentTime || 0,
    listenedSeconds: 0,
    maxProgressSeconds: snapshot.currentTime || 0,
  };
}

function dispatchPlayEvent(session: PlayEventSession, reason: FlushReason) {
  const trackDurationSeconds = session.trackDurationSeconds;
  const playedSeconds = Math.max(0, session.listenedSeconds);

  if (playedSeconds < PLAY_EVENT_MIN_SECONDS && reason !== "completed") {
    return;
  }

  const completionRatio = trackDurationSeconds && trackDurationSeconds > 0
    ? Math.min(1, playedSeconds / trackDurationSeconds)
    : null;
  const wasCompleted = reason === "completed";
  const wasSkipped = reason === "skipped";

  void postWithRetry("/api/me/play-events", {
    client_event_id: generateClientEventId(),
    track_id: session.track.libraryTrackId ?? null,
    track_storage_id: session.track.storageId ?? null,
    track_path: session.track.path || session.track.id,
    title: session.track.title,
    artist: session.track.artist,
    album: session.track.album || "",
    started_at: session.startedAt,
    ended_at: nowIso(),
    played_seconds: playedSeconds,
    track_duration_seconds: trackDurationSeconds,
    completion_ratio: completionRatio,
    was_skipped: wasSkipped,
    was_completed: wasCompleted,
    play_source_type: session.playSource?.type ?? null,
    play_source_id: session.playSource?.id != null ? String(session.playSource.id) : null,
    play_source_name: session.playSource?.name ?? null,
    context_artist: session.track.artist,
    context_album: session.track.album || null,
    context_playlist_id:
      session.playSource?.type === "playlist" && typeof session.playSource.id === "number"
        ? session.playSource.id
        : null,
    device_type: "web",
    app_platform: "listen-web",
  });
}

/**
 * Tracks listening time + attribution for the currently active track.
 *
 * ## Session lifecycle is EXPLICIT
 *
 * Earlier versions rotated the session implicitly via a useEffect on
 * `currentTrack`. That was fragile: during a natural crossfade, Gapless
 * fires onnext BEFORE onfinishedtrack, so the engine (and our React
 * state) advances to the incoming track before the outgoing one has
 * emitted its completion event. If React processed the useEffect
 * between those two engine callbacks, the outgoing track's completion
 * would either be mis-attributed to the incoming song, or dropped by
 * the expectedTrack guard.
 *
 * Now the caller controls rotation explicitly:
 *   - `startSession(track, source)` — begin a new session. If one was
 *     already active for the same trackKey, updates its source only.
 *   - `flushCurrentPlayEvent(reason, expectedTrack?)` — end the current
 *     session and POST the event. expectedTrack stays as a defensive
 *     guard against bugs in the caller's lifecycle.
 *   - `rotateSession(reason, expectedTrack, nextTrack, nextSource)` —
 *     atomically flush the outgoing session and seed the next one
 *     without leaving a gap where incoming progress could be dropped.
 *
 * In practice the Context now calls `rotateSession(...)` from
 * `onTrackFinished`, keeping the completion flush and the next session
 * handoff in a single step.
 */
export function usePlayEventTracker(
  getPlaybackSnapshot: () => { currentTime: number; duration: number },
) {
  const sessionRef = useRef<PlayEventSession | null>(null);

  const startSession = useCallback(
    (track: Track | undefined, source: PlaySource | null) => {
      if (!track) {
        sessionRef.current = null;
        return;
      }
      const trackKey = getTrackCacheKey(track);
      const existing = sessionRef.current;
      if (existing?.trackKey === trackKey) {
        // Same track — just refresh the source context.
        existing.playSource = source;
        return;
      }
      const snapshot = getPlaybackSnapshot();
      sessionRef.current = buildSession(track, source, snapshot);
    },
    [getPlaybackSnapshot],
  );

  const flushCurrentPlayEvent = useCallback((reason: FlushReason, expectedTrack?: Track) => {
    const session = sessionRef.current;
    if (!session) return;
    if (expectedTrack) {
      // Defensive: if the caller names the track it expects to flush
      // and the active session is for a different track, drop the flush
      // rather than credit the wrong song. A passing guard means our
      // session rotation is correctly ordered.
      const expectedKey = getTrackCacheKey(expectedTrack);
      if (session.trackKey !== expectedKey) return;
    }
    sessionRef.current = null;
    dispatchPlayEvent(session, reason);
  }, []);

  const rotateSession = useCallback(
    (
      reason: FlushReason,
      expectedTrack: Track | undefined,
      nextTrack: Track | undefined,
      nextSource: PlaySource | null,
    ) => {
      const session = sessionRef.current;
      if (!session) {
        if (nextTrack) {
          sessionRef.current = buildSession(nextTrack, nextSource, getPlaybackSnapshot());
        }
        return;
      }
      if (expectedTrack) {
        const expectedKey = getTrackCacheKey(expectedTrack);
        if (session.trackKey !== expectedKey) return;
      }

      const nextSession = nextTrack
        ? buildSession(nextTrack, nextSource, getPlaybackSnapshot())
        : null;
      sessionRef.current = nextSession;
      dispatchPlayEvent(session, reason);
    },
    [getPlaybackSnapshot],
  );

  const recordProgress = useCallback((nextTime: number) => {
    const session = sessionRef.current;
    if (!session) return;
    const snapshot = getPlaybackSnapshot();
    if (session.trackDurationSeconds === null && Number.isFinite(snapshot.duration) && snapshot.duration > 0) {
      session.trackDurationSeconds = snapshot.duration;
    }

    const delta = nextTime - session.lastKnownTime;
    if (delta > 0 && delta <= PLAY_EVENT_DELTA_CAP_SECONDS) {
      session.listenedSeconds += delta;
    }
    session.lastKnownTime = nextTime;
    session.maxProgressSeconds = Math.max(session.maxProgressSeconds, nextTime);
  }, [getPlaybackSnapshot]);

  const markSeekPosition = useCallback((nextTime: number) => {
    const session = sessionRef.current;
    if (!session) return;
    const snapshot = getPlaybackSnapshot();
    if (session.trackDurationSeconds === null && Number.isFinite(snapshot.duration) && snapshot.duration > 0) {
      session.trackDurationSeconds = snapshot.duration;
    }
    session.lastKnownTime = nextTime;
    session.maxProgressSeconds = Math.max(session.maxProgressSeconds, nextTime);
  }, [getPlaybackSnapshot]);

  /**
   * Start a session only if none is active. Safe to call from engine
   * callbacks where the caller may or may not have already initialized
   * a session (e.g. restore-on-mount autoplay, where onPlay fires but
   * the Context didn't drive the transition).
   */
  const ensureSession = useCallback(
    (track: Track | undefined, source: PlaySource | null) => {
      if (sessionRef.current) return;
      startSession(track, source);
    },
    [startSession],
  );

  return {
    startSession,
    ensureSession,
    flushCurrentPlayEvent,
    rotateSession,
    markSeekPosition,
    recordProgress,
  };
}
