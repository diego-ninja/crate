import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatPlayerTime } from "@/components/player/bar/player-bar-utils";

interface PlayerSeekBarProps {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  compact?: boolean;
  thin?: boolean;
  showTimes?: boolean;
  className?: string;
  variant?: "default" | "glow";
}

export function PlayerSeekBar({
  currentTime,
  duration,
  onSeek,
  compact = false,
  thin = false,
  showTimes = false,
  className = "",
  variant = "default",
}: PlayerSeekBarProps) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [draftTime, setDraftTime] = useState(0);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

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

  const hoverTime = hoverPercent != null && safeDuration > 0
    ? formatPlayerTime(hoverPercent * safeDuration)
    : null;
  const glowTrackClass = thin ? "h-[3px]" : "h-1";
  const glowWidthStyle = { width: `${progress}%` };
  const glowLeftStyle = { left: `calc(${progress}% - 4px)` };

  const handleHover = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (!el || safeDuration <= 0) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPercent(pct);
  }, [safeDuration]);

  function stopPropagation(event: React.SyntheticEvent) {
    event.stopPropagation();
  }

  function commitSeek(value: number) {
    const clamped = safeDuration > 0 ? Math.max(0, Math.min(safeDuration, value)) : 0;
    setDraftTime(clamped);
    onSeek(clamped);
  }

  if (variant === "glow") {
    return (
      <div
        className={`${className} ${showTimes ? "space-y-1.5" : ""}`}
        onClick={stopPropagation}
        onPointerDown={stopPropagation}
        onTouchStart={stopPropagation}
      >
        {showTimes ? (
          <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
            <span>{formatPlayerTime(displayedTime)}</span>
            <span>{formatPlayerTime(safeDuration)}</span>
          </div>
        ) : null}

        <div
          ref={trackRef}
          className="group relative py-3"
          onPointerMove={handleHover}
          onPointerLeave={() => setHoverPercent(null)}
        >
          {hoverTime != null && hoverPercent != null && (
            <div
              className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded border border-white/10 bg-black/85 px-1.5 py-0.5 text-[10px] tabular-nums text-white/90"
              style={{ left: `${hoverPercent * 100}%` }}
            >
              {hoverTime}
            </div>
          )}
          <div className={`absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-white/10 ${glowTrackClass}`} />
          <div
            className="pointer-events-none absolute left-0 top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-full opacity-65 transition-[width] duration-150"
            style={glowWidthStyle}
          >
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,182,212,0)_0%,rgba(6,182,212,0.08)_44%,rgba(34,211,238,0.28)_82%,rgba(165,243,252,0.55)_100%)] blur-[3px]" />
            <div className="absolute inset-y-[5px] inset-x-0 rounded-full bg-[linear-gradient(90deg,rgba(6,182,212,0)_0%,rgba(6,182,212,0.18)_46%,rgba(34,211,238,0.58)_88%,rgba(207,250,254,0.78)_100%)]" />
          </div>
          <div
            className={`absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-[linear-gradient(90deg,rgba(6,182,212,0.14),rgba(34,211,238,0.56),rgba(207,250,254,0.78))] transition-[width] duration-150 ${glowTrackClass}`}
            style={glowWidthStyle}
          />
          <div
            className="pointer-events-none absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-cyan-100 shadow-[0_0_6px_rgba(165,243,252,0.62),0_0_12px_rgba(34,211,238,0.34)] transition-[left,opacity] duration-150"
            style={{
              ...glowLeftStyle,
              opacity: progress > 0 ? 0.62 : 0,
            }}
          />
          <div
            className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-primary/80 bg-cyan-100 opacity-0 shadow-[0_0_0_3px_rgba(34,211,238,0.14)] transition-[left,opacity] duration-150 group-hover:opacity-100"
            style={{ left: `calc(${progress}% - 5px)` }}
          />
          <input
            type="range"
            min={0}
            max={safeDuration || 1}
            step={0.1}
            value={safeDuration > 0 ? Math.min(displayedTime, safeDuration) : 0}
            disabled={safeDuration <= 0}
            aria-label="Seek track position"
            className="absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 cursor-pointer opacity-0 disabled:cursor-default"
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
      </div>
    );
  }

  return (
    <div
      className={`${className} ${showTimes ? "space-y-1.5" : ""}`}
      onClick={stopPropagation}
      onPointerDown={stopPropagation}
      onTouchStart={stopPropagation}
    >
      {showTimes ? (
        <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
          <span>{formatPlayerTime(displayedTime)}</span>
          <span>{formatPlayerTime(safeDuration)}</span>
        </div>
      ) : null}

      <div
        ref={trackRef}
        className="relative"
        onPointerMove={handleHover}
        onPointerLeave={() => setHoverPercent(null)}
      >
        {hoverTime != null && hoverPercent != null && (
          <div
            className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[10px] tabular-nums text-white/90 border border-white/10"
            style={{ left: `${hoverPercent * 100}%` }}
          >
            {hoverTime}
          </div>
        )}
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
    </div>
  );
}
