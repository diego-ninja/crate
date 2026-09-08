import type { TFunction } from "i18next";
import type { CSSProperties } from "react";
import { formatPlayerTime } from "@/components/player/bar/player-bar-utils";

export type PlayerSeekHover = {
  pct: number;
  time: string;
};

interface PlayerBarProgressProps {
  effectiveDisplayedDuration: number;
  effectiveDisplayedTime: number;
  jamQueueLocked: boolean;
  onSeek: (time: number) => void;
  onSeekHoverChange: (value: PlayerSeekHover | null) => void;
  progressPct: number;
  seekHover: PlayerSeekHover | null;
  t: TFunction;
}

export function PlayerBarProgress({
  effectiveDisplayedDuration,
  effectiveDisplayedTime,
  jamQueueLocked,
  onSeek,
  onSeekHoverChange,
  progressPct,
  seekHover,
  t,
}: PlayerBarProgressProps) {
  return (
    <div className="relative mt-2 flex w-full items-center gap-2">
      <span className="w-9 text-right font-mono text-xs tabular-nums text-text-muted">
        {formatPlayerTime(effectiveDisplayedTime)}
      </span>
      <div
        className={`listen-player-progress group relative flex-1 py-2 ${
          jamQueueLocked
            ? "pointer-events-none grayscale opacity-40"
            : "cursor-pointer"
        }`}
        role="slider"
        tabIndex={jamQueueLocked ? -1 : 0}
        aria-label={t("player.seek")}
        aria-disabled={jamQueueLocked}
        aria-valuemin={0}
        aria-valuemax={effectiveDisplayedDuration}
        aria-valuenow={effectiveDisplayedTime}
        aria-valuetext={formatPlayerTime(effectiveDisplayedTime)}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const pct = Math.max(
            0,
            Math.min(1, (event.clientX - rect.left) / rect.width),
          );
          onSeek(pct * effectiveDisplayedDuration);
        }}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const pct = Math.max(
            0,
            Math.min(1, (event.clientX - rect.left) / rect.width),
          );
          onSeekHoverChange({
            pct,
            time: formatPlayerTime(pct * effectiveDisplayedDuration),
          });
        }}
        onPointerLeave={() => onSeekHoverChange(null)}
        onKeyDown={(event) => {
          if (jamQueueLocked) return;

          const step = 5;
          let nextTime: number;
          switch (event.key) {
            case "ArrowLeft":
              nextTime = effectiveDisplayedTime - step;
              break;
            case "ArrowRight":
              nextTime = effectiveDisplayedTime + step;
              break;
            case "Home":
              nextTime = 0;
              break;
            case "End":
              nextTime = effectiveDisplayedDuration;
              break;
            default:
              return;
          }

          event.preventDefault();
          onSeek(Math.max(0, Math.min(effectiveDisplayedDuration, nextTime)));
        }}
      >
        {seekHover && effectiveDisplayedDuration > 0 && (
          <div
            className="listen-player-progress-tooltip pointer-events-none absolute -top-6 -translate-x-1/2 rounded border px-1.5 py-0.5 text-xs tabular-nums"
            style={{ left: `${seekHover.pct * 100}%` }}
          >
            {seekHover.time}
          </div>
        )}
        <div className="listen-player-progress-track absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full" />
        <div
          className="listen-player-progress-width-dynamic pointer-events-none absolute left-0 top-1/2 h-3 overflow-hidden rounded-full opacity-65"
          style={{ "--progress-scale": progressPct / 100 } as CSSProperties}
        >
          <div className="listen-player-progress-glow absolute inset-0 blur-[3px]" />
          <div className="listen-player-progress-fill absolute inset-y-[5px] inset-x-0 rounded-full" />
        </div>
        <div
          className="listen-player-progress-fill listen-player-progress-width-dynamic absolute left-0 top-1/2 h-[3px] rounded-full"
          style={{ "--progress-scale": progressPct / 100 } as CSSProperties}
        />
        <div
          className={`listen-player-progress-thumb listen-player-progress-left-dynamic pointer-events-none absolute top-1/2 size-2 -translate-y-1/2 rounded-full transition-opacity duration-150 ${
            progressPct > 0 ? "opacity-[0.62]" : "opacity-0"
          }`}
          style={
            {
              "--progress-left": `calc(${progressPct}% - 4px)`,
            } as CSSProperties
          }
        />
        <div
          className="listen-player-progress-thumb-active listen-player-progress-left-active-dynamic absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full border opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          style={
            {
              "--progress-left": `calc(${progressPct}% - 5px)`,
            } as CSSProperties
          }
        />
      </div>
      <span className="w-9 font-mono text-xs tabular-nums text-text-muted">
        {formatPlayerTime(effectiveDisplayedDuration)}
      </span>
    </div>
  );
}
