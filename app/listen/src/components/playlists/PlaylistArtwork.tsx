import { resolveMaybeApiAssetUrl } from "@/lib/api";
import { albumCoverApiUrl } from "@/lib/library-routes";
import {
  PlaylistArtwork as PlaylistArtworkBase,
  type PlaylistArtworkTrack,
} from "@crate/ui/domain/playlists/PlaylistArtwork";

export type { PlaylistArtworkTrack };

function buildCoverUrl(track: PlaylistArtworkTrack): string | null {
  if (!track.artist || !track.album) return null;
  return albumCoverApiUrl({
    albumId: track.album_id,
    albumEntityUid: track.album_entity_uid,
    artistEntityUid: track.artist_entity_uid,
    albumSlug: track.album_slug,
    artistName: track.artist,
    albumName: track.album,
  }, { size: 256 }) || null;
}

export function PlaylistArtwork(props: Omit<React.ComponentProps<typeof PlaylistArtworkBase>, "buildCoverUrl" | "logoSrc">) {
  return (
    <PlaylistArtworkBase
      {...props}
      coverDataUrl={resolveMaybeApiAssetUrl(props.coverDataUrl)}
      buildCoverUrl={buildCoverUrl}
      logoSrc="/icons/logo.svg"
    />
  );
}
