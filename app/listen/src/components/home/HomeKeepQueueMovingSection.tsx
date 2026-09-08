import type { Track } from "@/contexts/PlayerContext";

import { SectionHeader, SectionRail } from "./HomeSections";
import { HomeQueueCardAction } from "./HomeQueueCardAction";

export function KeepQueueMovingSection({
  tracks,
  onPlayTrack,
}: {
  tracks: Track[];
  onPlayTrack: (track: Track) => void;
}) {
  if (!tracks.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Keep the queue moving"
        subtitle="Quick picks from your own recent listening."
      />
      <SectionRail>
        {tracks.map((track) => (
          <HomeQueueCardAction
            key={track.id}
            track={track}
            onPlay={() => onPlayTrack(track)}
          />
        ))}
      </SectionRail>
    </section>
  );
}
