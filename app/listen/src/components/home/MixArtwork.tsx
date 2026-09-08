import { artistPhotoApiUrl } from "@/lib/library-routes";
import { CrateImage } from "@/components/artwork/CrateImage";
import { cn } from "@/lib/utils";

import type {
  HomeArtworkArtist,
  HomeGeneratedPlaylistDetail,
  HomeGeneratedPlaylistSummary,
} from "./home-model";

type MixLike = HomeGeneratedPlaylistSummary | HomeGeneratedPlaylistDetail;

function tilePhoto(artist: HomeArtworkArtist): string | null {
  return (
    artistPhotoApiUrl(
      {
        artistId: artist.artist_id,
        globalArtistUid: artist.global_artist_uid,
        artistSlug: artist.artist_slug,
        artistName: artist.artist_name,
      },
      { size: 256 },
    ) || null
  );
}

export function MixArtwork({
  item,
  className,
}: {
  item: MixLike;
  className?: string;
}) {
  const artists = item.artwork_artists?.slice(0, 4) || [];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl bg-text-primary/5",
        className,
      )}
    >
      <div className="grid size-full grid-cols-2 grid-rows-2">
        {Array.from({ length: 4 }).map((_, index) => {
          const artist = artists[index];
          const photoUrl = artist ? tilePhoto(artist) : null;
          return (
            <div
              key={`${artist?.artist_id ?? artist?.artist_name ?? index}`}
              className="mix-artwork-tile relative overflow-hidden"
            >
              {photoUrl ? (
                <CrateImage
                  src={photoUrl}
                  alt={artist?.artist_name || ""}
                  className=" size-full object-cover"
                />
              ) : null}
              <div className="mix-artwork-tile-scrim absolute inset-0" />
            </div>
          );
        })}
      </div>

      <div className="mix-artwork-scrim absolute inset-0" />
      <div className="mix-artwork-accent absolute inset-0" />

      <div className="absolute right-3.5 top-3.5 flex items-center justify-center">
        <img
          src="/icons/logo.svg"
          alt=""
          aria-hidden="true"
          className=" size-4.5 opacity-95 drop-shadow-artwork-compact-mark"
        />
      </div>
    </div>
  );
}
