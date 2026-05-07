import { useEffect, useRef } from "react";
import type { Track } from "./player-types";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import { isAndroidNative } from "@/lib/capacitor";
import { CrateMediaSession } from "@/lib/native-media-session";

/**
 * Sync the Web MediaSession API with the current player state.
 * This enables OS-level playback controls: lockscreen, bluetooth,
 * headphone buttons, car stereos, media keys, etc.
 */
export function useMediaSession({
  currentTrack,
  isPlaying,
  currentTime,
  duration,
  pause,
  resume,
  next,
  prev,
  seek,
}: {
  currentTrack: Track | undefined;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
}) {
  const actionsRef = useRef({ pause, resume, next, prev, seek, currentTime, duration });

  useEffect(() => {
    actionsRef.current = { pause, resume, next, prev, seek, currentTime, duration };
  }, [currentTime, duration, next, pause, prev, resume, seek]);

  useEffect(() => {
    if (!isAndroidNative) return;
    let cancelled = false;
    let handle: { remove: () => Promise<void> } | null = null;

    void CrateMediaSession.addListener("mediaSessionAction", (event) => {
      const { pause, resume, next, prev, seek } = actionsRef.current;
      if (event.action === "play") {
        void CrateMediaSession.requestAudioFocus().catch(() => {});
        resume();
      } else if (event.action === "pause") {
        pause();
      } else if (event.action === "next") {
        next();
      } else if (event.action === "previous") {
        prev();
      } else if (event.action === "seek" && typeof event.position === "number") {
        seek(event.position);
      }
    }).then((listener) => {
      if (cancelled) {
        void listener.remove();
      } else {
        handle = listener;
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (handle) void handle.remove();
    };
  }, []);

  useEffect(() => {
    if (!isAndroidNative) return;
    if (!currentTrack) {
      void CrateMediaSession.clear().catch(() => {});
      return;
    }
    const artworkUrl = resolveMaybeApiAssetUrl(currentTrack.albumCover) || "";
    void CrateMediaSession.setMetadata({
      title: currentTrack.title || "Unknown",
      artist: currentTrack.artist || "",
      album: currentTrack.album || "",
      artworkUrl,
    }).catch(() => {});
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.album, currentTrack?.albumCover]);

  useEffect(() => {
    if (!isAndroidNative) return;
    return () => {
      void CrateMediaSession.clear().catch(() => {});
    };
  }, []);

  // Update metadata when track changes
  useEffect(() => {
    if (isAndroidNative) return;
    if (!("mediaSession" in navigator) || !currentTrack) return;

    const artwork: MediaImage[] = [];
    const coverUrl = resolveMaybeApiAssetUrl(currentTrack.albumCover);
    if (coverUrl) {
      artwork.push({ src: coverUrl, sizes: "256x256", type: "image/jpeg" });
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title || "Unknown",
      artist: currentTrack.artist || "",
      album: currentTrack.album || "",
      artwork,
    });
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.album, currentTrack?.albumCover]);

  // Update playback state
  useEffect(() => {
    if (isAndroidNative) return;
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  // Update position state for seek bar on lockscreen
  const positionSeconds = Math.floor(Math.min(currentTime, duration));
  useEffect(() => {
    if (!isAndroidNative || !currentTrack) return;
    void CrateMediaSession.setPlaybackState({
      playing: isPlaying,
      position: Number.isFinite(positionSeconds) ? positionSeconds : 0,
      duration: Number.isFinite(duration) ? duration : 0,
    }).catch(() => {});
  }, [currentTrack?.id, duration, isPlaying, positionSeconds]);

  useEffect(() => {
    if (isAndroidNative) return;
    if (!("mediaSession" in navigator) || !duration) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: duration || 0,
        playbackRate: 1,
        position: positionSeconds,
      });
    } catch {
      // Some browsers don't support setPositionState
    }
  }, [duration, positionSeconds]);

  // Register action handlers
  useEffect(() => {
    if (isAndroidNative) return;
    if (!("mediaSession" in navigator)) return;

    const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ["play", () => actionsRef.current.resume()],
      ["pause", () => actionsRef.current.pause()],
      ["previoustrack", () => actionsRef.current.prev()],
      ["nexttrack", () => actionsRef.current.next()],
      ["seekto", (details) => {
        if (details.seekTime != null) actionsRef.current.seek(details.seekTime);
      }],
      ["seekbackward", (details) => {
        const { currentTime, seek } = actionsRef.current;
        seek(Math.max(0, currentTime - (details.seekOffset || 10)));
      }],
      ["seekforward", (details) => {
        const { currentTime, duration, seek } = actionsRef.current;
        seek(Math.min(duration, currentTime + (details.seekOffset || 10)));
      }],
    ];

    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Action not supported in this browser
      }
    }

    return () => {
      for (const [action] of actions) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch { /* ignore */ }
      }
    };
  }, []);
}
