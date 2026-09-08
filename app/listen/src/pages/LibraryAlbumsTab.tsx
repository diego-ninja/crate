import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { useApi } from "@/hooks/use-api";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import { CollectionSortDropdown } from "./LibraryCollectionSortDropdown";
import { EmptyState, Spinner } from "./LibraryPrimitives";
import {
  albumSortOptions,
  type AlbumSort,
  type SavedAlbum,
} from "./library-collection-model";

export function LibraryAlbumsTab() {
  const { t } = useTranslation();
  const { data: albums, loading } = useApi<SavedAlbum[]>(
    "/api/catalog/me/albums",
  );
  const isDesktop = useIsDesktop();
  const [sort, setSort] = useState<AlbumSort>("recent");

  const sortedAlbums = useMemo(() => {
    if (!albums) return [];
    return [...albums].sort((a, b) => {
      if (sort === "name") {
        return a.name.localeCompare(b.name);
      }
      if (sort === "artist") {
        return a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name);
      }
      if (sort === "year") {
        return (
          Number(b.year || 0) - Number(a.year || 0) ||
          a.name.localeCompare(b.name)
        );
      }
      return new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime();
    });
  }, [albums, sort]);

  if (loading) return <Spinner />;
  if (!albums || albums.length === 0) {
    return <EmptyState message={t("library.albums.empty")} />;
  }

  return (
    <div className="space-y-4">
      {!isDesktop ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold uppercase tracking-[0.16em] text-text-primary/40">
            {t("library.sort.label")}
          </span>
          <CollectionSortDropdown
            label={t("library.sort.albums")}
            value={sort}
            options={albumSortOptions}
            onChange={setSort}
          />
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
        {sortedAlbums.map((album) => (
          <AlbumCard
            key={album.global_album_uid ?? album.id}
            artist={album.artist}
            album={album.name}
            albumId={album.id ?? undefined}
            albumEntityUid={album.album_entity_uid}
            globalAlbumUid={album.global_album_uid}
            artistEntityUid={album.artist_entity_uid}
            albumSlug={album.slug}
            year={album.year}
            cover={album.cover_url ?? undefined}
            layout="grid"
          />
        ))}
      </div>
    </div>
  );
}
