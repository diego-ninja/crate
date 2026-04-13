import { artistPhotoApiUrl } from "@/lib/library-routes";
import { cn } from "@/lib/utils";

import type { HomeGeneratedPlaylistSummary, HomeGeneratedPlaylistDetail } from "./home-model";

type CoreTracksLike = HomeGeneratedPlaylistSummary | HomeGeneratedPlaylistDetail;

function coreArtistPhoto(item: CoreTracksLike): string | null {
  const firstTrack = item.artwork_tracks?.[0];
  return artistPhotoApiUrl({
    artistId: firstTrack?.artist_id,
    artistSlug: firstTrack?.artist_slug,
    artistName: item.name,
  }) || null;
}

export function CoreTracksArtwork({
  item,
  className,
}: {
  item: CoreTracksLike;
  className?: string;
}) {
  const photoUrl = coreArtistPhoto(item);

  return (
    <div className={cn("relative overflow-hidden rounded-3xl bg-white/5", className)}>
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={item.name}
          className="h-full w-full object-cover grayscale"
        />
      ) : (
        <div className="absolute inset-0 bg-[linear-gradient(145deg,rgba(28,34,40,0.95),rgba(10,14,18,1))]" />
      )}

      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,8,12,0.12)_0%,rgba(4,8,12,0.35)_52%,rgba(4,8,12,0.92)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_38%)]" />

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
