import type { CSSProperties, PointerEvent } from "react";
import { useTranslation } from "react-i18next";

import { formatPlayerTime } from "@/components/player/bar/player-bar-utils";

import type { SeekBarModel } from "./player-seek-bar-model";

export function SeekBarTimes({
  displayedTime,
  safeDuration,
}: Pick<SeekBarModel, "displayedTime" | "safeDuration">) {
  return (
    <div className="flex items-center justify-between text-xs tabular-nums text-text-muted">
      <span>{formatPlayerTime(displayedTime)}</span>
      <span>{formatPlayerTime(safeDuration)}</span>
    </div>
  );
}

export function SeekBarTooltip({
  hoverPercent,
  hoverTime,
  className,
}: Pick<SeekBarModel, "hoverPercent" | "hoverTime"> & {
  className: string;
}) {
  if (hoverTime == null || hoverPercent == null) return null;
  return (
    <div
      className={`listen-player-progress-tooltip pointer-events-none absolute -translate-x-1/2 rounded border px-1.5 py-0.5 text-xs tabular-nums ${className}`}
      style={{ left: `${hoverPercent * 100}%` }}
    >
      {hoverTime}
    </div>
  );
}

function SeekBarFrame({
  className,
  showTimes,
  disabled,
  model,
  children,
}: {
  className: string;
  showTimes: boolean;
  disabled: boolean;
  model: SeekBarModel;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${className} ${showTimes ? "space-y-1.5" : ""} ${
        disabled ? "grayscale opacity-50" : ""
      }`}
      role="presentation"
      onClick={model.stopPropagation}
      onKeyDown={model.stopPropagation}
      onPointerDown={model.stopPropagation}
      onTouchStart={model.stopPropagation}
    >
      {showTimes ? (
        <SeekBarTimes
          displayedTime={model.displayedTime}
          safeDuration={model.safeDuration}
        />
      ) : null}
      {children}
    </div>
  );
}

function SeekInput({
  model,
  disabled,
  className,
  style,
  onPointerDown,
}: {
  model: SeekBarModel;
  disabled: boolean;
  className: string;
  style?: React.CSSProperties;
  onPointerDown?: (event: PointerEvent<HTMLInputElement>) => void;
}) {
  const { t } = useTranslation();
  return (
    <input
      type="range"
      min={0}
      max={model.safeDuration || 1}
      step={0.1}
      value={
        model.safeDuration > 0
          ? Math.min(model.displayedTime, model.safeDuration)
          : 0
      }
      disabled={disabled || model.safeDuration <= 0}
      aria-label={t("player.seek")}
      className={className}
      style={style}
      onPointerDown={(event) => {
        model.stopPropagation(event);
        model.beginScrubbing();
        onPointerDown?.(event);
      }}
      onPointerUp={(event) => {
        model.stopPropagation(event);
        model.endScrubbing();
      }}
      onTouchEnd={(event) => {
        model.stopPropagation(event);
        model.endScrubbing();
      }}
      onBlur={model.endScrubbing}
      onChange={(event) => model.commitSeek(Number(event.target.value || 0))}
    />
  );
}

export function GlowSeekBar({
  className,
  showTimes,
  disabled,
  model,
}: {
  className: string;
  showTimes: boolean;
  disabled: boolean;
  model: SeekBarModel;
}) {
  return (
    <SeekBarFrame
      className={className}
      showTimes={showTimes}
      disabled={disabled}
      model={model}
    >
      <div
        ref={model.trackRef}
        className="listen-player-progress group relative py-3"
        onPointerMove={model.handleHover}
        onPointerLeave={model.clearHover}
      >
        <SeekBarTooltip
          hoverPercent={model.hoverPercent}
          hoverTime={model.hoverTime}
          className="-top-6"
        />
        <div
          className={`listen-player-progress-track absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full ${model.glowTrackClass}`}
        />
        <div
          className="listen-player-progress-width-dynamic pointer-events-none absolute left-0 top-1/2 h-3 overflow-hidden rounded-full opacity-65"
          style={model.glowWidthStyle}
        >
          <div className="listen-player-progress-glow absolute inset-0 blur-[3px]" />
          <div className="listen-player-progress-fill absolute inset-y-[5px] inset-x-0 rounded-full" />
        </div>
        <div
          className={`listen-player-progress-fill listen-player-progress-width-dynamic absolute left-0 top-1/2 rounded-full ${model.glowTrackClass}`}
          style={model.glowWidthStyle}
        />
        <div
          className={`listen-player-progress-thumb listen-player-progress-left-dynamic pointer-events-none absolute top-1/2 size-2 -translate-y-1/2 rounded-full transition-opacity duration-150 ${
            model.progress > 0 ? "opacity-[0.62]" : "opacity-0"
          }`}
          style={{
            ...model.glowLeftStyle,
          }}
        />
        <div
          className="listen-player-progress-thumb-active listen-player-progress-left-active-dynamic absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full border opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          style={
            {
              "--progress-left": `calc(${model.progress}% - 5px)`,
            } as CSSProperties
          }
        />
        <SeekInput
          model={model}
          disabled={disabled}
          className="absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 cursor-pointer opacity-0 disabled:cursor-default"
        />
      </div>
    </SeekBarFrame>
  );
}

export function DefaultSeekBar({
  className,
  compact,
  thin,
  showTimes,
  disabled,
  model,
}: {
  className: string;
  compact: boolean;
  thin: boolean;
  showTimes: boolean;
  disabled: boolean;
  model: SeekBarModel;
}) {
  return (
    <SeekBarFrame
      className={className}
      showTimes={showTimes}
      disabled={disabled}
      model={model}
    >
      <div
        ref={model.trackRef}
        className="relative"
        onPointerMove={model.handleHover}
        onPointerLeave={model.clearHover}
      >
        <SeekBarTooltip
          hoverPercent={model.hoverPercent}
          hoverTime={model.hoverTime}
          className="-top-8"
        />
        <SeekInput
          model={model}
          disabled={disabled}
          className={`listen-player-seek-input block w-full appearance-none rounded-full border-0 outline-none ${
            thin ? "h-1" : compact ? "h-1.5" : "h-2"
          } cursor-pointer disabled:cursor-default disabled:opacity-50`}
          style={model.sliderStyle}
        />
      </div>
    </SeekBarFrame>
  );
}
