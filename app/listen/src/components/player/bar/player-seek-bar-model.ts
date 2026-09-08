import { useCallback, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  PointerEvent,
  RefObject,
  SyntheticEvent,
} from "react";

import { formatPlayerTime } from "@/components/player/bar/player-bar-utils";

export interface SeekBarModel {
  safeDuration: number;
  displayedTime: number;
  progress: number;
  hoverPercent: number | null;
  hoverTime: string | null;
  trackRef: RefObject<HTMLDivElement | null>;
  sliderStyle: CSSVariableStyle;
  glowTrackClass: string;
  glowWidthStyle: CSSVariableStyle;
  glowLeftStyle: CSSVariableStyle;
  beginScrubbing: () => void;
  endScrubbing: () => void;
  handleHover: (event: PointerEvent<HTMLDivElement>) => void;
  clearHover: () => void;
  stopPropagation: (event: SyntheticEvent) => void;
  commitSeek: (value: number) => void;
}

type CSSVariableStyle = CSSProperties & {
  [key: `--${string}`]: string;
};

function stopEventPropagation(event: SyntheticEvent) {
  event.stopPropagation();
}

export function useSeekBarModel(
  currentTime: number,
  duration: number,
  thin: boolean,
  onSeek: (time: number) => void,
): SeekBarModel {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [draftTime, setDraftTime] = useState<number | null>(null);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const displayedTime =
    isScrubbing && draftTime != null ? draftTime : currentTime;
  const progress =
    safeDuration > 0
      ? Math.max(0, Math.min(100, (displayedTime / safeDuration) * 100))
      : 0;
  const sliderStyle = useMemo(
    () => ({ "--seek-progress": `${progress}%` }),
    [progress],
  );
  const hoverTime =
    hoverPercent != null && safeDuration > 0
      ? formatPlayerTime(hoverPercent * safeDuration)
      : null;

  const handleHover = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const element = trackRef.current;
      if (!element || safeDuration <= 0) return;
      const rect = element.getBoundingClientRect();
      const percent = Math.max(
        0,
        Math.min(1, (event.clientX - rect.left) / rect.width),
      );
      setHoverPercent(percent);
    },
    [safeDuration],
  );

  function commitSeek(value: number) {
    const clamped =
      safeDuration > 0 ? Math.max(0, Math.min(safeDuration, value)) : 0;
    setDraftTime(clamped);
    onSeek(clamped);
  }

  function beginScrubbing() {
    setDraftTime(currentTime);
    setIsScrubbing(true);
  }

  function endScrubbing() {
    setDraftTime(null);
    setIsScrubbing(false);
  }

  return {
    safeDuration,
    displayedTime,
    progress,
    hoverPercent,
    hoverTime,
    trackRef,
    sliderStyle,
    glowTrackClass: thin ? "h-[3px]" : "h-1",
    glowWidthStyle: { "--progress-scale": `${progress / 100}` },
    glowLeftStyle: { "--progress-left": `calc(${progress}% - 4px)` },
    beginScrubbing,
    endScrubbing,
    handleHover,
    clearHover: () => setHoverPercent(null),
    stopPropagation: stopEventPropagation,
    commitSeek,
  };
}
