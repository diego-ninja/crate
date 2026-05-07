import { useEffect, useRef } from "react";

import type { AuthUser } from "@/contexts/auth-context";
import type { Track } from "@/contexts/player-types";
import { api } from "@/lib/api";
import { getTrackCacheKey } from "@/contexts/player-utils";
import { getListenAppPlatform, getListenDeviceType } from "@/lib/listen-device";
import { flushQueue as flushPlayEventQueue } from "@/lib/play-event-queue";
import { toTrackReferencePayload } from "@/lib/track-reference";

export function usePlayerAuthSync({
  authUser,
  currentTrack,
  isPlaying,
}: {
  authUser: AuthUser | null;
  currentTrack: Track | undefined;
  isPlaying: boolean;
}) {
  const nowPlayingTrackKeyRef = useRef<string | null>(null);
  const nowPlayingStartedAtRef = useRef<string | null>(null);

  useEffect(() => {
    if (!authUser) return;

    void flushPlayEventQueue();

    const onOnline = () => {
      void flushPlayEventQueue();
    };
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

  useEffect(() => {
    if (!authUser) {
      nowPlayingTrackKeyRef.current = null;
      return;
    }

    const activeTrack = isPlaying ? currentTrack : undefined;
    const activeTrackKey = activeTrack ? getTrackCacheKey(activeTrack) : null;

    if (nowPlayingTrackKeyRef.current && nowPlayingTrackKeyRef.current !== activeTrackKey) {
      void api("/api/me/now-playing", "POST", { playing: false }).catch(() => {});
      nowPlayingTrackKeyRef.current = null;
      nowPlayingStartedAtRef.current = null;
    }

    if (!activeTrack) return;

    if (nowPlayingTrackKeyRef.current !== activeTrackKey || !nowPlayingStartedAtRef.current) {
      nowPlayingStartedAtRef.current = new Date().toISOString();
    }

    const sendNowPlaying = () => {
      const ref = toTrackReferencePayload(activeTrack);
      void api("/api/me/now-playing", "POST", {
        playing: true,
        track_id: ref.track_id ?? null,
        track_entity_uid: ref.entity_uid ?? null,
        track_path: ref.path || activeTrack.id,
        title: activeTrack.title,
        artist: activeTrack.artist,
        album: activeTrack.album || "",
        started_at: nowPlayingStartedAtRef.current,
        device_type: getListenDeviceType(),
        app_platform: getListenAppPlatform(),
      }).catch(() => {});
    };

    nowPlayingTrackKeyRef.current = activeTrackKey;
    sendNowPlaying();
    const interval = window.setInterval(sendNowPlaying, 30_000);
    return () => window.clearInterval(interval);
  }, [authUser, currentTrack, isPlaying]);
}
