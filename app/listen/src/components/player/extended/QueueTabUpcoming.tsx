import { useTranslation } from "react-i18next";

import type { Track } from "@/contexts/PlayerContext";

import { QueueTabRow } from "./QueueTabRow";

export function QueueTabUpcoming({
  tracks,
  currentIndex,
  sourceName,
  locked,
  onJump,
  onRemove,
}: {
  tracks: Track[];
  currentIndex: number;
  sourceName: string;
  locked: boolean;
  onJump: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  const { t } = useTranslation();
  if (!tracks.length) return null;

  return (
    <div>
      <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-text-muted">
        {t("player.queue.nextUpFrom", {
          source: sourceName,
          count: tracks.length,
        })}
      </p>
      {tracks.map((track, i) => {
        const index = currentIndex + 1 + i;
        return (
          <QueueTabRow
            key={`next-${track.id}-${index}`}
            track={track}
            indexLabel={String(i + 1)}
            onJump={() => onJump(index)}
            onRemove={locked ? undefined : () => onRemove(index)}
            locked={locked}
          />
        );
      })}
    </div>
  );
}
