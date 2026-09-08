import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@crate/ui/lib/cn";
import { SpinningDiscArtwork } from "@/components/player/SpinningDiscArtwork";
import { SpinningDiscControl } from "@/components/player/SpinningDiscControl";
import {
  DISC_DEGREES_PER_SECOND,
  JOG_RATE_UPDATE_INTERVAL_MS,
  JOG_SEEK_INTERVAL_MS,
  clamp,
  getJogTime,
  getPointerAngle,
  normalizeDeltaDegrees,
} from "@/components/player/spinning-disc-math";
import { useSpinningDiscPlayback } from "@/components/player/use-spinning-disc-playback";

type JogSeekMode = "live" | "commit";

interface SpinningDiscProps {
  albumCover?: string | null;
  className?: string;
  crossfadeIncomingCover?: string | null;
  crossfadeOutgoingCover?: string | null;
  crossfadeProgress?: number;
  currentTime: number;
  duration: number;
  isBuffering?: boolean;
  isPlaying: boolean;
  jogEnabled?: boolean;
  jogSeekMode?: JogSeekMode;
  onJoggingChange?: (jogging: boolean) => void;
  onPlaybackRateChange?: (rate: number) => void;
  onSeek?: (time: number) => void;
  onTogglePlay: () => void;
  disabled?: boolean;
}

export function SpinningDisc({
  albumCover,
  className,
  crossfadeIncomingCover,
  crossfadeOutgoingCover,
  crossfadeProgress = 0,
  currentTime,
  duration,
  isBuffering = false,
  isPlaying,
  jogEnabled = false,
  jogSeekMode = "live",
  onJoggingChange,
  onPlaybackRateChange,
  onSeek,
  onTogglePlay,
  disabled = false,
}: SpinningDiscProps) {
  const seekTimerRef = useRef<number | null>(null);
  const lastSeekFlushAtRef = useRef(0);
  const lastRateUpdateAtRef = useRef(0);
  const lastJogRateRef = useRef(1);
  const pendingSeekRef = useRef<number | null>(null);
  const dragStateRef = useRef<{
    accumDegrees: number;
    baseRotation: number;
    pointerId: number;
    previousAngle: number;
    previousMoveAt: number;
    startTime: number;
  } | null>(null);

  const [isJogging, setIsJogging] = useState(false);
  const [dragRotation, setDragRotation] = useState<number | null>(null);
  const { rotorRef, setPlaybackAnchor, setRotorRotation } =
    useSpinningDiscPlayback({
      currentTime,
      dragRotation,
      duration,
      isBuffering,
      isJogging,
      isPlaying,
    });

  const setJogPlaybackRate = useCallback(
    (rate: number, immediate = false) => {
      if (!onPlaybackRateChange) return;
      const safeRate = clamp(rate, 0.25, 4);
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      if (
        !immediate &&
        now - lastRateUpdateAtRef.current < JOG_RATE_UPDATE_INTERVAL_MS &&
        Math.abs(safeRate - lastJogRateRef.current) < 0.12
      ) {
        return;
      }
      lastRateUpdateAtRef.current = now;
      lastJogRateRef.current = safeRate;
      onPlaybackRateChange(safeRate);
    },
    [onPlaybackRateChange],
  );

  const clearSeekTimer = useCallback(() => {
    if (seekTimerRef.current == null) return;
    window.clearTimeout(seekTimerRef.current);
    seekTimerRef.current = null;
  }, []);

  const flushPendingSeek = useCallback(() => {
    if (!onSeek) return;
    clearSeekTimer();
    const pending = pendingSeekRef.current;
    pendingSeekRef.current = null;
    if (pending == null) return;
    lastSeekFlushAtRef.current =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    onSeek(pending);
  }, [clearSeekTimer, onSeek]);

  const scheduleSeek = useCallback(
    (nextTime: number, immediate = false) => {
      if (!onSeek) return;
      pendingSeekRef.current = nextTime;
      if (immediate) {
        flushPendingSeek();
        return;
      }

      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsed = now - lastSeekFlushAtRef.current;
      if (elapsed >= JOG_SEEK_INTERVAL_MS) {
        flushPendingSeek();
        return;
      }

      if (seekTimerRef.current != null) return;
      seekTimerRef.current = window.setTimeout(
        flushPendingSeek,
        JOG_SEEK_INTERVAL_MS - elapsed,
      );
    },
    [flushPendingSeek, onSeek],
  );

  useEffect(() => {
    onJoggingChange?.(isJogging);
  }, [isJogging, onJoggingChange]);

  useEffect(() => {
    return () => {
      onJoggingChange?.(false);
    };
  }, [onJoggingChange]);

  useEffect(() => {
    return () => {
      clearSeekTimer();
      onPlaybackRateChange?.(1);
    };
  }, [clearSeekTimer, onPlaybackRateChange]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!jogEnabled || !onSeek || duration <= 0) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;

      const bounds = event.currentTarget.getBoundingClientRect();
      const angle = getPointerAngle(event.nativeEvent, bounds);
      const baseRotation = currentTime * DISC_DEGREES_PER_SECOND;
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();

      dragStateRef.current = {
        accumDegrees: 0,
        baseRotation,
        pointerId: event.pointerId,
        previousAngle: angle,
        previousMoveAt: now,
        startTime: currentTime,
      };
      pendingSeekRef.current = currentTime;
      setJogPlaybackRate(1, true);
      setDragRotation(baseRotation);
      setIsJogging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [currentTime, duration, jogEnabled, onSeek, setJogPlaybackRate],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) return;

      const bounds = event.currentTarget.getBoundingClientRect();
      const nextAngle = getPointerAngle(event.nativeEvent, bounds);
      const delta = normalizeDeltaDegrees(nextAngle - dragState.previousAngle);
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const elapsedMs = Math.max(16, now - dragState.previousMoveAt);
      dragState.previousAngle = nextAngle;
      dragState.previousMoveAt = now;
      dragState.accumDegrees += delta;

      const nextTime = getJogTime({
        accumDegrees: dragState.accumDegrees,
        duration,
        startTime: dragState.startTime,
      });

      setDragRotation(dragState.baseRotation + dragState.accumDegrees);
      const degreesPerSecond = (delta / elapsedMs) * 1000;
      if (degreesPerSecond > 8) {
        setJogPlaybackRate(degreesPerSecond / DISC_DEGREES_PER_SECOND);
      } else if (degreesPerSecond < -8) {
        setJogPlaybackRate(jogSeekMode === "live" ? 0.35 : 1);
      } else {
        setJogPlaybackRate(1);
      }
      if (jogSeekMode === "commit") {
        pendingSeekRef.current = nextTime;
      } else {
        scheduleSeek(nextTime);
      }
      event.preventDefault();
    },
    [duration, jogSeekMode, scheduleSeek, setJogPlaybackRate],
  );

  const finishJog = useCallback(
    (pointerId: number, currentTarget: HTMLDivElement) => {
      const dragState = dragStateRef.current;
      if (!dragState || pointerId !== dragState.pointerId) return;
      const finalTime = pendingSeekRef.current ?? currentTime;
      flushPendingSeek();
      dragStateRef.current = null;
      setIsJogging(false);
      setDragRotation(null);
      setJogPlaybackRate(1, true);
      setPlaybackAnchor(finalTime);
      setRotorRotation(finalTime * DISC_DEGREES_PER_SECOND);
      if (currentTarget.hasPointerCapture(pointerId)) {
        currentTarget.releasePointerCapture(pointerId);
      }
    },
    [
      currentTime,
      flushPendingSeek,
      setJogPlaybackRate,
      setPlaybackAnchor,
      setRotorRotation,
    ],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      finishJog(event.pointerId, event.currentTarget);
    },
    [finishJog],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      finishJog(event.pointerId, event.currentTarget);
    },
    [finishJog],
  );

  return (
    <div
      className={cn(
        "relative",
        className,
        disabled && "pointer-events-none grayscale opacity-60",
      )}
    >
      <div className="spinning-disc-ambient absolute inset-[7%] rounded-full blur-3xl opacity-80" />
      <div
        className={cn(
          "spinning-disc-surface relative aspect-square w-full rounded-full",
          jogEnabled && onSeek
            ? "cursor-grab touch-none active:cursor-grabbing"
            : "",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        data-testid="spinning-disc-jog-surface"
        style={{ touchAction: jogEnabled && onSeek ? "none" : undefined }}
      >
        <div
          ref={rotorRef}
          className={cn(
            "spinning-disc-rotor absolute inset-[5.5%] overflow-hidden rounded-full transition-transform duration-150",
            isJogging ? "" : "will-change-transform",
          )}
          style={{
            transition:
              isJogging || (isPlaying && !isBuffering)
                ? "none"
                : "transform 140ms linear",
          }}
        >
          <SpinningDiscArtwork
            albumCover={albumCover}
            crossfadeIncomingCover={crossfadeIncomingCover}
            crossfadeOutgoingCover={crossfadeOutgoingCover}
            crossfadeProgress={crossfadeProgress}
          />
        </div>

        <div className="spinning-disc-overlay pointer-events-none absolute inset-[2%] rounded-full" />

        <SpinningDiscControl
          disabled={disabled}
          isBuffering={isBuffering}
          isPlaying={isPlaying}
          onTogglePlay={onTogglePlay}
        />
      </div>
    </div>
  );
}
