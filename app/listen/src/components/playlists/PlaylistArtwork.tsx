import { albumCoverApiUrl } from "@/lib/library-routes";
import {
  PlaylistArtwork as PlaylistArtworkBase,
  type PlaylistArtworkTrack,
} from "@crate-ui/domain/playlists/PlaylistArtwork";

export type { PlaylistArtworkTrack };

function buildCoverUrl(track: PlaylistArtworkTrack): string | null {
  if (!track.artist || !track.album) return null;
  return albumCoverApiUrl({
    albumId: track.album_id,
    albumSlug: track.album_slug,
    artistName: track.artist,
    albumName: track.album,
  }) || null;
}

export function PlaylistArtwork(props: Omit<React.ComponentProps<typeof PlaylistArtworkBase>, "buildCoverUrl" | "logoSrc">) {
  return <PlaylistArtworkBase {...props} buildCoverUrl={buildCoverUrl} logoSrc="/icons/logo.svg" />;
}
