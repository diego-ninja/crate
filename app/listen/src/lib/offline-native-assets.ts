import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";

import { api, apiUrl, getApiAuthHeaders } from "@/lib/api";
import { isAndroidNative, isNative } from "@/lib/capacitor-runtime";
import { verifyNativeOfflineAssets } from "@/lib/offline-native";
import type { PlaybackResolution } from "@/lib/track-playback";
import {
  getOfflineTrackAssetAliases,
  getOfflineTrackAssetKey,
  normalizeIdentityValue,
} from "@/lib/offline-track-identity";
import type { OfflineManifestTrack } from "./offline-model";
import {
  ensureOfflineNativeAssetIndexLoaded,
  getActiveOfflineProfileKey,
  loadOfflineNativeAssetIndex,
  saveOfflineNativeAssetIndex,
} from "./offline-storage";
import type { OfflineTrackIdentityInput } from "./offline-track-identity";

const ANDROID_OFFLINE_DELIVERY_POLICY = "balanced";

export async function hasCachedNativeTrackAssets(
  profileKey: string,
  tracks: OfflineManifestTrack[],
): Promise<Set<string>> {
  if (!tracks.length) return new Set();

  const assets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
  const expectations: Array<{
    assetKey: string;
    aliases: string[];
    path: string;
    expectedBytes: number | null;
  }> = [];
  for (const track of tracks) {
    const assetKey = getOfflineTrackAssetKey(track);
    if (!assetKey) continue;
    const aliases = getOfflineTrackAssetAliases(track);
    const entry = aliases.map((alias) => assets[alias]).find(Boolean);
    if (!entry?.path) continue;
    expectations.push({
      assetKey,
      aliases,
      path: entry.path,
      expectedBytes: entry.byteLength ?? track.byte_length ?? null,
    });
  }

  const results = await verifyNativeOfflineAssets(
    expectations.map(({ path, expectedBytes }) => ({ path, expectedBytes })),
  );
  const found = new Set<string>();
  const nextAssets = { ...assets };
  let changed = false;
  for (let index = 0; index < expectations.length; index += 1) {
    const expectation = expectations[index];
    const result = results[index];
    if (!expectation) continue;
    if (result?.exists && result.valid) {
      found.add(expectation.assetKey);
      continue;
    }
    for (const alias of expectation.aliases) {
      if (nextAssets[alias]) {
        delete nextAssets[alias];
        changed = true;
      }
    }
  }
  if (changed) saveOfflineNativeAssetIndex(profileKey, nextAssets);
  return found;
}

export async function estimateNativeOfflineBytes(
  profileKey: string,
): Promise<number> {
  const assets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
  return Object.values(assets).reduce(
    (total, asset) => total + Math.max(0, Number(asset.byteLength || 0)),
    0,
  );
}

function normalizeAudioExtension(value?: string | null): string | null {
  const candidate = (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!candidate) return null;
  if (candidate === "aac") return "m4a";
  return candidate;
}

function inferOfflineFileExtension(
  track: OfflineManifestTrack,
  formatOverride?: string | null,
): string {
  return (
    normalizeAudioExtension(formatOverride) ||
    normalizeAudioExtension(track.format) ||
    "bin"
  );
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

interface NativeOfflineDownloadTarget {
  streamUrl: string;
  extension: string;
  expectedBytes: number | null;
  effectivePolicy: string;
}

function nativePlaybackPathForTrack(
  track: OfflineManifestTrack,
): string | null {
  if (track.entity_uid) {
    return `/api/tracks/by-entity/${encodeURIComponent(
      track.entity_uid,
    )}/playback?delivery=${ANDROID_OFFLINE_DELIVERY_POLICY}`;
  }
  if (track.track_id) {
    return `/api/tracks/${encodeURIComponent(
      String(track.track_id),
    )}/playback?delivery=${ANDROID_OFFLINE_DELIVERY_POLICY}`;
  }
  return null;
}

function sourceNeedsMobileVariant(
  track: OfflineManifestTrack,
  resolution?: PlaybackResolution | null,
): boolean {
  const sourceFormat = normalizeAudioExtension(
    resolution?.source?.format || track.format,
  );
  const sourceBitrate = Number(
    resolution?.source?.bitrate || track.bitrate || 0,
  );
  const sourceSampleRate = Number(
    resolution?.source?.sample_rate || track.sample_rate || 0,
  );
  if (resolution?.source?.lossless) return true;
  if (!sourceFormat) return false;
  if (["flac", "wav", "alac", "aiff", "aif"].includes(sourceFormat))
    return true;
  if (["m4a", "mp3", "opus", "ogg"].includes(sourceFormat)) {
    return sourceBitrate > 256 || sourceSampleRate > 48_000;
  }
  return false;
}

async function resolveNativeOfflineDownloadTarget(
  track: OfflineManifestTrack,
): Promise<NativeOfflineDownloadTarget> {
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

  if (resolution.effective_policy === "original") return fallback;

  const deliveryFormat =
    resolution.delivery?.format || resolution.delivery?.codec;
  return {
    streamUrl: resolution.stream_url || track.stream_url,
    extension: inferOfflineFileExtension(track, deliveryFormat),
    expectedBytes: Number(resolution.delivery?.bytes || 0) || null,
    effectivePolicy: resolution.effective_policy,
  };
}

export async function cacheNativeTrackAsset(
  profileKey: string,
  track: OfflineManifestTrack,
): Promise<void> {
  if (!isNative) return;
  const assetKey = getOfflineTrackAssetKey(track);
  if (!assetKey) {
    throw new Error("Offline copy requires entity_uid or storage_id");
  }
  const existingAssets = await ensureOfflineNativeAssetIndexLoaded(profileKey);
  const existing = getOfflineTrackAssetAliases(track)
    .map((alias) => existingAssets[alias])
    .find(Boolean);
  if (existing) return;

  const downloadTarget = await resolveNativeOfflineDownloadTarget(track);
  const dirPath = `offline-media/${profileKey}`;
  const filePath = `${dirPath}/${safeOfflineFileStem(assetKey)}.${
    downloadTarget.extension
  }`;

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

  const { uri, size } = await assertNativeTrackIntegrity(
    filePath,
    downloadTarget.expectedBytes,
  );

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
}

export async function deleteNativeCachedTrackAsset(
  profileKey: string,
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
): Promise<void> {
  if (!isNative) return;
  const aliases = getOfflineTrackAssetAliases(track, storageId);
  if (!aliases.length) return;
  const assets = {
    ...(await ensureOfflineNativeAssetIndexLoaded(profileKey)),
  };
  const entry = aliases.map((alias) => assets[alias]).find(Boolean);
  if (entry?.path) {
    await Filesystem.deleteFile({
      path: entry.path,
      directory: Directory.Data,
    }).catch(() => {
      // ignore missing files; we still want to clear metadata
    });
  }
  for (const alias of aliases) delete assets[alias];
  saveOfflineNativeAssetIndex(profileKey, assets);
}

export async function clearNativeOfflineAssets(
  profileKey: string,
): Promise<void> {
  if (!isNative) return;
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
}

export function getNativeOfflinePlaybackUrl(
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
  options: { target?: "webview" | "android-native" } = {},
): string | null {
  if (!isNative) return null;
  const profileKey = getActiveOfflineProfileKey();
  if (!profileKey) return null;
  const assets = loadOfflineNativeAssetIndex(profileKey);
  const entry = getOfflineTrackAssetAliases(track, storageId)
    .map((alias) => assets[alias])
    .find(Boolean);
  if (!entry) return null;
  return options.target === "android-native"
    ? entry.uri || null
    : entry.playbackUrl || null;
}

export function offlineTrackFromIdentity(
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
): OfflineManifestTrack {
  return typeof track === "object" && track
    ? (track as OfflineManifestTrack)
    : {
        storage_id:
          typeof track === "string"
            ? normalizeIdentityValue(storageId) || normalizeIdentityValue(track)
            : normalizeIdentityValue(storageId),
        title: "",
        artist: "",
        stream_url: "",
        download_url: "",
      };
}
