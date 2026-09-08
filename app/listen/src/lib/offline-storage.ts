import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

import { isNative } from "@/lib/capacitor-runtime";
import {
  getOfflineTrackAssetAliases,
  getOfflineTrackAssetKey,
  normalizeIdentityValue,
} from "@/lib/offline-track-identity";
import {
  readOfflineStoreItem,
  writeOfflineStoreItem,
} from "@/lib/offline-store";
import type {
  OfflineItemKind,
  OfflineItemRecord,
  OfflineNativeAssetRecord,
  OfflineSnapshot,
} from "./offline-model";
import { EMPTY_OFFLINE_SNAPSHOT } from "./offline-model";

export type {
  OfflineItemKind,
  OfflineItemRecord,
  OfflineManifest,
  OfflineManifestTrack,
  OfflineNativeAssetRecord,
  OfflineSnapshot,
  OfflineSummary,
} from "./offline-model";

const OFFLINE_META_PREFIX = "listen-offline-meta::";
const OFFLINE_NATIVE_ASSET_PREFIX = "listen-offline-native-assets::";
const OFFLINE_ACTIVE_PROFILE_KEY = "listen-offline-active-profile";
const OFFLINE_CACHE_PREFIX = "crate-listen-offline-media::";
const OFFLINE_NATIVE_META_DIR = "offline-meta";
const OFFLINE_NATIVE_SNAPSHOT_PREFIX = "offline-index-";
const OFFLINE_NATIVE_ASSET_FILE_PREFIX = "offline-assets-";

const nativeSnapshotCache = new Map<string, OfflineSnapshot>();
const nativeAssetIndexCache = new Map<
  string,
  Record<string, OfflineNativeAssetRecord>
>();
const nativeSnapshotLoaders = new Map<string, Promise<OfflineSnapshot>>();
const nativeAssetIndexLoaders = new Map<
  string,
  Promise<Record<string, OfflineNativeAssetRecord>>
>();

export function getOfflineItemKey(
  kind: OfflineItemKind,
  entityId: string | number,
): string {
  return `${kind}:${entityId}`;
}

export function getOfflineCacheName(profileKey: string): string {
  return `${OFFLINE_CACHE_PREFIX}${profileKey}`;
}

export function getActiveOfflineProfileKey(): string | null {
  return readOfflineStoreItem(OFFLINE_ACTIVE_PROFILE_KEY);
}

export function setActiveOfflineProfileKey(profileKey: string | null): void {
  writeOfflineStoreItem(OFFLINE_ACTIVE_PROFILE_KEY, profileKey);
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
  if (!raw) return EMPTY_OFFLINE_SNAPSHOT;
  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.items !== "object"
    ) {
      return EMPTY_OFFLINE_SNAPSHOT;
    }
    return normalizeOfflineSnapshot({
      items: parsed.items as Record<string, OfflineItemRecord>,
    });
  } catch {
    return EMPTY_OFFLINE_SNAPSHOT;
  }
}

function normalizeOfflineItemRecord(
  item: OfflineItemRecord,
): OfflineItemRecord {
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
      (item.readyAssetKeys || item.readyStorageIds || [])
        .map(
          (value) =>
            aliasToAssetKey.get(value) || normalizeIdentityValue(value),
        )
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const canonicalEntityId =
    item.kind === "track"
      ? getOfflineTrackAssetKey(normalizedTracks[0] ?? null) ||
        normalizeIdentityValue(item.entityId) ||
        String(item.entityId)
      : String(item.entityId);

  return {
    ...item,
    key: getOfflineItemKey(item.kind, canonicalEntityId),
    entityId: canonicalEntityId,
    readyAssetKeys:
      normalizedReadyAssetKeys.length ||
      item.readyAssetKeys ||
      item.readyStorageIds
        ? normalizedReadyAssetKeys
        : undefined,
    readyStorageIds: undefined,
    tracks: normalizedTracks,
  };
}

export function normalizeOfflineSnapshot(
  snapshot: OfflineSnapshot,
): OfflineSnapshot {
  const items: Record<string, OfflineItemRecord> = {};
  for (const record of Object.values(snapshot.items || {})) {
    const normalized = normalizeOfflineItemRecord(record);
    items[normalized.key] = normalized;
  }
  return { items };
}

function parseOfflineNativeAssetIndex(
  raw: string | null,
): Record<string, OfflineNativeAssetRecord> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, OfflineNativeAssetRecord>)
      : {};
  } catch {
    return {};
  }
}

function getLegacyOfflineSnapshot(profileKey: string): OfflineSnapshot {
  if (typeof window === "undefined") return EMPTY_OFFLINE_SNAPSHOT;
  try {
    return parseOfflineSnapshot(
      localStorage.getItem(`${OFFLINE_META_PREFIX}${profileKey}`),
    );
  } catch {
    return EMPTY_OFFLINE_SNAPSHOT;
  }
}

function getLegacyOfflineNativeAssetIndex(
  profileKey: string,
): Record<string, OfflineNativeAssetRecord> {
  if (typeof window === "undefined") return {};
  try {
    return parseOfflineNativeAssetIndex(
      localStorage.getItem(getOfflineNativeAssetStorageKey(profileKey)),
    );
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

async function writeNativeJsonFile(
  path: string,
  payload: unknown,
): Promise<void> {
  await ensureOfflineNativeMetaDir();
  await Filesystem.writeFile({
    path,
    directory: Directory.Data,
    recursive: true,
    encoding: Encoding.UTF8,
    data: JSON.stringify(payload),
  });
}

async function ensureOfflineSnapshotLoaded(
  profileKey: string,
): Promise<OfflineSnapshot> {
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

export async function ensureOfflineNativeAssetIndexLoaded(
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

export function loadOfflineNativeAssetIndex(
  profileKey: string,
): Record<string, OfflineNativeAssetRecord> {
  if (isNative) {
    return nativeAssetIndexCache.get(profileKey) ?? {};
  }
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(
      getOfflineNativeAssetStorageKey(profileKey),
    );
    return parseOfflineNativeAssetIndex(raw);
  } catch {
    return {};
  }
}

export function saveOfflineNativeAssetIndex(
  profileKey: string,
  assets: Record<string, OfflineNativeAssetRecord>,
): void {
  if (isNative) {
    nativeAssetIndexCache.set(profileKey, assets);
    void writeNativeJsonFile(
      getOfflineNativeAssetIndexPath(profileKey),
      assets,
    );
    return;
  }
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      getOfflineNativeAssetStorageKey(profileKey),
      JSON.stringify(assets),
    );
  } catch {
    // ignore persistence failures
  }
}

export function loadOfflineSnapshot(
  profileKey: string | null,
): OfflineSnapshot {
  if (!profileKey || typeof window === "undefined") {
    return EMPTY_OFFLINE_SNAPSHOT;
  }
  if (isNative) {
    return nativeSnapshotCache.get(profileKey) ?? EMPTY_OFFLINE_SNAPSHOT;
  }
  try {
    const raw = localStorage.getItem(`${OFFLINE_META_PREFIX}${profileKey}`);
    return parseOfflineSnapshot(raw);
  } catch {
    return EMPTY_OFFLINE_SNAPSHOT;
  }
}

export function saveOfflineSnapshot(
  profileKey: string | null,
  snapshot: OfflineSnapshot,
): void {
  if (!profileKey || typeof window === "undefined") return;
  const normalized = normalizeOfflineSnapshot(snapshot);
  if (isNative) {
    nativeSnapshotCache.set(profileKey, normalized);
    void writeNativeJsonFile(
      getOfflineNativeSnapshotPath(profileKey),
      normalized,
    );
    return;
  }
  try {
    localStorage.setItem(
      `${OFFLINE_META_PREFIX}${profileKey}`,
      JSON.stringify(normalized),
    );
  } catch {
    // ignore persistence failures; cache may still hold usable media
  }
}

export async function hydrateOfflineProfileState(
  profileKey: string | null,
): Promise<OfflineSnapshot> {
  if (!profileKey) return EMPTY_OFFLINE_SNAPSHOT;
  if (!isNative) return loadOfflineSnapshot(profileKey);
  const [snapshot] = await Promise.all([
    ensureOfflineSnapshotLoaded(profileKey),
    ensureOfflineNativeAssetIndexLoaded(profileKey),
  ]);
  return snapshot;
}
