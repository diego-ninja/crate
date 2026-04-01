import type { Track } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";

export async function fetchPlayableSetlist(artist: string): Promise<Track[]> {
  const response = await api<{
    tracks: {
      library_track_id: number;
      title: string;
      artist: string;
      album: string;
      path: string;
      duration?: number;
      navidrome_id?: string;
    }[];
  }>(`/api/artist/${encPath(artist)}/setlist-playable`);

  return (response.tracks || []).map((track) => ({
    id: track.path || track.navidrome_id || String(track.library_track_id),
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumCover: track.album
      ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}`
      : `/api/artist/${encPath(track.artist)}/photo`,
    path: track.path || undefined,
    navidromeId: track.navidrome_id || undefined,
    libraryTrackId: track.library_track_id,
  }));
}
