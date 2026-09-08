export type OfflineItemKind = "track" | "album" | "playlist";

export type OfflineItemState =
  | "idle"
  | "queued"
  | "downloading"
  | "syncing"
  | "ready"
  | "error";

export interface OfflineManifestTrack {
  entity_uid?: string | null;
  storage_id?: string | null;
  track_id?: number | null;
  title: string;
  artist: string;
  artist_id?: number | null;
  artist_slug?: string | null;
  album?: string | null;
  album_id?: number | null;
  album_slug?: string | null;
  duration?: number | null;
  format?: string | null;
  bitrate?: number | null;
  sample_rate?: number | null;
  bit_depth?: number | null;
  byte_length?: number | null;
  stream_url: string;
  download_url: string;
  updated_at?: string | null;
}

export interface OfflineManifest {
  kind: OfflineItemKind;
  id: string | number;
  title: string;
  content_version: string;
  updated_at?: string | null;
  track_count: number;
  total_bytes: number;
  tracks: OfflineManifestTrack[];
  artwork?: { cover_url?: string | null } | null;
  metadata?: Record<string, unknown> | null;
}

export interface OfflineItemRecord {
  key: string;
  kind: OfflineItemKind;
  entityId: string;
  title: string;
  state: OfflineItemState;
  trackCount: number;
  readyTrackCount: number;
  contentVersion?: string | null;
  updatedAt?: string | null;
  lastSyncedAt?: string | null;
  totalBytes?: number | null;
  errorMessage?: string | null;
  readyAssetKeys?: string[];
  readyStorageIds?: string[];
  tracks: OfflineManifestTrack[];
}

export interface OfflineSnapshot {
  items: Record<string, OfflineItemRecord>;
}

export interface OfflineSummary {
  itemCount: number;
  readyItemCount: number;
  errorItemCount: number;
  trackCount: number;
  readyTrackCount: number;
  totalBytes: number;
}

export interface OfflineNativeAssetRecord {
  assetKey?: string;
  entityUid?: string | null;
  storageId?: string | null;
  path: string;
  uri: string;
  playbackUrl: string;
  byteLength?: number | null;
  updatedAt?: string | null;
}

export const EMPTY_OFFLINE_SNAPSHOT: OfflineSnapshot = { items: {} };
