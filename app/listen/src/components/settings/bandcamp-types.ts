export interface BandcampStatus {
  connected: boolean;
  status: string;
  bridge_enabled: boolean;
  bridge_ready?: boolean;
  bridge_backend?: string | null;
  bridge_message?: string | null;
  username?: string | null;
  display_name?: string | null;
  image_url?: string | null;
  last_sync_at?: string | null;
  last_error?: string | null;
}

export interface BandcampTaskResponse {
  task_id: string;
  status: string;
}

export interface BandcampTaskDetail {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | string;
  error?: string | null;
  result?: {
    synced?: number;
    imports_queued?: number;
    imports_skipped_existing?: number;
    counts?: Record<string, number>;
    matches_created?: number;
    radar_upserted?: number;
  } | null;
}

export interface BandcampCounts {
  collection: number;
  wishlist: number;
  following: number;
}
