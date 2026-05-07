import { useEffect, useRef } from "react";
import type { Track } from "./player-types";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import {
  onNativeMediaControl,
  stopNativeMediaSession,
  syncNativeMediaSession,
} from "@/lib/native-media-session";

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
    let disposed = false;
    let cleanup: (() => void) | null = null;

    void onNativeMediaControl((event) => {
      const actions = actionsRef.current;
      switch (event.control) {
        case "play":
          actions.resume();
          break;
        case "pause":
          actions.pause();
          break;
        case "next":
          actions.next();
          break;
        case "previous":
          actions.prev();
          break;
        case "seekTo":
          if (typeof event.position === "number") {
            actions.seek(event.position);
          }
          break;
      }
    })
      .then((removeListener) => {
        if (disposed) {
          removeListener();
        } else {
          cleanup = removeListener;
        }
      })
      .catch(() => {
        // Native controls are optional; web media session keeps working.
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  // Update metadata when track changes
  useEffect(() => {
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
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  // Update position state for seek bar on lockscreen
  const positionSeconds = Math.floor(Math.min(currentTime, duration));
  useEffect(() => {
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

  const nativePositionSeconds = Math.floor(
    Math.min(duration > 0 ? duration : currentTime, currentTime) / 15,
  ) * 15;
  useEffect(() => {
    if (!currentTrack) {
      void stopNativeMediaSession();
      return;
    }

    const coverUrl = resolveMaybeApiAssetUrl(currentTrack.albumCover);
    void syncNativeMediaSession({
      title: currentTrack.title || "Unknown",
      artist: currentTrack.artist || "",
      album: currentTrack.album || "",
      artwork: coverUrl || undefined,
      isPlaying,
      position: nativePositionSeconds,
      duration: duration || 0,
    });
  }, [
    currentTrack?.id,
    currentTrack?.title,
    currentTrack?.artist,
    currentTrack?.album,
    currentTrack?.albumCover,
    duration,
    isPlaying,
    nativePositionSeconds,
  ]);

  // Register action handlers
  useEffect(() => {
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
