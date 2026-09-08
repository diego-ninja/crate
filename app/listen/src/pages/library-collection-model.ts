export type ArtistSort = "recent" | "name" | "popularity";
export type AlbumSort = "recent" | "name" | "artist" | "year";
export type LikedSort = "recent" | "title" | "artist" | "album";

export interface FollowedArtist {
  artist_name: string;
  artist_id?: number;
  global_artist_uid?: string;
  artist_entity_uid?: string;
  artist_slug?: string;
  created_at: string;
  album_count: number;
  track_count: number;
  has_photo: boolean;
  photo_url?: string | null;
}

export interface SavedAlbum {
  saved_at: string;
  id?: number | null;
  global_album_uid?: string;
  album_entity_uid?: string;
  slug?: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  name: string;
  year: string;
  has_cover: boolean;
  cover_url?: string | null;
  track_count: number;
  total_duration: number;
}

export interface CollectionSortOption<T extends string> {
  value: T;
  labelKey: string;
}

export const artistSortOptions: CollectionSortOption<ArtistSort>[] = [
  { value: "recent", labelKey: "library.sort.recent" },
  { value: "name", labelKey: "common.name" },
  { value: "popularity", labelKey: "library.sort.popularity" },
];

export const albumSortOptions: CollectionSortOption<AlbumSort>[] = [
  { value: "recent", labelKey: "library.sort.recent" },
  { value: "name", labelKey: "common.name" },
  { value: "artist", labelKey: "common.artist" },
  { value: "year", labelKey: "library.sort.year" },
];

export const likedSortOptions: CollectionSortOption<LikedSort>[] = [
  { value: "recent", labelKey: "library.sort.recent" },
  { value: "title", labelKey: "library.sort.title" },
  { value: "artist", labelKey: "common.artist" },
  { value: "album", labelKey: "common.album" },
];
