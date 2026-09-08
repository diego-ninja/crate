import { useTranslation } from "react-i18next";

import type { TrackRowData } from "@/components/cards/TrackRow";
import type { PlayerActionsValue } from "@/contexts/player-context";

import { SearchAlbumResults } from "./SearchAlbumResults";
import { SearchArtistResults } from "./SearchArtistResults";
import { SearchNoResultsState } from "./SearchNoResultsState";
import { SearchTrackResults } from "./SearchTrackResults";
import type { SearchData } from "./search-results-model";

export function SearchResultsContent({
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
  const noResults =
    data.artists.length === 0 &&
    data.albums.length === 0 &&
    data.tracks.length === 0;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">
        {t("search.resultsFor", { query })}
      </h1>
      {data.artists.length > 0 ? (
        <SearchArtistResults artists={data.artists} />
      ) : null}
      {data.albums.length > 0 ? (
        <SearchAlbumResults albums={data.albums} />
      ) : null}
      {trackRowData.length > 0 ? (
        <SearchTrackResults
          data={data}
          query={query}
          trackRowData={trackRowData}
          playAll={playAll}
        />
      ) : null}
      {noResults ? <SearchNoResultsState /> : null}
    </div>
  );
}
