import { useCallback, useEffect, useRef } from "react";

import type { PlaySource, Track } from "@/contexts/player-types";
import { getTrackCacheKey } from "@/contexts/player-utils";
import { apiFetch } from "@/lib/api";

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

export function usePlayEventTracker(
  currentTrack: Track | undefined,
  playSource: PlaySource | null,
  getPlaybackSnapshot: () => { currentTime: number; duration: number },
) {
  const sessionRef = useRef<PlayEventSession | null>(null);

  const syncSession = useCallback((track: Track | undefined, source: PlaySource | null) => {
    if (!track) {
      sessionRef.current = null;
      return;
    }

    const trackKey = getTrackCacheKey(track);
    const existing = sessionRef.current;
    if (existing?.trackKey === trackKey) {
      existing.playSource = source;
      return;
    }

    const snapshot = getPlaybackSnapshot();
    sessionRef.current = {
      trackKey,
      track,
      playSource: source,
      startedAt: nowIso(),
      trackDurationSeconds:
        Number.isFinite(snapshot.duration) && snapshot.duration > 0 ? snapshot.duration : null,
      lastKnownTime: snapshot.currentTime || 0,
      listenedSeconds: 0,
      maxProgressSeconds: snapshot.currentTime || 0,
    };
  }, [getPlaybackSnapshot]);

  const flushCurrentPlayEvent = useCallback((reason: FlushReason, expectedTrack?: Track) => {
    const session = sessionRef.current;
    if (!session) return;
    if (expectedTrack) {
      // Defensive: if the caller knows which track the flush is for
      // (e.g. crossfade handoff where React state may have already
      // advanced), drop the flush when sessionRef doesn't match instead
      // of attributing the event to the wrong song.
      const expectedKey = getTrackCacheKey(expectedTrack);
      if (session.trackKey !== expectedKey) return;
    }
    sessionRef.current = null;

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

    apiFetch("/api/me/play-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
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
      }),
    }).catch(() => {});
  }, []);

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

  useEffect(() => {
    syncSession(currentTrack, playSource);
  }, [currentTrack, playSource, syncSession]);

  return {
    flushCurrentPlayEvent,
    markSeekPosition,
    recordProgress,
  };
}
