import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Disc3 } from "@crate/ui/icons";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { CrateImage } from "@/components/artwork/CrateImage";
import { albumCoverApiUrl, albumPagePath } from "@/lib/library-routes";

import { albumGlobalUid, type SearchAlbum } from "./search-results-model";

export function SearchAlbumResults({ albums }: { albums: SearchAlbum[] }) {
  const { t } = useTranslation();

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">
        {t("search.albumsCount", { count: albums.length })}
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {albums.map((album) => {
          const globalUid = albumGlobalUid(album);
          return globalUid ? (
            <Link
              key={globalUid}
              to={albumPagePath({
                albumId: album.id,
                albumEntityUid: album.entity_uid,
                globalAlbumUid: globalUid,
                albumSlug: album.slug,
                artistSlug: album.artist_slug,
                artistName: album.artist,
                albumName: album.name,
              })}
              className="group w-full min-w-0 snap-start cursor-pointer rounded-xl p-2 text-left transition-colors hover:bg-text-primary/5 focus-visible:rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <div className="relative mb-2 aspect-square overflow-hidden rounded-lg bg-text-primary/5">
                {album.has_cover ? (
                  <CrateImage
                    src={albumCoverApiUrl(
                      { globalAlbumUid: globalUid },
                      { size: 320 },
                    )}
                    alt={album.name}
                    loading="lazy"
                    className=" size-full object-cover"
                    onError={(event) => {
                      (event.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <Disc3 size={32} className="text-text-primary/25" />
                  </div>
                )}
              </div>
              <p className="truncate text-sm font-medium text-text-primary">
                {album.name}
              </p>
              <p className="truncate text-xs text-text-muted">
                {album.year ? album.year + " · " + album.artist : album.artist}
              </p>
            </Link>
          ) : (
            <AlbumCard
              layout="grid"
              key={
                album.id || album.entity_uid || album.artist + "-" + album.name
              }
              artist={album.artist}
              album={album.name}
              albumId={album.id}
              albumEntityUid={album.entity_uid}
              artistEntityUid={album.artist_entity_uid}
              albumSlug={album.slug}
              year={album.year}
            />
          );
        })}
      </div>
    </section>
  );
}
