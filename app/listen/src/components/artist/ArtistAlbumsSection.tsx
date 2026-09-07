import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Disc3 } from "@crate/ui/icons";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { CrateImage } from "@/components/artwork/CrateImage";
import { type ArtistAlbum } from "@/components/artist/artist-model";
import { albumPagePath } from "@/lib/library-routes";

import {
  buildArtistAlbumPresentation,
  releaseCategory,
  RELEASE_GROUPS,
  type ArtistReleaseCategory,
  type ArtistAlbumPresentation,
} from "./artist-library-model";

interface ArtistAlbumsSectionProps {
  artistName: string;
  artistSlug?: string;
  albums: ArtistAlbum[];
}

function ArtistAlbumArtwork({
  album,
  cover,
  coverSrcSet,
}: {
  album: ArtistAlbum;
  cover?: string;
  coverSrcSet?: string;
}) {
  return (
    <div className="relative mb-2 aspect-square overflow-hidden rounded-lg bg-text-primary/5">
      {cover ? (
        <CrateImage
          src={cover}
          srcSet={coverSrcSet}
          sizes="(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 20vw"
          alt={album.display_name || album.name}
          loading="lazy"
          decoding="async"
          className=" size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <Disc3 size={32} className="text-text-primary/25" />
        </div>
      )}
    </div>
  );
}

function ArtistGlobalAlbumItem({
  album,
  artistName,
  artistSlug,
  presentation,
}: {
  album: ArtistAlbum;
  artistName: string;
  artistSlug?: string;
  presentation: ArtistAlbumPresentation;
}) {
  return (
    <Link
      to={albumPagePath({
        albumId: presentation.localAlbumId,
        globalAlbumUid: presentation.globalAlbumUid!,
        albumSlug: album.slug,
        artistSlug,
        artistName,
        albumName: presentation.albumName,
      })}
      className="group w-full min-w-0 snap-start cursor-pointer rounded-xl p-2 text-left transition-colors hover:bg-text-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <ArtistAlbumArtwork
        album={album}
        cover={presentation.cover}
        coverSrcSet={presentation.coverSrcSet}
      />
      <p className="truncate text-sm font-medium text-text-primary">
        {presentation.albumName}
      </p>
      <p className="truncate text-xs text-text-muted">
        {album.year ? `${album.year.slice(0, 4)} · ${artistName}` : artistName}
      </p>
    </Link>
  );
}

function ArtistAlbumItem({
  album,
  artistName,
  artistSlug,
}: {
  album: ArtistAlbum;
  artistName: string;
  artistSlug?: string;
}) {
  const presentation = buildArtistAlbumPresentation(
    album,
    artistName,
    artistSlug,
  );

  if (presentation.globalAlbumUid) {
    return (
      <ArtistGlobalAlbumItem
        album={album}
        artistName={artistName}
        artistSlug={artistSlug}
        presentation={presentation}
      />
    );
  }

  return (
    <AlbumCard
      artist={artistName}
      album={presentation.albumName}
      albumId={presentation.localAlbumId}
      albumSlug={album.slug}
      artistSlug={artistSlug}
      year={album.year?.slice(0, 4)}
      cover={presentation.cover}
      isPreRelease={album.is_pre_release}
      releaseDate={album.release_date}
      layout="grid"
    />
  );
}

export function ArtistAlbumsSection({
  artistName,
  artistSlug,
  albums,
}: ArtistAlbumsSectionProps) {
  const { t } = useTranslation();
  const groupedAlbums = useMemo(() => {
    const albumsByCategory = new Map<ArtistReleaseCategory, ArtistAlbum[]>();
    for (const album of albums) {
      const category = releaseCategory(album);
      const categoryAlbums = albumsByCategory.get(category) ?? [];
      categoryAlbums.push(album);
      albumsByCategory.set(category, categoryAlbums);
    }

    return RELEASE_GROUPS.flatMap((group) => {
      const categoryAlbums = albumsByCategory.get(group.category);
      return categoryAlbums?.length
        ? [{ ...group, albums: categoryAlbums }]
        : [];
    });
  }, [albums]);
  if (!albums.length) return null;

  return (
    <div className="space-y-10">
      {groupedAlbums.map((group) => (
        <section key={group.category}>
          <h2 className="mb-4 text-lg font-semibold text-text-primary">
            {t(group.labelKey)}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {group.albums.map((album) => (
              <ArtistAlbumItem
                key={
                  album.global_album_uid ??
                  album.global_uid ??
                  album.id ??
                  `${album.name}-${album.year}`
                }
                album={album}
                artistName={artistName}
                artistSlug={artistSlug}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
