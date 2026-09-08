import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";

import type { SearchResults } from "./explore-model";
import { ExploreSectionRail } from "./ExplorePrimitives";

export function SearchResultsView({ results }: { results: SearchResults }) {
  const { t } = useTranslation();
  const hasArtists = results.artists.length > 0;
  const hasAlbums = results.albums.length > 0;
  const hasTracks = results.tracks.length > 0;
  const trackRows = useMemo<TrackRowData[]>(
    () =>
      results.tracks.slice(0, 10).map((track) => ({
        ...track,
        path: track.path || "",
        duration: track.duration || 0,
        library_track_id: track.id,
      })),
    [results.tracks],
  );

  if (!hasArtists && !hasAlbums && !hasTracks) {
    return (
      <p className="mt-8 text-sm text-text-muted">
        {t("explore.search.noResults")}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {hasArtists ? (
        <div className="space-y-3">
          <h2 className="px-1 text-lg font-bold">
            {t("nav.collection.artists")}
          </h2>
          <ExploreSectionRail>
            {results.artists.map((artist) => (
              <ArtistCard
                key={artist.id ?? artist.name}
                name={artist.name}
                artistId={artist.id}
                artistSlug={artist.slug}
                subtitle={
                  artist.album_count
                    ? t("common.albumCountLabel", {
                        count: artist.album_count,
                      })
                    : undefined
                }
              />
            ))}
          </ExploreSectionRail>
        </div>
      ) : null}

      {hasAlbums ? (
        <div className="space-y-3">
          <h2 className="px-1 text-lg font-bold">
            {t("nav.collection.albums")}
          </h2>
          <ExploreSectionRail>
            {results.albums.map((album) => (
              <AlbumCard
                key={album.id || `${album.artist}-${album.name}`}
                artist={album.artist}
                album={album.name}
                albumId={album.id}
                albumSlug={album.slug}
                year={album.year}
              />
            ))}
          </ExploreSectionRail>
        </div>
      ) : null}

      {hasTracks ? (
        <div className="space-y-3">
          <h2 className="px-1 text-lg font-bold">{t("common.tracks")}</h2>
          <div className="rounded-xl border border-border-quiet bg-surface-quiet-subtle">
            {trackRows.map((row, index) => (
              <TrackRow
                key={
                  row.id ??
                  row.global_track_uid ??
                  row.entity_uid ??
                  row.path ??
                  [row.artist, row.album, row.title].join(":")
                }
                track={row}
                index={index + 1}
                showArtist
                showAlbum
                queueTracks={trackRows}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
