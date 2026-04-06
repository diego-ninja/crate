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
      title: string;
      artist: string;
      artist_id?: number;
      artist_slug?: string;
      album: string;
      album_id?: number;
      album_slug?: string;
      path: string;
      duration?: number;
      navidrome_id?: string;
    }[];
  }>(`/api/artists/${input.artistId}/setlist-playable`);

  return (response.tracks || []).map((track) => ({
    id: track.path || track.navidrome_id || String(track.library_track_id),
    title: track.title,
    artist: track.artist,
    artistId: track.artist_id,
    artistSlug: track.artist_slug,
    album: track.album,
    albumId: track.album_id,
    albumSlug: track.album_slug,
    albumCover: track.album
      ? albumCoverApiUrl({ albumId: track.album_id, albumSlug: track.album_slug, artistName: track.artist, albumName: track.album })
      : artistPhotoApiUrl({ artistId: track.artist_id, artistSlug: track.artist_slug, artistName: track.artist || input.artistName }),
    path: track.path || undefined,
    navidromeId: track.navidrome_id || undefined,
    libraryTrackId: track.library_track_id,
  }));
}
