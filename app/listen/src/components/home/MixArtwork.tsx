import { artistPhotoApiUrl } from "@/lib/library-routes";
import { cn } from "@/lib/utils";

import type {
  HomeArtworkArtist,
  HomeGeneratedPlaylistDetail,
  HomeGeneratedPlaylistSummary,
} from "./home-model";

type MixLike = HomeGeneratedPlaylistSummary | HomeGeneratedPlaylistDetail;

function tilePhoto(artist: HomeArtworkArtist): string | null {
  return artistPhotoApiUrl({
    artistId: artist.artist_id,
    artistSlug: artist.artist_slug,
    artistName: artist.artist_name,
  }) || null;
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
    <div className={cn("relative overflow-hidden rounded-3xl bg-white/5", className)}>
      <div className="grid h-full w-full grid-cols-2 grid-rows-2">
        {Array.from({ length: 4 }).map((_, index) => {
          const artist = artists[index];
          const photoUrl = artist ? tilePhoto(artist) : null;
          return (
            <div key={`${artist?.artist_id ?? artist?.artist_name ?? index}`} className="relative overflow-hidden bg-[linear-gradient(145deg,rgba(30,16,22,0.96),rgba(10,12,16,1))]">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={artist?.artist_name || ""}
                  className="h-full w-full object-cover"
                />
              ) : null}
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,12,16,0.18)_0%,rgba(10,12,16,0.55)_100%)]" />
            </div>
          );
        })}
      </div>

      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,10,14,0.04)_0%,rgba(8,10,14,0.24)_48%,rgba(8,10,14,0.84)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.16),transparent_42%)]" />

      <div className="absolute right-3.5 top-3.5 flex items-center justify-center">
        <img
          src="/icons/logo.svg"
          alt=""
          aria-hidden="true"
          className="h-4.5 w-4.5 opacity-95 drop-shadow-[0_1px_6px_rgba(0,0,0,0.45)]"
        />
      </div>
    </div>
  );
}
