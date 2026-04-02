import { useEffect } from "react";

interface UsePlayerShortcutsOptions {
  hasCurrentTrack: boolean;
  isPlaying: boolean;
  audio: HTMLAudioElement;
  duration: number;
  volume: number;
  lastNonZeroVolume: number;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
}

export function usePlayerShortcuts({
  hasCurrentTrack,
  isPlaying,
  audio,
  duration,
  volume,
  lastNonZeroVolume,
  pause,
  resume,
  next,
  prev,
  seek,
  setVolume,
}: UsePlayerShortcutsOptions) {
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        el.isContentEditable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT"
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (!hasCurrentTrack) return;

      if (event.code === "Space" || event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (isPlaying) pause();
        else resume();
        return;
      }

      if (event.shiftKey && event.key === "ArrowRight") {
        event.preventDefault();
        next();
        return;
      }

      if (event.shiftKey && event.key === "ArrowLeft") {
        event.preventDefault();
        prev();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        seek(Math.min(audio.duration || duration || 0, audio.currentTime + 10));
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seek(Math.max(0, audio.currentTime - 10));
        return;
      }

      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        if (volume === 0) setVolume(lastNonZeroVolume || 0.8);
        else setVolume(0);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [audio, duration, hasCurrentTrack, isPlaying, lastNonZeroVolume, next, pause, prev, resume, seek, setVolume, volume]);
}
