import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

import { apiFetch, apiUrl, getApiAuthHeaders, getApiBase } from "@/lib/api";
import { isNative } from "@/lib/capacitor";

export type OfflineItemKind = "track" | "album" | "playlist";
export type OfflineItemState = "idle" | "queued" | "downloading" | "syncing" | "ready" | "error";

export interface OfflineManifestTrack {
  storage_id: string;
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
  storageId: string;
  path: string;
  uri: string;
  playbackUrl: string;
  byteLength?: number | null;
  updatedAt?: string | null;
}

const OFFLINE_META_PREFIX = "listen-offline-meta::";
const OFFLINE_NATIVE_ASSET_PREFIX = "listen-offline-native-assets::";
const OFFLINE_ACTIVE_PROFILE_KEY = "listen-offline-active-profile";
const OFFLINE_CACHE_PREFIX = "crate-listen-offline-media::";
const OFFLINE_NATIVE_META_DIR = "offline-meta";
const OFFLINE_NATIVE_SNAPSHOT_PREFIX = "offline-index-";
const OFFLINE_NATIVE_ASSET_FILE_PREFIX = "offline-assets-";
const OFFLINE_STORAGE_HEADROOM_BYTES = 5 * 1024 * 1024;
const EMPTY_SNAPSHOT: OfflineSnapshot = { items: {} };
const nativeSnapshotCache = new Map<string, OfflineSnapshot>();
const nativeAssetIndexCache = new Map<string, Record<string, OfflineNativeAssetRecord>>();
const nativeSnapshotLoaders = new Map<string, Promise<OfflineSnapshot>>();
const nativeAssetIndexLoaders = new Map<string, Promise<Record<string, OfflineNativeAssetRecord>>>();

function encodeKey(input: string): string {
  try {
    return btoa(unescape(encodeURIComponent(input)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  } catch {
    return encodeURIComponent(input);
  }
}

export function deriveOfflineProfileKey(userId: number, serverOrigin?: string): string {
  const origin = (serverOrigin || getApiBase() || window.location.origin || "listen").replace(/\/+$/, "");
  return encodeKey(`${origin}|${userId}`);
}

export function deriveOfflineProfileKeyFromStoredUser(serverOrigin?: string): string | null {
  if (typeof window === "undefined") return null;
  const rawUserId = localStorage.getItem("listen-auth-user-id");
  const userId = rawUserId ? Number(rawUserId) : NaN;
  if (!Number.isFinite(userId) || userId <= 0) return null;
  return deriveOfflineProfileKey(userId, serverOrigin);
}

export function isOfflineSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (!("localStorage" in window)) return false;
  if (isNative) return true;
  return typeof navigator !== "undefined" && "caches" in window && "serviceWorker" in navigator;
}

export function getOfflineCacheName(profileKey: string): string {
  return `${OFFLINE_CACHE_PREFIX}${profileKey}`;
}

export function getOfflineItemKey(kind: OfflineItemKind, entityId: string | number): string {
  return `${kind}:${entityId}`;
}

export function getActiveOfflineProfileKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(OFFLINE_ACTIVE_PROFILE_KEY);
  } catch {
    return null;
  }
}

export function setActiveOfflineProfileKey(profileKey: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (profileKey) {
      localStorage.setItem(OFFLINE_ACTIVE_PROFILE_KEY, profileKey);
    } else {
      localStorage.removeItem(OFFLINE_ACTIVE_PROFILE_KEY);
    }
  } catch {
    // ignore persistence failures
  }
}

function getOfflineNativeAssetStorageKey(profileKey: string): string {
  return `${OFFLINE_NATIVE_ASSET_PREFIX}${profileKey}`;
}

function getOfflineNativeSnapshotPath(profileKey: string): string {
  return `${OFFLINE_NATIVE_META_DIR}/${OFFLINE_NATIVE_SNAPSHOT_PREFIX}${profileKey}.json`;
}

function getOfflineNativeAssetIndexPath(profileKey: string): string {
  return `${OFFLINE_NATIVE_META_DIR}/${OFFLINE_NATIVE_ASSET_FILE_PREFIX}${profileKey}.json`;
}

function parseOfflineSnapshot(raw: string | null): OfflineSnapshot {
  if (!raw) return EMPTY_SNAPSHOT;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.items !== "object") {
      return EMPTY_SNAPSHOT;
    }
    return { items: parsed.items as Record<string, OfflineItemRecord> };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

function parseOfflineNativeAssetIndex(raw: string | null): Record<string, OfflineNativeAssetRecord> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, OfflineNativeAssetRecord> : {};
  } catch {
    return {};
  }
}

function getLegacyOfflineSnapshot(profileKey: string): OfflineSnapshot {
  if (typeof window === "undefined") return EMPTY_SNAPSHOT;
  try {
    return parseOfflineSnapshot(localStorage.getItem(`${OFFLINE_META_PREFIX}${profileKey}`));
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

function getLegacyOfflineNativeAssetIndex(profileKey: string): Record<string, OfflineNativeAssetRecord> {
  if (typeof window === "undefined") return {};
  try {
    return parseOfflineNativeAssetIndex(localStorage.getItem(getOfflineNativeAssetStorageKey(profileKey)));
  } catch {
    return {};
  }
}

function clearLegacyOfflineSnapshot(profileKey: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(`${OFFLINE_META_PREFIX}${profileKey}`);
  } catch {
    // ignore persistence failures
  }
}

function clearLegacyOfflineNativeAssetIndex(profileKey: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(getOfflineNativeAssetStorageKey(profileKey));
  } catch {
    // ignore persistence failures
  }
}

async function ensureOfflineNativeMetaDir(): Promise<void> {
  await Filesystem.mkdir({
    path: OFFLINE_NATIVE_META_DIR,
    directory: Directory.Data,
    recursive: true,
  }).catch(() => {
    // directory may already exist
  });
}

async function readNativeJsonFile(path: string): Promise<string | null> {
  try {
    const result = await Filesystem.readFile({
      path,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    return typeof result.data === "string" ? result.data : null;
  } catch {
    return null;
  }
}

async function writeNativeJsonFile(path: string, payload: unknown): Promise<void> {
  await ensureOfflineNativeMetaDir();
  await Filesystem.writeFile({
    path,
    directory: Directory.Data,
    recursive: true,
    encoding: Encoding.UTF8,
    data: JSON.stringify(payload),
  });
}

async function ensureOfflineSnapshotLoaded(profileKey: string): Promise<OfflineSnapshot> {
  const cached = nativeSnapshotCache.get(profileKey);
  if (cached) return cached;
  const inFlight = nativeSnapshotLoaders.get(profileKey);
  if (inFlight) return inFlight;

  const loader = (async () => {
    const filePath = getOfflineNativeSnapshotPath(profileKey);
    const raw = await readNativeJsonFile(filePath);
    let snapshot = parseOfflineSnapshot(raw);
    if (raw == null) {
      const legacy = getLegacyOfflineSnapshot(profileKey);
      snapshot = legacy;
      if (Object.keys(legacy.items).length) {
        await writeNativeJsonFile(filePath, legacy);
        clearLegacyOfflineSnapshot(profileKey);
      }
    }
    nativeSnapshotCache.set(profileKey, snapshot);
    nativeSnapshotLoaders.delete(profileKey);
    return snapshot;
  })();

  nativeSnapshotLoaders.set(profileKey, loader);
  return loader;
}

async function ensureOfflineNativeAssetIndexLoaded(
  profileKey: string,
): Promise<Record<string, OfflineNativeAssetRecord>> {
  const cached = nativeAssetIndexCache.get(profileKey);
  if (cached) return cached;
  const inFlight = nativeAssetIndexLoaders.get(profileKey);
  if (inFlight) return inFlight;

  const loader = (async () => {
    const filePath = getOfflineNativeAssetIndexPath(profileKey);
    const raw = await readNativeJsonFile(filePath);
    let assets = parseOfflineNativeAssetIndex(raw);
    if (raw == null) {
      const legacy = getLegacyOfflineNativeAssetIndex(profileKey);
      assets = legacy;
      if (Object.keys(legacy).length) {
        await writeNativeJsonFile(filePath, legacy);
        clearLegacyOfflineNativeAssetIndex(profileKey);
      }
    }
    nativeAssetIndexCache.set(profileKey, assets);
    nativeAssetIndexLoaders.delete(profileKey);
    return assets;
  })();

  nativeAssetIndexLoaders.set(profileKey, loader);
  return loader;
}

function loadOfflineNativeAssetIndex(profileKey: string): Record<string, OfflineNativeAssetRecord> {
  if (isNative) {
    return nativeAssetIndexCache.get(profileKey) ?? {};
  }
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(getOfflineNativeAssetStorageKey(profileKey));
    return parseOfflineNativeAssetIndex(raw);
  } catch {
    return {};
  }
}

function saveOfflineNativeAssetIndex(
  profileKey: string,
  assets: Record<string, OfflineNativeAssetRecord>,
): void {
  if (isNative) {
    nativeAssetIndexCache.set(profileKey, assets);
    void writeNativeJsonFile(getOfflineNativeAssetIndexPath(profileKey), assets);
    return;
  }
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getOfflineNativeAssetStorageKey(profileKey), JSON.stringify(assets));
  } catch {
    // ignore persistence failures
  }
}

export function loadOfflineSnapshot(profileKey: string | null): OfflineSnapshot {
  if (!profileKey || typeof window === "undefined") return EMPTY_SNAPSHOT;
  if (isNative) {
    return nativeSnapshotCache.get(profileKey) ?? EMPTY_SNAPSHOT;
  }
  try {
    const raw = localStorage.getItem(`${OFFLINE_META_PREFIX}${profileKey}`);
    return parseOfflineSnapshot(raw);
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

export function saveOfflineSnapshot(profileKey: string | null, snapshot: OfflineSnapshot): void {
  if (!profileKey || typeof window === "undefined") return;
  if (isNative) {
    nativeSnapshotCache.set(profileKey, snapshot);
    void writeNativeJsonFile(getOfflineNativeSnapshotPath(profileKey), snapshot);
    return;
  }
  try {
    localStorage.setItem(`${OFFLINE_META_PREFIX}${profileKey}`, JSON.stringify(snapshot));
  } catch {
    // ignore persistence failures; cache may still hold usable media
  }
}

export async function hydrateOfflineProfileState(profileKey: string | null): Promise<OfflineSnapshot> {
  if (!profileKey) return EMPTY_SNAPSHOT;
  if (!isNative) return loadOfflineSnapshot(profileKey);
  const [snapshot] = await Promise.all([
    ensureOfflineSnapshotLoaded(profileKey),
    ensureOfflineNativeAssetIndexLoaded(profileKey),
  ]);
  return snapshot;
}

export function canonicalStreamPath(storageId: string): string {
  return `/api/tracks/by-storage/${encodeURIComponent(storageId)}/stream`;
}

export function canonicalStreamUrl(storageId: string): string {
  return apiUrl(canonicalStreamPath(storageId));
}

export async function hasCachedTrackAsset(profileKey: string, storageId: string): Promise<boolean> {
  if (isNative) {
    const entry = (await ensureOfflineNativeAssetIndexLoaded(profileKey))[storageId];
    if (!entry?.path) return false;
    try {
      await Filesystem.stat({ path: entry.path, directory: Directory.Data });
      return true;
    } catch {
      const nextAssets = loadOfflineNativeAssetIndex(profileKey);
      delete nextAssets[storageId];
      saveOfflineNativeAssetIndex(profileKey, nextAssets);
      return false;
    }
  }
  const cache = await caches.open(getOfflineCacheName(profileKey));
  const match = await cache.match(canonicalStreamUrl(storageId));
  return Boolean(match);
}

function inferOfflineFileExtension(track: OfflineManifestTrack): string {
  const candidate = (track.format || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return candidate || "bin";
}

function safeOfflineFileStem(storageId: string): string {
  const trimmed = storageId.trim();
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function expectedTrackBytes(track: OfflineManifestTrack): number {
  return Math.max(0, Number(track.byte_length || 0));
}

async function assertNativeTrackIntegrity(
  path: string,
  track: OfflineManifestTrack,
): Promise<{ uri: string; size: number }> {
  const stat = await Filesystem.stat({
    path,
    directory: Directory.Data,
  });
  const actualSize = Number(stat.size || 0);
  const expectedSize = expectedTrackBytes(track);
  if (expectedSize > 0 && actualSize > 0 && actualSize !== expectedSize) {
    await Filesystem.deleteFile({
      path,
      directory: Directory.Data,
    }).catch(() => {
      // best-effort cleanup on integrity failure
    });
    throw new Error("Offline copy failed integrity check");
  }
  return { uri: stat.uri, size: actualSize };
}

async function assertWebTrackIntegrity(response: Response, track: OfflineManifestTrack): Promise<void> {
  const headerSize = Number(response.headers.get("content-length") || 0);
  const expectedSize = expectedTrackBytes(track);
  if (expectedSize > 0 && headerSize > 0 && headerSize !== expectedSize) {
    throw new Error("Offline copy failed integrity check");
  }
}

async function estimateMissingOfflineBytes(
  profileKey: string,
  tracks: OfflineManifestTrack[],
): Promise<number> {
  let total = 0;
  for (const track of tracks) {
    if (!track.storage_id) continue;
    const cached = await hasCachedTrackAsset(profileKey, track.storage_id);
    if (!cached) {
      total += expectedTrackBytes(track);
    }
  }
  return total;
}

export async function ensureOfflineStorageBudget(
  profileKey: string,
  tracks: OfflineManifestTrack[],
): Promise<void> {
  if (isNative || typeof navigator === "undefined" || !navigator.storage?.estimate) return;
  const pendingBytes = await estimateMissingOfflineBytes(profileKey, tracks);
  if (pendingBytes <= 0) return;
  const estimate = await navigator.storage.estimate();
  const quota = Number(estimate.quota || 0);
  const usage = Number(estimate.usage || 0);
  if (!quota || quota <= 0) return;
  const available = Math.max(quota - usage, 0);
  if (pendingBytes + OFFLINE_STORAGE_HEADROOM_BYTES > available) {
    throw new Error("Not enough browser storage available for offline copy");
  }
}

export async function cacheTrackAsset(profileKey: string, track: OfflineManifestTrack): Promise<void> {
  if (isNative) {
    const existing = (await ensureOfflineNativeAssetIndexLoaded(profileKey))[track.storage_id];
    if (existing) return;

    const dirPath = `offline-media/${profileKey}`;
    const filePath = `${dirPath}/${safeOfflineFileStem(track.storage_id)}.${inferOfflineFileExtension(track)}`;

    await Filesystem.mkdir({
      path: dirPath,
      directory: Directory.Data,
      recursive: true,
    }).catch(() => {
      // mkdir may fail if the directory already exists
    });

    await Filesystem.downloadFile({
      url: apiUrl(track.stream_url),
      path: filePath,
      directory: Directory.Data,
      recursive: true,
      headers: getApiAuthHeaders(),
    });

    const { uri, size } = await assertNativeTrackIntegrity(filePath, track);

    const nextAssets = loadOfflineNativeAssetIndex(profileKey);
    nextAssets[track.storage_id] = {
      storageId: track.storage_id,
      path: filePath,
      uri,
      playbackUrl: Capacitor.convertFileSrc(uri),
      byteLength: expectedTrackBytes(track) || size,
      updatedAt: track.updated_at ?? null,
    };
    saveOfflineNativeAssetIndex(profileKey, nextAssets);
    return;
  }

  const cache = await caches.open(getOfflineCacheName(profileKey));
  const cacheKey = canonicalStreamUrl(track.storage_id);
  const existing = await cache.match(cacheKey);
  if (existing) return;
  const response = await apiFetch(track.stream_url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Failed to cache track (${response.status})`);
  }
  await assertWebTrackIntegrity(response, track);
  await cache.put(cacheKey, response.clone());
}

export async function deleteCachedTrackAsset(profileKey: string, storageId: string): Promise<void> {
  if (isNative) {
    const assets = { ...(await ensureOfflineNativeAssetIndexLoaded(profileKey)) };
    const entry = assets[storageId];
    if (entry?.path) {
      await Filesystem.deleteFile({
        path: entry.path,
        directory: Directory.Data,
      }).catch(() => {
        // ignore missing files; we still want to clear metadata
      });
    }
    delete assets[storageId];
    saveOfflineNativeAssetIndex(profileKey, assets);
    return;
  }
  const cache = await caches.open(getOfflineCacheName(profileKey));
  await cache.delete(canonicalStreamUrl(storageId));
}

export async function clearOfflineAssets(profileKey: string): Promise<void> {
  if (isNative) {
    const assets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
    await Promise.all(
      Object.values(assets).map((asset) =>
        Filesystem.deleteFile({
          path: asset.path,
          directory: Directory.Data,
        }).catch(() => {
          // ignore missing files during cleanup
        }),
      ),
    );
    saveOfflineNativeAssetIndex(profileKey, {});
    return;
  }
  await caches.delete(getOfflineCacheName(profileKey));
}

export function buildAssetUsage(snapshot: OfflineSnapshot): Map<string, number> {
  const usage = new Map<string, number>();
  for (const item of Object.values(snapshot.items)) {
    for (const track of item.tracks) {
      const storageId = track.storage_id;
      if (!storageId) continue;
      usage.set(storageId, (usage.get(storageId) || 0) + 1);
    }
  }
  return usage;
}

export function summarizeOfflineSnapshot(snapshot: OfflineSnapshot): OfflineSummary {
  const items = Object.values(snapshot.items);
  return items.reduce<OfflineSummary>(
    (summary, item) => {
      summary.itemCount += 1;
      summary.trackCount += item.trackCount || item.tracks.length;
      summary.readyTrackCount += item.readyTrackCount || 0;
      summary.totalBytes += Number(item.totalBytes || 0);
      if (item.state === "ready") summary.readyItemCount += 1;
      if (item.state === "error") summary.errorItemCount += 1;
      return summary;
    },
    {
      itemCount: 0,
      readyItemCount: 0,
      errorItemCount: 0,
      trackCount: 0,
      readyTrackCount: 0,
      totalBytes: 0,
    },
  );
}

export function isOfflineBusy(state: OfflineItemState): boolean {
  return state === "queued" || state === "downloading" || state === "syncing";
}

export function getOfflineStateLabel(state: OfflineItemState): string | null {
  switch (state) {
    case "queued":
      return "Queued for offline";
    case "downloading":
      return "Downloading for offline";
    case "syncing":
      return "Syncing offline copy";
    case "ready":
      return "Available offline";
    case "error":
      return "Offline copy failed";
    default:
      return null;
  }
}

export function getOfflineActionLabel(state: OfflineItemState): string {
  switch (state) {
    case "ready":
      return "Remove offline copy";
    case "error":
      return "Retry offline copy";
    case "queued":
    case "downloading":
      return "Downloading...";
    case "syncing":
      return "Syncing...";
    default:
      return "Make available offline";
  }
}

export function getOfflineNativePlaybackUrl(storageId: string): string | null {
  if (!isNative) return null;
  const profileKey = getActiveOfflineProfileKey();
  if (!profileKey) return null;
  const entry = loadOfflineNativeAssetIndex(profileKey)[storageId];
  return entry?.playbackUrl || null;
}

export async function syncOfflineProfileToServiceWorker(profileKey: string | null): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  const payload = { type: "crate:set-offline-profile", profileKey };
  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage(payload);
    navigator.serviceWorker.controller?.postMessage(payload);
  } catch {
    // ignore; service worker may not be ready yet
  }
}

export async function primeOfflineRuntimeProfile(serverOrigin?: string): Promise<void> {
  const profileKey = deriveOfflineProfileKeyFromStoredUser(serverOrigin);
  setActiveOfflineProfileKey(profileKey);
  await syncOfflineProfileToServiceWorker(profileKey);
}
