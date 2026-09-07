import { useTranslation } from "react-i18next";

import { formatDuration } from "@/lib/utils";

import type { SimilarTrack } from "./use-suggested-tracks";

export function SuggestedTrackRow({
  track,
  index,
  onPlay,
}: {
  track: SimilarTrack;
  index: number;
  onPlay: (track: SimilarTrack) => void;
}) {
  const { t } = useTranslation();
  const trackKey = track.track_entity_uid ?? track.track_id ?? track.path;

  return (
    <button
      key={trackKey}
      onClick={() => onPlay(track)}
      className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-text-primary/5"
    >
      <span className="w-4 shrink-0 text-right text-xs tabular-nums text-text-primary/20">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.75rem] text-text-primary/80">
          {track.title}
        </p>
        <p className="truncate text-xs text-text-primary/40">
          {track.artist} — {track.album}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs tabular-nums text-text-primary/40">
          {formatDuration(track.duration)}
        </span>
        <div className="h-1 w-12 overflow-hidden rounded-full bg-text-primary/5">
          <div
            className="h-full rounded-full bg-accent-action/60"
            style={{ width: `${Math.min(track.score * 100, 100)}%` }}
          />
        </div>
      </div>
      <span className="sr-only">
        {t("player.suggested.playSource", { title: track.title })}
      </span>
    </button>
  );
}
