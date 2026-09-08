import { getApiBase } from "@/lib/api";
import { getStoredAuthUserId } from "@/lib/auth-user-storage";
import { isNative } from "@/lib/capacitor-runtime";
import { encodeOfflineProfileIdentity } from "@/lib/offline-store";
import { getOfflineTrackAssetKey } from "@/lib/offline-track-identity";
import {
  hydrateOfflineProfileState,
  setActiveOfflineProfileKey,
} from "./offline-storage";
import type {
  OfflineItemState,
  OfflineSnapshot,
  OfflineSummary,
} from "./offline-model";

export {
  cacheTrackAsset,
  clearOfflineAssets,
  deleteCachedTrackAsset,
  ensureOfflineStorageBudget,
  hasCachedTrackAsset,
  hasCachedTrackAssets,
  getOfflineNativePlaybackUrl,
} from "@/lib/offline-assets";
export {
  getActiveOfflineProfileKey,
  getOfflineCacheName,
  getOfflineItemKey,
  hydrateOfflineProfileState,
  loadOfflineNativeAssetIndex,
  loadOfflineSnapshot,
  normalizeOfflineSnapshot,
  saveOfflineNativeAssetIndex,
  saveOfflineSnapshot,
  setActiveOfflineProfileKey,
} from "./offline-storage";
export type {
  OfflineItemKind,
  OfflineItemRecord,
  OfflineItemState,
  OfflineManifest,
  OfflineManifestTrack,
  OfflineNativeAssetRecord,
  OfflineSnapshot,
  OfflineSummary,
} from "./offline-model";

export {
  canonicalStreamPath,
  canonicalStreamUrl,
  getOfflineTrackAssetKey,
  getOfflineTrackManifestPaths,
} from "@/lib/offline-track-identity";
export type { OfflineTrackIdentityInput } from "@/lib/offline-track-identity";

export function deriveOfflineProfileKey(
  userId: number,
  serverOrigin?: string,
): string {
  const origin = (
    serverOrigin ||
    getApiBase() ||
    window.location.origin ||
    "listen"
  ).replace(/\/+$/, "");
  return encodeOfflineProfileIdentity(`${origin}|${userId}`);
}

export function deriveOfflineProfileKeyFromStoredUser(
  serverOrigin?: string,
): string | null {
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
  return (
    typeof navigator !== "undefined" &&
    "caches" in window &&
    "serviceWorker" in navigator
  );
}

export function buildAssetUsage(
  snapshot: OfflineSnapshot,
): Map<string, number> {
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

export function summarizeOfflineSnapshot(
  snapshot: OfflineSnapshot,
): OfflineSummary {
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

export async function syncOfflineProfileToServiceWorker(
  profileKey: string | null,
): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return;

  const payload = { type: "crate:set-offline-profile", profileKey };
  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage(payload);
    navigator.serviceWorker.controller?.postMessage(payload);
  } catch {
    // ignore; service worker may not be ready yet
  }
}

export async function primeOfflineRuntimeProfile(
  serverOrigin?: string,
): Promise<void> {
  const profileKey = deriveOfflineProfileKeyFromStoredUser(serverOrigin);
  setActiveOfflineProfileKey(profileKey);
  if (isNative && profileKey) {
    await hydrateOfflineProfileState(profileKey);
  }
  await syncOfflineProfileToServiceWorker(profileKey);
}
