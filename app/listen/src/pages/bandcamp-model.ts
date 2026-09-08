export interface BandcampConnectionStatus {
  connected: boolean;
  status: string;
  username?: string | null;
  display_name?: string | null;
  image_url?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
}

export interface BandcampCollectionResponse {
  items: BandcampItem[];
  total: number;
}

export interface BandcampRadarResponse {
  items: BandcampRadarItem[];
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

export interface BandcampRadarItem extends BandcampItem {
  score?: number | null;
  status?: string | null;
  source?: string | null;
}

export function itemTitle(item: BandcampItem, fallback: string): string {
  return item.album_title || item.track_title || item.artist_name || fallback;
}
