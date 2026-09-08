import { useCallback, useEffect, useRef } from "react";

import {
  DISC_DEGREES_PER_SECOND,
  PLAYING_BACKWARD_SYNC_TOLERANCE_SECONDS,
  PLAYING_FORWARD_SYNC_TOLERANCE_SECONDS,
  projectPlaybackTime,
} from "@/components/player/spinning-disc-math";
import {
  isMotionBlocked,
  subscribeToMotionAvailability,
} from "@/lib/motion-availability";

interface UseSpinningDiscPlaybackOptions {
  currentTime: number;
  dragRotation: number | null;
  duration: number;
  isBuffering: boolean;
  isJogging: boolean;
  isPlaying: boolean;
}

export function useSpinningDiscPlayback({
  currentTime,
  dragRotation,
  duration,
  isBuffering,
  isJogging,
  isPlaying,
}: UseSpinningDiscPlaybackOptions) {
  const rotorRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const playbackAnchorRef = useRef({ time: currentTime, timestamp: 0 });

  const setRotorRotation = useCallback((rotation: number) => {
    if (!rotorRef.current) return;
    rotorRef.current.style.transform = `rotate(${rotation}deg)`;
  }, []);

  const setPlaybackAnchor = useCallback((time: number) => {
    playbackAnchorRef.current = {
      time,
      timestamp:
        typeof performance !== "undefined" ? performance.now() : Date.now(),
    };
  }, []);

  const projectedPlaybackTime = useCallback(
    (timestamp: number) => {
      const { time: anchorTime, timestamp: anchorTimestamp } =
        playbackAnchorRef.current;
      return projectPlaybackTime({
        anchorTime,
        anchorTimestamp,
        duration,
        isBuffering,
        isPlaying,
        timestamp,
      });
    },
    [duration, isBuffering, isPlaying],
  );

  useEffect(() => {
    if (isJogging || dragRotation != null) return;

    const timestamp =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const projected = projectedPlaybackTime(timestamp);
    const drift = currentTime - projected;
    const shouldHardSync =
      !isPlaying ||
      isBuffering ||
      drift > PLAYING_FORWARD_SYNC_TOLERANCE_SECONDS ||
      drift < -PLAYING_BACKWARD_SYNC_TOLERANCE_SECONDS;

    if (shouldHardSync) {
      setPlaybackAnchor(currentTime);
      if (!isPlaying || isBuffering) {
        setRotorRotation(currentTime * DISC_DEGREES_PER_SECOND);
      }
    }
  }, [
    currentTime,
    dragRotation,
    isBuffering,
    isJogging,
    isPlaying,
    projectedPlaybackTime,
    setPlaybackAnchor,
    setRotorRotation,
  ]);

  useEffect(() => {
    if (dragRotation != null) {
      setRotorRotation(dragRotation);
      return;
    }

    if (animationFrameRef.current != null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (!isPlaying || isBuffering) {
      setPlaybackAnchor(currentTime);
      setRotorRotation(currentTime * DISC_DEGREES_PER_SECOND);
      return;
    }

    const tick = (timestamp: number) => {
      const displayTime = projectedPlaybackTime(timestamp);
      setRotorRotation(displayTime * DISC_DEGREES_PER_SECOND);
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    const startAnimation = () => {
      if (animationFrameRef.current != null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (isMotionBlocked()) {
        setPlaybackAnchor(currentTime);
        setRotorRotation(currentTime * DISC_DEGREES_PER_SECOND);
        return;
      }
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    const unsubscribeFromMotion = subscribeToMotionAvailability(startAnimation);
    startAnimation();

    return () => {
      unsubscribeFromMotion();
      if (animationFrameRef.current != null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [
    currentTime,
    dragRotation,
    isBuffering,
    isPlaying,
    projectedPlaybackTime,
    setPlaybackAnchor,
    setRotorRotation,
  ]);

  return { rotorRef, setPlaybackAnchor, setRotorRotation };
}
