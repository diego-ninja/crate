import { useCallback, useEffect, useRef } from "react";

import type { PlaySource, Track } from "@/contexts/player-types";
import { getTrackCacheKey } from "@/contexts/player-utils";

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
  audio: HTMLAudioElement,
  currentTrack: Track | undefined,
  playSource: PlaySource | null,
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

    sessionRef.current = {
      trackKey,
      track,
      playSource: source,
      startedAt: nowIso(),
      trackDurationSeconds: Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null,
      lastKnownTime: audio.currentTime || 0,
      listenedSeconds: 0,
      maxProgressSeconds: audio.currentTime || 0,
    };
  }, [audio]);

  const flushCurrentPlayEvent = useCallback((reason: FlushReason) => {
    const session = sessionRef.current;
    if (!session) return;
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
    const wasSkipped = reason === "skipped" && playedSeconds >= PLAY_EVENT_MIN_SECONDS;

    fetch("/api/me/play-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        track_id: session.track.libraryTrackId ?? null,
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
    if (session.trackDurationSeconds === null && Number.isFinite(audio.duration) && audio.duration > 0) {
      session.trackDurationSeconds = audio.duration;
    }

    const delta = nextTime - session.lastKnownTime;
    if (delta > 0 && delta <= PLAY_EVENT_DELTA_CAP_SECONDS) {
      session.listenedSeconds += delta;
    }
    session.lastKnownTime = nextTime;
    session.maxProgressSeconds = Math.max(session.maxProgressSeconds, nextTime);
  }, [audio]);

  const markSeekPosition = useCallback((nextTime: number) => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.trackDurationSeconds === null && Number.isFinite(audio.duration) && audio.duration > 0) {
      session.trackDurationSeconds = audio.duration;
    }
    session.lastKnownTime = nextTime;
    session.maxProgressSeconds = Math.max(session.maxProgressSeconds, nextTime);
  }, [audio]);

  useEffect(() => {
    syncSession(currentTrack, playSource);
  }, [currentTrack, playSource, syncSession]);

  return {
    flushCurrentPlayEvent,
    markSeekPosition,
    recordProgress,
  };
}
