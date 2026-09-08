import { useTranslation } from "react-i18next";

import { ArtistCard } from "@/components/cards/ArtistCard";
import { artistPagePath } from "@/lib/library-routes";

import { artistGlobalUid, type SearchArtist } from "./search-results-model";

export function SearchArtistResults({ artists }: { artists: SearchArtist[] }) {
  const { t } = useTranslation();

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">
        {t("search.artistsCount", { count: artists.length })}
      </h2>
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {artists.map((artist) => {
          const globalUid = artistGlobalUid(artist);
          return globalUid ? (
            <ArtistCard
              key={globalUid}
              name={artist.name}
              globalArtistUid={globalUid}
              hasPhoto={artist.has_photo}
              layout="grid"
              href={artistPagePath({
                artistId: artist.id,
                artistEntityUid: artist.entity_uid,
                globalArtistUid: globalUid,
                artistSlug: artist.slug,
                artistName: artist.name,
              })}
            />
          ) : (
            <ArtistCard
              key={artist.id || artist.entity_uid || artist.name}
              name={artist.name}
              artistId={artist.id}
              artistEntityUid={artist.entity_uid}
              artistSlug={artist.slug}
              layout="grid"
            />
          );
        })}
      </div>
    </section>
  );
}
