import { useEffect, useMemo, useState } from "react";

import { formatPlayerTime } from "@/components/player/bar/player-bar-utils";

interface PlayerSeekBarProps {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  compact?: boolean;
  thin?: boolean;
  showTimes?: boolean;
  className?: string;
}

export function PlayerSeekBar({
  currentTime,
  duration,
  onSeek,
  compact = false,
  thin = false,
  showTimes = false,
  className = "",
}: PlayerSeekBarProps) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [draftTime, setDraftTime] = useState(0);

  useEffect(() => {
    if (!isScrubbing) {
      setDraftTime(currentTime);
    }
  }, [currentTime, isScrubbing]);

  const displayedTime = isScrubbing ? draftTime : currentTime;
  const progress = safeDuration > 0 ? Math.max(0, Math.min(100, (displayedTime / safeDuration) * 100)) : 0;

  const sliderStyle = useMemo(
    () => ({
      accentColor: "#06b6d4",
      background: `linear-gradient(90deg, rgba(6,182,212,0.95) 0%, rgba(6,182,212,0.95) ${progress}%, rgba(255,255,255,0.16) ${progress}%, rgba(255,255,255,0.16) 100%)`,
    }),
    [progress],
  );

  function stopPropagation(event: React.SyntheticEvent) {
    event.stopPropagation();
  }

  function commitSeek(value: number) {
    const clamped = safeDuration > 0 ? Math.max(0, Math.min(safeDuration, value)) : 0;
    setDraftTime(clamped);
    onSeek(clamped);
  }

  return (
    <div
      className={`${className} ${showTimes ? "space-y-1.5" : ""}`}
      onClick={stopPropagation}
      onPointerDown={stopPropagation}
      onTouchStart={stopPropagation}
    >
      {showTimes ? (
        <div className="flex items-center justify-between text-[11px] tabular-nums text-white/45">
          <span>{formatPlayerTime(displayedTime)}</span>
          <span>{formatPlayerTime(safeDuration)}</span>
        </div>
      ) : null}

      <input
        type="range"
        min={0}
        max={safeDuration || 1}
        step={0.1}
        value={safeDuration > 0 ? Math.min(displayedTime, safeDuration) : 0}
        disabled={safeDuration <= 0}
        aria-label="Seek track position"
        className={`block w-full appearance-none rounded-full border-0 outline-none ${
          thin ? "h-1" : compact ? "h-1.5" : "h-2"
        } cursor-pointer disabled:cursor-default disabled:opacity-50`}
        style={sliderStyle}
        onPointerDown={(event) => {
          stopPropagation(event);
          setIsScrubbing(true);
        }}
        onPointerUp={(event) => {
          stopPropagation(event);
          setIsScrubbing(false);
        }}
        onTouchEnd={(event) => {
          stopPropagation(event);
          setIsScrubbing(false);
        }}
        onBlur={() => setIsScrubbing(false)}
        onChange={(event) => {
          const value = Number(event.target.value || 0);
          setDraftTime(value);
          commitSeek(value);
        }}
      />
    </div>
  );
}
