import { useTranslation } from "react-i18next";
import { Play } from "@crate/ui/icons";

import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import type { PlayerActionsValue } from "@/contexts/player-context";

import {
  toSearchPlayerTrack,
  trackAlbumCover,
  type SearchData,
} from "./search-results-model";

export function SearchTrackResults({
  data,
  query,
  trackRowData,
  playAll,
}: {
  data: SearchData;
  query: string;
  trackRowData: TrackRowData[];
  playAll: PlayerActionsValue["playAll"];
}) {
  const { t } = useTranslation();

  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold">
          {t("search.tracksCount", { count: data.tracks.length })}
        </h2>
        <button
          onClick={() =>
            playAll(data.tracks.map(toSearchPlayerTrack), 0, {
              type: "queue",
              name: t("search.playSource", { query }),
            })
          }
          className="flex items-center gap-1.5 rounded-full bg-accent-action px-3 py-1.5 text-xs font-medium text-accent-action-foreground"
        >
          <Play size={12} fill="currentColor" /> {t("search.playAll")}
        </button>
      </div>
      <div>
        {trackRowData.map((track, index) => (
          <TrackRow
            key={
              track.id ??
              track.global_track_uid ??
              track.entity_uid ??
              track.path ??
              [track.artist, track.album, track.title].join(":")
            }
            track={track}
            index={index}
            showArtist
            showAlbum
            queueTracks={trackRowData}
            albumCover={trackAlbumCover(data.tracks[index]!)}
          />
        ))}
      </div>
    </section>
  );
}
