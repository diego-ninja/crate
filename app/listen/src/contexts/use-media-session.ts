import { useEffect } from "react";
import type { Track } from "./player-types";

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
  // Update metadata when track changes
  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentTrack) return;

    const artwork: MediaImage[] = [];
    if (currentTrack.albumCover) {
      artwork.push({ src: currentTrack.albumCover, sizes: "256x256", type: "image/jpeg" });
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
  useEffect(() => {
    if (!("mediaSession" in navigator) || !duration) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: duration || 0,
        playbackRate: 1,
        position: Math.min(currentTime, duration),
      });
    } catch {
      // Some browsers don't support setPositionState
    }
  }, [currentTime, duration]);

  // Register action handlers
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ["play", () => resume()],
      ["pause", () => pause()],
      ["previoustrack", () => prev()],
      ["nexttrack", () => next()],
      ["seekto", (details) => {
        if (details.seekTime != null) seek(details.seekTime);
      }],
      ["seekbackward", (details) => {
        seek(Math.max(0, currentTime - (details.seekOffset || 10)));
      }],
      ["seekforward", (details) => {
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
  }, [pause, resume, next, prev, seek, currentTime, duration]);
}
