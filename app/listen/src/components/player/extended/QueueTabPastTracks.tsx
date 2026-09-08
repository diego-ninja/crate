import { useTranslation } from "react-i18next";

import type { Track } from "@/contexts/PlayerContext";

import { QueueTabRow } from "./QueueTabRow";

export function QueueTabPastTracks({
  tracks,
  currentIndex,
  onJump,
  locked,
}: {
  tracks: Track[];
  currentIndex: number;
  onJump: (index: number) => void;
  locked: boolean;
}) {
  const { t } = useTranslation();
  if (!tracks.length) return null;

  return (
    <div className="mb-4">
      <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wider text-text-muted">
        {t("player.queue.history")}
      </p>
      {tracks.map((track, i) => {
        const realIdx = currentIndex - 1 - i;
        return (
          <QueueTabRow
            key={`hist-${track.id}-${realIdx}`}
            track={track}
            indexLabel={String(realIdx + 1)}
            onJump={() => onJump(realIdx)}
            faded
            locked={locked}
          />
        );
      })}
    </div>
  );
}
