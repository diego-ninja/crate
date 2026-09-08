export interface BandcampCollectionResponse {
  items: BandcampItem[];
  total: number;
}

export interface BandcampTaskResponse {
  task_id: string;
  status: string;
}

export interface BandcampItem {
  id: number;
  bandcamp_item_id?: number | null;
  artist_name?: string | null;
  album_title?: string | null;
  track_title?: string | null;
  item_url?: string | null;
  cover_url?: string | null;
  owned?: boolean | null;
  downloadable?: boolean | null;
  latest_import_status?: string | null;
}

export interface ContributionsResponse {
  items: LibraryContribution[];
  total: number;
}

export interface LibraryContribution {
  id: number;
  album_id?: number | null;
  album_entity_uid?: string | null;
  album_slug?: string | null;
  artist_name: string;
  album_name: string;
  source: string;
  source_ref: string;
  status: string;
  imported_at?: string | null;
  track_entity_uids?: string[];
  track_count?: number | null;
  total_duration?: number | null;
  has_cover?: boolean | null;
}
