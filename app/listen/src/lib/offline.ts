import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

import { api, apiFetch, apiUrl, getApiAuthHeaders, getApiBase } from "@/lib/api";
import { getStoredAuthUserId } from "@/lib/auth-user-storage";
import { isAndroidNative, isIosBrowser, isNative } from "@/lib/capacitor-runtime";
import {
  trackOfflineManifestApiPath,
  trackStreamApiPath,
} from "@/lib/library-routes";
import type { PlaybackResolution } from "@/lib/track-playback";

export type OfflineItemKind = "track" | "album" | "playlist";
export type OfflineItemState = "idle" | "queued" | "downloading" | "syncing" | "ready" | "error";

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

const OFFLINE_META_PREFIX = "listen-offline-meta::";
const OFFLINE_NATIVE_ASSET_PREFIX = "listen-offline-native-assets::";
const OFFLINE_ACTIVE_PROFILE_KEY = "listen-offline-active-profile";
const OFFLINE_CACHE_PREFIX = "crate-listen-offline-media::";
const OFFLINE_NATIVE_META_DIR = "offline-meta";
const OFFLINE_NATIVE_SNAPSHOT_PREFIX = "offline-index-";
const OFFLINE_NATIVE_ASSET_FILE_PREFIX = "offline-assets-";
const OFFLINE_STORAGE_HEADROOM_BYTES = 5 * 1024 * 1024;
const NATIVE_OFFLINE_SOFT_LIMIT_BYTES = 8 * 1024 * 1024 * 1024;
const IOS_BROWSER_OFFLINE_SOFT_LIMIT_BYTES = 450 * 1024 * 1024;
const ANDROID_OFFLINE_DELIVERY_POLICY = "balanced";
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
  const rawUserId = getStoredAuthUserId(serverOrigin);
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

function normalizeIdentityValue(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function legacyTrackStreamApiPath(storageId: string): string {
  return `/api/tracks/by-storage/${encodeURIComponent(storageId)}/stream`;
}

function legacyTrackOfflineManifestApiPath(storageId: string): string {
  return `/api/offline/tracks/by-storage/${encodeURIComponent(storageId)}/manifest`;
}

type OfflineTrackIdentityInput =
  | string
  | null
  | undefined
  | { entity_uid?: string | null; storage_id?: string | null }
  | { entityUid?: string | null; storageId?: string | null };

type OfflineTrackIdentityObject = Exclude<OfflineTrackIdentityInput, string | null | undefined>;
type OfflineTrackSnakeIdentity = { entity_uid?: string | null; storage_id?: string | null };
type OfflineTrackCamelIdentity = { entityUid?: string | null; storageId?: string | null };

function hasSnakeCaseOfflineIdentity(track: OfflineTrackIdentityObject): track is OfflineTrackSnakeIdentity {
  return "entity_uid" in track || "storage_id" in track;
}

function readOfflineTrackEntityUid(track: OfflineTrackIdentityObject): string | null {
  if (hasSnakeCaseOfflineIdentity(track)) {
    return normalizeIdentityValue(track.entity_uid);
  }
  return normalizeIdentityValue((track as OfflineTrackCamelIdentity).entityUid);
}

function readOfflineTrackStorageId(track: OfflineTrackIdentityObject): string | null {
  if (hasSnakeCaseOfflineIdentity(track)) {
    return normalizeIdentityValue(track.storage_id);
  }
  return normalizeIdentityValue((track as OfflineTrackCamelIdentity).storageId);
}

export function getOfflineTrackAssetKey(track: OfflineTrackIdentityInput, storageId?: string | null): string | null {
  if (typeof track === "string") {
    return normalizeIdentityValue(storageId) || normalizeIdentityValue(track);
  }
  if (!track) {
    return normalizeIdentityValue(storageId);
  }
  return (
    readOfflineTrackEntityUid(track) ||
    readOfflineTrackStorageId(track) ||
    normalizeIdentityValue(storageId)
  );
}

function getOfflineTrackAssetAliases(track: OfflineTrackIdentityInput, storageId?: string | null): string[] {
  const aliases = new Set<string>();
  const primary = getOfflineTrackAssetKey(track, storageId);
  if (primary) aliases.add(primary);

  if (track && typeof track === "object") {
    const entityAlias = readOfflineTrackEntityUid(track);
    const storageAlias = readOfflineTrackStorageId(track);
    if (entityAlias) aliases.add(entityAlias);
    if (storageAlias) aliases.add(storageAlias);
  } else if (typeof track === "string") {
    const generic = normalizeIdentityValue(track);
    if (generic) aliases.add(generic);
  }

  const explicitStorage = normalizeIdentityValue(storageId);
  if (explicitStorage) aliases.add(explicitStorage);
  return Array.from(aliases);
}

function getOfflineTrackCacheUrls(track: OfflineTrackIdentityInput, storageId?: string | null): string[] {
  const urls = new Set<string>();
  const entityUid = track && typeof track === "object"
    ? readOfflineTrackEntityUid(track)
    : null;
  const resolvedStorageId =
    normalizeIdentityValue(storageId) ||
    (track && typeof track === "object"
      ? readOfflineTrackStorageId(track)
      : null);

  if (entityUid) {
    urls.add(apiUrl(trackStreamApiPath({ entityUid })));
  }
  if (resolvedStorageId) {
    urls.add(apiUrl(legacyTrackStreamApiPath(resolvedStorageId)));
  }
  if (!entityUid && !resolvedStorageId && typeof track === "string") {
    const generic = normalizeIdentityValue(track);
    if (generic) {
      urls.add(apiUrl(legacyTrackStreamApiPath(generic)));
      urls.add(apiUrl(trackStreamApiPath({ entityUid: generic })));
    }
  }
  return Array.from(urls);
}

export function getOfflineTrackManifestPaths(track: OfflineTrackIdentityInput, storageId?: string | null): string[] {
  const urls = new Set<string>();
  const entityUid = track && typeof track === "object"
    ? readOfflineTrackEntityUid(track)
    : null;
  const resolvedStorageId =
    normalizeIdentityValue(storageId) ||
    (track && typeof track === "object"
      ? readOfflineTrackStorageId(track)
      : null);

  if (entityUid) {
    urls.add(trackOfflineManifestApiPath({ entityUid }));
  } else if (resolvedStorageId) {
    urls.add(legacyTrackOfflineManifestApiPath(resolvedStorageId));
  }
  if (!entityUid && !resolvedStorageId && typeof track === "string") {
    const generic = normalizeIdentityValue(track);
    if (generic) {
      urls.add(trackOfflineManifestApiPath({ entityUid: generic }));
      urls.add(legacyTrackOfflineManifestApiPath(generic));
    }
  }
  return Array.from(urls);
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
    return normalizeOfflineSnapshot({ items: parsed.items as Record<string, OfflineItemRecord> });
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

function normalizeOfflineItemRecord(item: OfflineItemRecord): OfflineItemRecord {
  const normalizedTracks = Array.isArray(item.tracks) ? item.tracks : [];
  const aliasToAssetKey = new Map<string, string>();
  for (const track of normalizedTracks) {
    const assetKey = getOfflineTrackAssetKey(track);
    if (!assetKey) continue;
    aliasToAssetKey.set(assetKey, assetKey);
    for (const alias of getOfflineTrackAssetAliases(track)) {
      aliasToAssetKey.set(alias, assetKey);
    }
  }

  const normalizedReadyAssetKeys = Array.from(
    new Set(
      ((item.readyAssetKeys || item.readyStorageIds) || [])
        .map((value) => aliasToAssetKey.get(value) || normalizeIdentityValue(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const canonicalEntityId = item.kind === "track"
    ? (
      getOfflineTrackAssetKey(normalizedTracks[0] ?? null) ||
      normalizeIdentityValue(item.entityId) ||
      String(item.entityId)
    )
    : String(item.entityId);

  return {
    ...item,
    key: getOfflineItemKey(item.kind, canonicalEntityId),
    entityId: canonicalEntityId,
    readyAssetKeys: normalizedReadyAssetKeys.length || item.readyAssetKeys || item.readyStorageIds
      ? normalizedReadyAssetKeys
      : undefined,
    readyStorageIds: undefined,
    tracks: normalizedTracks,
  };
}

export function normalizeOfflineSnapshot(snapshot: OfflineSnapshot): OfflineSnapshot {
  const items: Record<string, OfflineItemRecord> = {};
  for (const record of Object.values(snapshot.items || {})) {
    const normalized = normalizeOfflineItemRecord(record);
    items[normalized.key] = normalized;
  }
  return { items };
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
  const normalized = normalizeOfflineSnapshot(snapshot);
  if (isNative) {
    nativeSnapshotCache.set(profileKey, normalized);
    void writeNativeJsonFile(getOfflineNativeSnapshotPath(profileKey), normalized);
    return;
  }
  try {
    localStorage.setItem(`${OFFLINE_META_PREFIX}${profileKey}`, JSON.stringify(normalized));
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

export function canonicalStreamPath(track: OfflineTrackIdentityInput, storageId?: string | null): string {
  const entityUid = track && typeof track === "object"
    ? readOfflineTrackEntityUid(track)
    : null;
  const resolvedStorageId =
    normalizeIdentityValue(storageId) ||
    (track && typeof track === "object"
      ? readOfflineTrackStorageId(track)
      : typeof track === "string"
        ? normalizeIdentityValue(track)
        : null);
  if (entityUid) return trackStreamApiPath({ entityUid });
  if (resolvedStorageId) return legacyTrackStreamApiPath(resolvedStorageId);
  throw new Error("Offline stream path requires entity_uid or storage_id");
}

export function canonicalStreamUrl(track: OfflineTrackIdentityInput, storageId?: string | null): string {
  return apiUrl(canonicalStreamPath(track, storageId));
}

export async function hasCachedTrackAsset(profileKey: string, track: OfflineTrackIdentityInput, storageId?: string | null): Promise<boolean> {
  const aliases = getOfflineTrackAssetAliases(track, storageId);
  if (!aliases.length) return false;
  if (isNative) {
    const assets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
    const entry = aliases.map((alias) => assets[alias]).find(Boolean);
    if (!entry?.path) return false;
    try {
      await Filesystem.stat({ path: entry.path, directory: Directory.Data });
      return true;
    } catch {
      const nextAssets = loadOfflineNativeAssetIndex(profileKey);
      for (const alias of aliases) {
        delete nextAssets[alias];
      }
      saveOfflineNativeAssetIndex(profileKey, nextAssets);
      return false;
    }
  }
  const cache = await caches.open(getOfflineCacheName(profileKey));
  for (const url of getOfflineTrackCacheUrls(track, storageId)) {
    const match = await cache.match(url);
    if (match) return true;
  }
  return false;
}

function normalizeAudioExtension(value?: string | null): string | null {
  const candidate = (value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!candidate) return null;
  if (candidate === "aac") return "m4a";
  return candidate;
}

function inferOfflineFileExtension(track: OfflineManifestTrack, formatOverride?: string | null): string {
  return normalizeAudioExtension(formatOverride) || normalizeAudioExtension(track.format) || "bin";
}

function safeOfflineFileStem(assetKey: string): string {
  const trimmed = assetKey.trim();
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function expectedTrackBytes(track: OfflineManifestTrack): number {
  return Math.max(0, Number(track.byte_length || 0));
}

async function assertNativeTrackIntegrity(
  path: string,
  expectedBytes?: number | null,
): Promise<{ uri: string; size: number }> {
  const stat = await Filesystem.stat({
    path,
    directory: Directory.Data,
  });
  const actualSize = Number(stat.size || 0);
  const expectedSize = Math.max(0, Number(expectedBytes ?? 0));
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
    if (!getOfflineTrackAssetKey(track)) continue;
    const cached = await hasCachedTrackAsset(profileKey, track);
    if (!cached) {
      total += expectedTrackBytes(track);
    }
  }
  return total;
}

async function estimateNativeOfflineBytes(profileKey: string): Promise<number> {
  const assets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
  return Object.values(assets).reduce((total, asset) => total + Math.max(0, Number(asset.byteLength || 0)), 0);
}

export async function ensureOfflineStorageBudget(
  profileKey: string,
  tracks: OfflineManifestTrack[],
): Promise<void> {
  const pendingBytes = await estimateMissingOfflineBytes(profileKey, tracks);
  if (pendingBytes <= 0) return;
  if (isNative) {
    const currentBytes = await estimateNativeOfflineBytes(profileKey);
    if (currentBytes + pendingBytes + OFFLINE_STORAGE_HEADROOM_BYTES > NATIVE_OFFLINE_SOFT_LIMIT_BYTES) {
      throw new Error("Offline copies are above the native storage budget");
    }
    return;
  }
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return;
  const estimate = await navigator.storage.estimate();
  const quota = Number(estimate.quota || 0);
  const usage = Number(estimate.usage || 0);
  if (isIosBrowser && usage + pendingBytes + OFFLINE_STORAGE_HEADROOM_BYTES > IOS_BROWSER_OFFLINE_SOFT_LIMIT_BYTES) {
    throw new Error("Offline copies are above the iOS browser storage budget");
  }
  if (!quota || quota <= 0) return;
  const available = Math.max(quota - usage, 0);
  if (pendingBytes + OFFLINE_STORAGE_HEADROOM_BYTES > available) {
    throw new Error("Not enough browser storage available for offline copy");
  }
}

interface NativeOfflineDownloadTarget {
  streamUrl: string;
  extension: string;
  expectedBytes: number | null;
  effectivePolicy: string;
}

function nativePlaybackPathForTrack(track: OfflineManifestTrack): string | null {
  if (track.entity_uid) {
    return `/api/tracks/by-entity/${encodeURIComponent(track.entity_uid)}/playback?delivery=${ANDROID_OFFLINE_DELIVERY_POLICY}`;
  }
  if (track.track_id) {
    return `/api/tracks/${encodeURIComponent(String(track.track_id))}/playback?delivery=${ANDROID_OFFLINE_DELIVERY_POLICY}`;
  }
  return null;
}

function sourceNeedsMobileVariant(track: OfflineManifestTrack, resolution?: PlaybackResolution | null): boolean {
  const sourceFormat = normalizeAudioExtension(resolution?.source?.format || track.format);
  const sourceBitrate = Number(resolution?.source?.bitrate || track.bitrate || 0);
  const sourceSampleRate = Number(resolution?.source?.sample_rate || track.sample_rate || 0);
  if (resolution?.source?.lossless) return true;
  if (!sourceFormat) return false;
  if (["flac", "wav", "alac", "aiff", "aif"].includes(sourceFormat)) return true;
  if (["m4a", "mp3", "opus", "ogg"].includes(sourceFormat)) {
    return sourceBitrate > 256 || sourceSampleRate > 48_000;
  }
  return false;
}

async function resolveNativeOfflineDownloadTarget(track: OfflineManifestTrack): Promise<NativeOfflineDownloadTarget> {
  const fallback = {
    streamUrl: track.stream_url,
    extension: inferOfflineFileExtension(track),
    expectedBytes: expectedTrackBytes(track) || null,
    effectivePolicy: "original",
  };
  if (!isAndroidNative) return fallback;

  const playbackPath = nativePlaybackPathForTrack(track);
  if (!playbackPath) return fallback;

  let resolution: PlaybackResolution;
  try {
    resolution = await api<PlaybackResolution>(playbackPath);
  } catch {
    if (sourceNeedsMobileVariant(track)) {
      throw new Error("Could not prepare the Android offline copy");
    }
    return fallback;
  }

  if (resolution.preparing && sourceNeedsMobileVariant(track, resolution)) {
    throw new Error("Preparing the Android offline copy. Try again shortly.");
  }

  if (resolution.effective_policy === "original") {
    return fallback;
  }

  const deliveryFormat = resolution.delivery?.format || resolution.delivery?.codec;
  return {
    streamUrl: resolution.stream_url || track.stream_url,
    extension: inferOfflineFileExtension(track, deliveryFormat),
    expectedBytes: Number(resolution.delivery?.bytes || 0) || null,
    effectivePolicy: resolution.effective_policy,
  };
}

export async function cacheTrackAsset(profileKey: string, track: OfflineManifestTrack): Promise<void> {
  const assetKey = getOfflineTrackAssetKey(track);
  if (!assetKey) {
    throw new Error("Offline copy requires entity_uid or storage_id");
  }
  if (isNative) {
    const existingAssets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
    const existing = getOfflineTrackAssetAliases(track).map((alias) => existingAssets[alias]).find(Boolean);
    if (existing) return;

    const downloadTarget = await resolveNativeOfflineDownloadTarget(track);
    const dirPath = `offline-media/${profileKey}`;
    const filePath = `${dirPath}/${safeOfflineFileStem(assetKey)}.${downloadTarget.extension}`;

    await Filesystem.mkdir({
      path: dirPath,
      directory: Directory.Data,
      recursive: true,
    }).catch(() => {
      // mkdir may fail if the directory already exists
    });

    await Filesystem.downloadFile({
      url: apiUrl(downloadTarget.streamUrl),
      path: filePath,
      directory: Directory.Data,
      recursive: true,
      headers: getApiAuthHeaders(),
    });

    const { uri, size } = await assertNativeTrackIntegrity(filePath, downloadTarget.expectedBytes);

    const nextAssets = loadOfflineNativeAssetIndex(profileKey);
    nextAssets[assetKey] = {
      assetKey,
      entityUid: track.entity_uid ?? null,
      storageId: track.storage_id,
      path: filePath,
      uri,
      playbackUrl: Capacitor.convertFileSrc(uri),
      byteLength: downloadTarget.expectedBytes || size,
      updatedAt: track.updated_at ?? null,
    };
    saveOfflineNativeAssetIndex(profileKey, nextAssets);
    return;
  }

  const cache = await caches.open(getOfflineCacheName(profileKey));
  const cacheKey = apiUrl(track.stream_url);
  const existing = await cache.match(cacheKey);
  if (existing) return;
  const response = await apiFetch(track.stream_url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Failed to cache track (${response.status})`);
  }
  await assertWebTrackIntegrity(response, track);
  await cache.put(cacheKey, response.clone());
}

export async function deleteCachedTrackAsset(profileKey: string, track: OfflineTrackIdentityInput, storageId?: string | null): Promise<void> {
  const aliases = getOfflineTrackAssetAliases(track, storageId);
  if (!aliases.length) return;
  if (isNative) {
    const assets = { ...(await ensureOfflineNativeAssetIndexLoaded(profileKey)) };
    const entry = aliases.map((alias) => assets[alias]).find(Boolean);
    if (entry?.path) {
      await Filesystem.deleteFile({
        path: entry.path,
        directory: Directory.Data,
      }).catch(() => {
        // ignore missing files; we still want to clear metadata
      });
    }
    for (const alias of aliases) {
      delete assets[alias];
    }
    saveOfflineNativeAssetIndex(profileKey, assets);
    return;
  }
  const cache = await caches.open(getOfflineCacheName(profileKey));
  for (const url of getOfflineTrackCacheUrls(track, storageId)) {
    await cache.delete(url);
  }
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
      const assetKey = getOfflineTrackAssetKey(track);
      if (!assetKey) continue;
      usage.set(assetKey, (usage.get(assetKey) || 0) + 1);
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

export function getOfflineNativePlaybackUrl(track: OfflineTrackIdentityInput, storageId?: string | null): string | null {
  if (!isNative) return null;
  const profileKey = getActiveOfflineProfileKey();
  if (!profileKey) return null;
  const assets = loadOfflineNativeAssetIndex(profileKey);
  const entry = getOfflineTrackAssetAliases(track, storageId).map((alias) => assets[alias]).find(Boolean);
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
