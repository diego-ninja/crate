import { useTranslation } from "react-i18next";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import {
  itemKey,
  UpcomingShowCard,
  type UpcomingItem,
} from "@/components/upcoming/UpcomingRows";

import { RelatedGenreCard, type RelatedGenre } from "./RelatedGenreCard";
import type { GenreDetail } from "./explore-model";
import {
  GenreActionBar,
  GenreHero,
  type GenreActionBarProps,
} from "./GenreDetailHero";

function RelatedGenresSection({
  genres,
  onOpen,
}: {
  genres: RelatedGenre[];
  onOpen: (genre: RelatedGenre) => void;
}) {
  const { t } = useTranslation();
  if (!genres.length) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <h2 className="text-lg font-bold">{t("genre.related.title")}</h2>
          <p className="mt-1 text-xs text-text-muted">
            {t("genre.related.subtitle")}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {genres.map((genre) => (
          <RelatedGenreCard
            key={`${genre.relation_type}-${genre.slug}`}
            genre={genre}
            onOpen={() => onOpen(genre)}
          />
        ))}
      </div>
    </section>
  );
}

function ShowsSection({
  shows,
  expandedShowId,
  onToggle,
}: {
  shows: UpcomingItem[];
  expandedShowId: string | null;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation();
  if (!shows.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="px-1 text-lg font-bold">{t("genre.sections.shows")}</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {shows.map((show, index) => {
          const key = itemKey(show, index);
          return (
            <UpcomingShowCard
              key={key}
              item={show}
              expanded={expandedShowId === key}
              onToggle={() => onToggle(key)}
            />
          );
        })}
      </div>
    </section>
  );
}

function ArtistsSection({ artists }: { artists: GenreDetail["artists"] }) {
  const { t } = useTranslation();
  if (!artists.length) return null;
  return (
    <div className="space-y-3">
      <h2 className="px-1 text-lg font-bold">{t("nav.collection.artists")}</h2>
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {artists.map((artist) => (
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
            compact
            layout="grid"
          />
        ))}
      </div>
    </div>
  );
}

function AlbumsSection({ albums }: { albums: GenreDetail["albums"] }) {
  const { t } = useTranslation();
  if (!albums.length) return null;
  return (
    <div className="space-y-3">
      <h2 className="px-1 text-lg font-bold">{t("nav.collection.albums")}</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {albums.map((album) => (
          <AlbumCard
            key={
              album.global_album_uid ??
              album.album_id ??
              `${album.artist}-${album.name}`
            }
            artist={album.artist}
            album={album.name}
            albumId={album.album_id ?? undefined}
            albumEntityUid={album.album_entity_uid}
            globalAlbumUid={album.global_album_uid}
            artistEntityUid={album.artist_entity_uid}
            albumSlug={album.album_slug}
            year={album.year}
            cover={album.cover_url ?? undefined}
            layout="grid"
          />
        ))}
      </div>
    </div>
  );
}

export function GenreDetailContent({
  actionBar,
  artistCount,
  artists,
  albumCount,
  albums,
  data,
  description,
  expandedShowId,
  heroCoverUrl,
  onCoverError,
  onOpenRelated,
  onToggleShow,
  relatedGenres,
  trackCount,
}: {
  actionBar: GenreActionBarProps;
  artistCount: number;
  artists: GenreDetail["artists"];
  albumCount: number;
  albums: GenreDetail["albums"];
  data: GenreDetail;
  description: string;
  expandedShowId: string | null;
  heroCoverUrl: string | null;
  onCoverError: () => void;
  onOpenRelated: (genre: RelatedGenre) => void;
  onToggleShow: (key: string) => void;
  relatedGenres: RelatedGenre[];
  trackCount: number;
}) {
  return (
    <div className="space-y-6">
      <GenreHero
        artistCount={artistCount}
        albumCount={albumCount}
        data={data}
        description={description}
        heroCoverUrl={heroCoverUrl}
        onCoverError={onCoverError}
        trackCount={trackCount}
      />
      <GenreActionBar {...actionBar} />
      <RelatedGenresSection genres={relatedGenres} onOpen={onOpenRelated} />
      <ShowsSection
        shows={data.shows?.slice(0, 5) ?? []}
        expandedShowId={expandedShowId}
        onToggle={onToggleShow}
      />
      <ArtistsSection artists={artists} />
      <AlbumsSection albums={albums} />
    </div>
  );
}
