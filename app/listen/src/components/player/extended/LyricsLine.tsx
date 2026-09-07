import type { RefObject } from "react";

import type { LyricLine } from "./lyrics-data";

export function LyricsLine({
  line,
  index,
  activeIndex,
  activeRef,
  onSeek,
}: {
  line: LyricLine;
  index: number;
  activeIndex: number;
  activeRef: RefObject<HTMLButtonElement | null>;
  onSeek: (time: number) => void;
}) {
  const isActive = index === activeIndex;
  const isPast = index < activeIndex;

  return (
    <button
      ref={isActive ? activeRef : null}
      onClick={() => onSeek(line.time)}
      className={`relative z-20 w-full rounded-md px-2 py-1 text-left transition-all duration-500 ${
        isActive
          ? "lyrics-active-line bg-accent-action/10 text-[17px] font-semibold text-accent-action"
          : isPast
            ? "text-[0.875rem] text-text-faint"
            : "text-[0.875rem] text-text-secondary"
      }`}
    >
      {line.text}
    </button>
  );
}
