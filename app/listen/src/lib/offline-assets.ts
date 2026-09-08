import { apiFetch, apiUrl } from "@/lib/api";
import { isIosBrowser, isNative } from "@/lib/capacitor-runtime";
import {
  getOfflineTrackAssetAliases,
  getOfflineTrackAssetKey,
  getOfflineTrackCacheUrls,
} from "@/lib/offline-track-identity";
import {
  cacheWebOfflineAsset,
  deleteWebOfflineAssets,
  hasWebOfflineAsset,
} from "@/lib/offline-web";
import {
  cacheNativeTrackAsset,
  clearNativeOfflineAssets,
  deleteNativeCachedTrackAsset,
  estimateNativeOfflineBytes,
  getNativeOfflinePlaybackUrl,
  hasCachedNativeTrackAssets,
  offlineTrackFromIdentity,
} from "@/lib/offline-native-assets";
import type { OfflineItemState, OfflineManifestTrack } from "./offline-model";
import { getOfflineCacheName } from "./offline-storage";
import type { OfflineTrackIdentityInput } from "./offline-track-identity";

const OFFLINE_STORAGE_HEADROOM_BYTES = 5 * 1024 * 1024;
const NATIVE_OFFLINE_SOFT_LIMIT_BYTES = 8 * 1024 * 1024 * 1024;
const IOS_BROWSER_OFFLINE_SOFT_LIMIT_BYTES = 450 * 1024 * 1024;

export async function hasCachedTrackAsset(
  profileKey: string,
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
): Promise<boolean> {
  if (isNative) {
    const found = await hasCachedNativeTrackAssets(profileKey, [
      offlineTrackFromIdentity(track, storageId),
    ]);
    const assetKey = getOfflineTrackAssetKey(track, storageId);
    return Boolean(assetKey && found.has(assetKey));
  }
  const aliases = getOfflineTrackAssetAliases(track, storageId);
  if (!aliases.length) return false;
  const cache = await caches.open(getOfflineCacheName(profileKey));
  return hasWebOfflineAsset(cache, getOfflineTrackCacheUrls(track, storageId));
}

export async function hasCachedTrackAssets(
  profileKey: string,
  tracks: OfflineManifestTrack[],
): Promise<Set<string>> {
  if (!tracks.length) return new Set();
  if (isNative) return hasCachedNativeTrackAssets(profileKey, tracks);
  const cachedKeys = await Promise.all(
    tracks.map(async (track) => {
      const assetKey = getOfflineTrackAssetKey(track);
      return assetKey && (await hasCachedTrackAsset(profileKey, track))
        ? assetKey
        : null;
    }),
  );
  return new Set(
    cachedKeys.filter((assetKey): assetKey is string => Boolean(assetKey)),
  );
}

function expectedTrackBytes(track: OfflineManifestTrack): number {
  return Math.max(0, Number(track.byte_length || 0));
}

async function estimateMissingOfflineBytes(
  profileKey: string,
  tracks: OfflineManifestTrack[],
): Promise<number> {
  const missingBytes = await Promise.all(
    tracks.map(async (track) => {
      if (!getOfflineTrackAssetKey(track)) return 0;
      const cached = await hasCachedTrackAsset(profileKey, track);
      return cached ? 0 : expectedTrackBytes(track);
    }),
  );
  return missingBytes.reduce((total, bytes) => total + bytes, 0);
}

export async function ensureOfflineStorageBudget(
  profileKey: string,
  tracks: OfflineManifestTrack[],
  options: { assumeMissing?: boolean } = {},
): Promise<void> {
  const pendingBytes = options.assumeMissing
    ? tracks.reduce(
        (total, track) =>
          total +
          (getOfflineTrackAssetKey(track) ? expectedTrackBytes(track) : 0),
        0,
      )
    : await estimateMissingOfflineBytes(profileKey, tracks);
  if (pendingBytes <= 0) return;
  if (isNative) {
    const currentBytes = await estimateNativeOfflineBytes(profileKey);
    if (
      currentBytes + pendingBytes + OFFLINE_STORAGE_HEADROOM_BYTES >
      NATIVE_OFFLINE_SOFT_LIMIT_BYTES
    ) {
      throw new Error("Offline copies are above the native storage budget");
    }
    return;
  }
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return;
  const estimate = await navigator.storage.estimate();
  const quota = Number(estimate.quota || 0);
  const usage = Number(estimate.usage || 0);
  if (
    isIosBrowser &&
    usage + pendingBytes + OFFLINE_STORAGE_HEADROOM_BYTES >
      IOS_BROWSER_OFFLINE_SOFT_LIMIT_BYTES
  ) {
    throw new Error("Offline copies are above the iOS browser storage budget");
  }
  if (!quota || quota <= 0) return;
  const available = Math.max(quota - usage, 0);
  if (pendingBytes + OFFLINE_STORAGE_HEADROOM_BYTES > available) {
    throw new Error("Not enough browser storage available for offline copy");
  }
}

export async function cacheTrackAsset(
  profileKey: string,
  track: OfflineManifestTrack,
): Promise<void> {
  const assetKey = getOfflineTrackAssetKey(track);
  if (!assetKey) {
    throw new Error("Offline copy requires entity_uid or storage_id");
  }
  if (isNative) {
    await cacheNativeTrackAsset(profileKey, track);
    return;
  }

  const cache = await caches.open(getOfflineCacheName(profileKey));
  const cacheKey = apiUrl(track.stream_url);
  await cacheWebOfflineAsset(
    cache,
    cacheKey,
    () => apiFetch(track.stream_url, { method: "GET" }),
    expectedTrackBytes(track),
  );
}

export async function deleteCachedTrackAsset(
  profileKey: string,
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
): Promise<void> {
  const aliases = getOfflineTrackAssetAliases(track, storageId);
  if (!aliases.length) return;
  if (isNative) {
    await deleteNativeCachedTrackAsset(profileKey, track, storageId);
    return;
  }
  const cache = await caches.open(getOfflineCacheName(profileKey));
  await deleteWebOfflineAssets(
    cache,
    getOfflineTrackCacheUrls(track, storageId),
  );
}

export async function clearOfflineAssets(profileKey: string): Promise<void> {
  if (isNative) {
    await clearNativeOfflineAssets(profileKey);
    return;
  }
  await caches.delete(getOfflineCacheName(profileKey));
}

export function getOfflineNativePlaybackUrl(
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
  options: { target?: "webview" | "android-native" } = {},
): string | null {
  return getNativeOfflinePlaybackUrl(track, storageId, options);
}

export type { OfflineItemState };
