import { artistPhotoApiUrl } from "@/lib/library-routes";
import { cn } from "@/lib/utils";
import { EditorialPlaylistArtwork } from "@/components/playlists/EditorialPlaylistArtwork";

import type {
  HomeGeneratedPlaylistSummary,
  HomeGeneratedPlaylistDetail,
} from "./home-model";

type CoreTracksLike =
  | HomeGeneratedPlaylistSummary
  | HomeGeneratedPlaylistDetail;

function coreArtistPhoto(item: CoreTracksLike): string | null {
  const firstTrack = item.artwork_tracks?.[0];
  return (
    artistPhotoApiUrl(
      {
        artistId: firstTrack?.artist_id,
        globalArtistUid: firstTrack?.global_artist_uid,
        artistSlug: firstTrack?.artist_slug,
        artistName: firstTrack?.artist || item.name,
      },
      { size: 384 },
    ) || null
  );
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
    <EditorialPlaylistArtwork
      title={item.name}
      kicker="Artist Set"
      tracks={item.artwork_tracks}
      backgroundImageUrl={photoUrl}
      variant="core"
      className={cn("rounded-xl bg-text-primary/5", className)}
    />
  );
}
