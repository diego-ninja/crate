import type {
  StatsAlbum,
  StatsArtist,
  StatsTrack,
} from "@/components/stats/stats-model";

export function statsTrackKey(item: StatsTrack): string {
  return String(
    item.track_id ??
      item.track_path ??
      `${item.artist}:${item.album}:${item.title}`,
  );
}

export function statsArtistKey(item: StatsArtist): string {
  return String(
    item.artist_id ??
      item.global_artist_uid ??
      item.artist_slug ??
      item.artist_name,
  );
}

export function statsAlbumKey(item: StatsAlbum): string {
  return String(
    item.album_id ??
      item.global_album_uid ??
      item.album_slug ??
      `${item.artist}:${item.album}`,
  );
}
