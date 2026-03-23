import { useEffect } from "react";
import { usePlayer } from "@/contexts/PlayerContext";

const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function GlobalShortcuts() {
  const {
    isPlaying,
    pause,
    resume,
    next,
    prev,
    volume,
    setVolume,
    toggleShuffle,
    cycleRepeat,
    playbackRate,
    setPlaybackRate,
    currentTrack,
  } = usePlayer();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          if (currentTrack) {
            isPlaying ? pause() : resume();
          }
          break;
        case "n":
        case "ArrowRight":
          next();
          break;
        case "p":
        case "ArrowLeft":
          prev();
          break;
        case "m":
          setVolume(volume > 0 ? 0 : 0.8);
          break;
        case "+":
        case "=":
          setVolume(Math.min(1, volume + 0.1));
          break;
        case "-":
          setVolume(Math.max(0, volume - 0.1));
          break;
        case "s":
          toggleShuffle();
          break;
        case "r":
          cycleRepeat();
          break;
        case "[": {
          const idx = SPEED_STEPS.indexOf(playbackRate);
          if (idx > 0) setPlaybackRate(SPEED_STEPS[idx - 1]!);
          break;
        }
        case "]": {
          const idx = SPEED_STEPS.indexOf(playbackRate);
          if (idx < SPEED_STEPS.length - 1) setPlaybackRate(SPEED_STEPS[idx + 1]!);
          break;
        }
        default:
          return;
      }
    }

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    isPlaying,
    pause,
    resume,
    next,
    prev,
    volume,
    setVolume,
    toggleShuffle,
    cycleRepeat,
    playbackRate,
    setPlaybackRate,
    currentTrack,
  ]);

  return null;
}
