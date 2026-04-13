import type { Track } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { albumCoverApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";

export async function fetchPlayableSetlist(input: { artistId?: number; artistName: string }): Promise<Track[]> {
  if (input.artistId == null) {
    return [];
  }
  const response = await api<{
    tracks: {
      library_track_id: number;
      track_storage_id?: string;
      title: string;
      artist: string;
      artist_id?: number;
      artist_slug?: string;
      album: string;
      album_id?: number;
      album_slug?: string;
      path: string;
      duration?: number;
    }[];
  }>(`/api/artists/${input.artistId}/setlist-playable`);

  return (response.tracks || []).map((track) => ({
    id: track.track_storage_id || track.path || String(track.library_track_id),
    storageId: track.track_storage_id,
    title: track.title,
    artist: track.artist,
    artistId: track.artist_id,
    artistSlug: track.artist_slug,
    album: track.album,
    albumId: track.album_id,
    albumSlug: track.album_slug,
    path: track.path,
    libraryTrackId: track.library_track_id,
    albumCover: albumCoverApiUrl({ albumId: track.album_id, albumSlug: track.album_slug, artistName: track.artist, albumName: track.album })
      || artistPhotoApiUrl({ artistId: track.artist_id, artistSlug: track.artist_slug, artistName: track.artist })
      || undefined,
  }));
}
