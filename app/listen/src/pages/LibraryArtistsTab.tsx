import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ArtistCard } from "@/components/cards/ArtistCard";
import { useApi } from "@/hooks/use-api";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import { EmptyState, Spinner } from "./LibraryPrimitives";
import { CollectionSortDropdown } from "./LibraryCollectionSortDropdown";
import {
  artistSortOptions,
  type ArtistSort,
  type FollowedArtist,
} from "./library-collection-model";

export function LibraryArtistsTab() {
  const { t } = useTranslation();
  const { data: artists, loading } = useApi<FollowedArtist[]>(
    "/api/catalog/me/artists",
  );
  const isDesktop = useIsDesktop();
  const [sort, setSort] = useState<ArtistSort>("recent");

  const sortedArtists = useMemo(() => {
    if (!artists) return [];
    return [...artists].sort((a, b) => {
      if (sort === "name") {
        return a.artist_name.localeCompare(b.artist_name);
      }
      if (sort === "popularity") {
        const aScore = a.album_count * 12 + a.track_count;
        const bScore = b.album_count * 12 + b.track_count;
        return bScore - aScore || a.artist_name.localeCompare(b.artist_name);
      }
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
  }, [artists, sort]);

  if (loading) return <Spinner />;
  if (!artists || artists.length === 0) {
    return <EmptyState message={t("library.artists.empty")} />;
  }

  return (
    <div className="space-y-4">
      {!isDesktop ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold uppercase tracking-[0.16em] text-text-primary/40">
            {t("library.sort.label")}
          </span>
          <CollectionSortDropdown
            label={t("library.sort.artists")}
            value={sort}
            options={artistSortOptions}
            onChange={setSort}
          />
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
        {sortedArtists.map((artist) => (
          <ArtistCard
            key={
              artist.global_artist_uid ?? artist.artist_id ?? artist.artist_name
            }
            name={artist.artist_name}
            artistId={artist.artist_id}
            artistEntityUid={artist.artist_entity_uid}
            globalArtistUid={artist.global_artist_uid}
            artistSlug={artist.artist_slug}
            photo={artist.photo_url ?? undefined}
            hasPhoto={artist.has_photo}
            subtitle={t("common.albumCountLabel", {
              count: artist.album_count,
            })}
            layout="grid"
          />
        ))}
      </div>
    </div>
  );
}
