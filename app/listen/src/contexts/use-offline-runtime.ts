import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AuthUser } from "@/contexts/auth-context";
import type {
  OfflineAlbumInput,
  OfflineContextValue,
  OfflinePlaylistInput,
  OfflineTrackInput,
} from "@/contexts/offline-context";
import { api } from "@/lib/api";
import { onAppResume, isNative } from "@/lib/capacitor";
import { getCurrentServer } from "@/lib/server-store";
import {
  type OfflineItemKind,
  type OfflineItemRecord,
  type OfflineItemState,
  type OfflineManifest,
  type OfflineSnapshot,
  type OfflineSummary,
  buildAssetUsage,
  cacheTrackAsset,
  clearOfflineAssets,
  deleteCachedTrackAsset,
  deriveOfflineProfileKey,
  ensureOfflineStorageBudget,
  getOfflineItemKey,
  getOfflineTrackAssetKey,
  getOfflineTrackManifestPaths,
  hasCachedTrackAsset,
  hydrateOfflineProfileState,
  isOfflineBusy,
  isOfflineSupported,
  saveOfflineSnapshot,
  setActiveOfflineProfileKey,
  summarizeOfflineSnapshot,
  syncOfflineProfileToServiceWorker,
} from "@/lib/offline";

const EMPTY_SNAPSHOT: OfflineSnapshot = { items: {} };
const EMPTY_SUMMARY: OfflineSummary = {
  itemCount: 0,
  readyItemCount: 0,
  errorItemCount: 0,
  trackCount: 0,
  readyTrackCount: 0,
  totalBytes: 0,
};

function aggregateTrackState(
  items: OfflineItemRecord[],
  entityUid?: string | null,
): OfflineItemState {
  const assetKey = getOfflineTrackAssetKey({ entityUid });
  if (!assetKey) return "idle";
  const matches = items.filter((item) =>
    item.tracks.some((track) => getOfflineTrackAssetKey(track) === assetKey),
  );
  if (!matches.length) return "idle";
  if (matches.some((item) => item.readyAssetKeys?.includes(assetKey) || item.state === "ready")) return "ready";
  if (matches.some((item) => item.state === "downloading")) return "downloading";
  if (matches.some((item) => item.state === "syncing")) return "syncing";
  if (matches.some((item) => item.state === "queued")) return "queued";
  if (matches.some((item) => item.state === "error")) return "error";
  return "idle";
}

function findTrackOfflineItem(
  items: Record<string, OfflineItemRecord>,
  entityUid?: string | null,
): OfflineItemRecord | null {
  const assetKey = getOfflineTrackAssetKey({ entityUid });
  if (!assetKey) return null;
  return Object.values(items).find(
    (item) =>
      item.kind === "track" &&
      (item.entityId === assetKey || item.tracks.some((track) => getOfflineTrackAssetKey(track) === assetKey)),
  ) || null;
}

export function useOfflineRuntime(user: AuthUser | null): OfflineContextValue {
  const supported = isOfflineSupported();
  const [snapshot, setSnapshot] = useState<OfflineSnapshot>(EMPTY_SNAPSHOT);
  const [syncing, setSyncing] = useState(false);
  const snapshotRef = useRef<OfflineSnapshot>(EMPTY_SNAPSHOT);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const resumedProfileRef = useRef<string | null>(null);

  const profileKey = useMemo(() => {
    if (!user?.id || !supported) return null;
    const origin = isNative
      ? (getCurrentServer()?.url || window.location.origin)
      : window.location.origin;
    return deriveOfflineProfileKey(user.id, origin);
  }, [supported, user?.id]);

  const commitSnapshot = useCallback((next: OfflineSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    saveOfflineSnapshot(profileKey, next);
  }, [profileKey]);

  useEffect(() => {
    resumedProfileRef.current = null;
    let cancelled = false;
    setActiveOfflineProfileKey(profileKey);
    void syncOfflineProfileToServiceWorker(profileKey);
    void (async () => {
      const next = await hydrateOfflineProfileState(profileKey);
      if (cancelled) return;
      snapshotRef.current = next;
      setSnapshot(next);
    })();
    return () => {
      cancelled = true;
      setActiveOfflineProfileKey(null);
      void syncOfflineProfileToServiceWorker(null);
    };
  }, [profileKey]);

  const enqueue = useCallback(<T,>(fn: () => Promise<T>) => {
    const nextRun = queueRef.current.then(fn, fn);
    queueRef.current = nextRun.then(() => undefined, () => undefined);
    return nextRun;
  }, []);

  const syncManifestIntoItem = useCallback(async (
    kind: OfflineItemKind,
    entityId: string | number,
    manifestPath: string,
  ) => {
    if (!supported || !profileKey) {
      throw new Error("Offline playback is not supported in this environment");
    }

    const itemKey = getOfflineItemKey(kind, entityId);
    const existing = snapshotRef.current.items[itemKey];
    const provisional: OfflineItemRecord = {
      key: itemKey,
      kind,
      entityId: String(entityId),
      title: existing?.title || "Offline item",
      state: existing ? "syncing" : "queued",
      trackCount: existing?.trackCount || 0,
      readyTrackCount: existing?.readyTrackCount || 0,
      contentVersion: existing?.contentVersion || null,
      updatedAt: existing?.updatedAt || null,
      lastSyncedAt: existing?.lastSyncedAt || null,
      totalBytes: existing?.totalBytes || 0,
      errorMessage: null,
      readyAssetKeys: existing?.readyAssetKeys || [],
      tracks: existing?.tracks || [],
    };
    commitSnapshot({
      items: {
        ...snapshotRef.current.items,
        [itemKey]: provisional,
      },
    });

    let manifest: OfflineManifest;
    try {
      manifest = await api<OfflineManifest>(manifestPath);
    } catch (error) {
      const failedItem: OfflineItemRecord = {
        ...provisional,
        state: "error",
        errorMessage: (error as Error).message || "Failed to fetch offline manifest",
      };
      commitSnapshot({
        items: {
          ...snapshotRef.current.items,
          [itemKey]: failedItem,
        },
      });
      throw error;
    }

    let readyCount = 0;
    let failureCount = 0;
    let failureMessage: string | null = null;
    const manifestTracks = manifest.tracks || [];
    const readyAssetKeys: string[] = [];
    for (const track of manifestTracks) {
      const assetKey = getOfflineTrackAssetKey(track);
      if (!assetKey) continue;
      if (await hasCachedTrackAsset(profileKey, track)) {
        readyCount += 1;
        readyAssetKeys.push(assetKey);
      }
    }
    await ensureOfflineStorageBudget(profileKey, manifestTracks);
    let midItem: OfflineItemRecord = {
      ...provisional,
      title: manifest.title,
      state: manifestTracks.length > 0
        ? readyCount === manifestTracks.length
          ? "ready"
          : "downloading"
        : "error",
      trackCount: manifest.track_count || manifestTracks.length,
      readyTrackCount: readyCount,
      contentVersion: manifest.content_version,
      updatedAt: manifest.updated_at ?? null,
      totalBytes: manifest.total_bytes ?? 0,
      tracks: manifestTracks,
      readyAssetKeys,
      errorMessage: manifestTracks.length ? null : "Item has no playable tracks",
    };
    commitSnapshot({
      items: {
        ...snapshotRef.current.items,
        [itemKey]: midItem,
      },
    });

    for (const track of manifestTracks) {
      const assetKey = getOfflineTrackAssetKey(track);
      if (!assetKey) {
        failureCount += 1;
        failureMessage = "One or more tracks are missing entity identifiers";
        continue;
      }
      if (midItem.readyAssetKeys?.includes(assetKey)) {
        continue;
      }
      try {
        await cacheTrackAsset(profileKey, track);
      } catch (error) {
        failureCount += 1;
        failureMessage = (error as Error).message || "Failed to cache one or more tracks";
        midItem = {
          ...midItem,
          state: "error",
          errorMessage: failureMessage,
        };
        commitSnapshot({
          items: {
            ...snapshotRef.current.items,
            [itemKey]: midItem,
          },
        });
        continue;
      }
      readyCount += 1;
      midItem = {
        ...midItem,
        readyTrackCount: readyCount,
        readyAssetKeys: Array.from(
          new Set([...(midItem.readyAssetKeys || []), assetKey]),
        ),
      };
      commitSnapshot({
        items: {
          ...snapshotRef.current.items,
          [itemKey]: midItem,
        },
      });
    }

    const nextItem: OfflineItemRecord = {
      ...midItem,
      state: readyCount === manifestTracks.length && failureCount === 0 ? "ready" : "error",
      readyTrackCount: readyCount,
      lastSyncedAt: new Date().toISOString(),
      totalBytes: manifest.total_bytes ?? 0,
      errorMessage: readyCount === manifestTracks.length && failureCount === 0
        ? null
        : failureMessage || "Some tracks failed to cache",
      readyAssetKeys: midItem.readyAssetKeys || [],
    };

    const nextSnapshot: OfflineSnapshot = {
      items: {
        ...snapshotRef.current.items,
        [itemKey]: nextItem,
      },
    };
    commitSnapshot(nextSnapshot);

    const oldAssetKeys = new Set(
      (existing?.tracks || [])
        .map((track) => getOfflineTrackAssetKey(track))
        .filter((value): value is string => Boolean(value)),
    );
    for (const track of manifestTracks) {
      const assetKey = getOfflineTrackAssetKey(track);
      if (assetKey) {
        oldAssetKeys.delete(assetKey);
      }
    }
    if (oldAssetKeys.size) {
      const usage = buildAssetUsage(nextSnapshot);
      for (const assetKey of oldAssetKeys) {
        if ((usage.get(assetKey) || 0) === 0) {
          await deleteCachedTrackAsset(profileKey, assetKey);
        }
      }
    }
  }, [commitSnapshot, profileKey, supported]);

  const removeOfflineItem = useCallback(async (kind: OfflineItemKind, entityId: string | number) => {
    if (!supported || !profileKey) return;
    const itemKey = getOfflineItemKey(kind, entityId);
    const existing = snapshotRef.current.items[itemKey];
    if (!existing) return;
    const nextSnapshot: OfflineSnapshot = {
      items: { ...snapshotRef.current.items },
    };
    delete nextSnapshot.items[itemKey];
    commitSnapshot(nextSnapshot);
    const usage = buildAssetUsage(nextSnapshot);
    for (const track of existing.tracks) {
      const assetKey = getOfflineTrackAssetKey(track);
      if (assetKey && (usage.get(assetKey) || 0) === 0) {
        await deleteCachedTrackAsset(profileKey, track);
      }
    }
  }, [commitSnapshot, profileKey, supported]);

  const syncAll = useCallback(async () => {
    if (!profileKey || !supported) return;
    const items = Object.values(snapshotRef.current.items);
    if (!items.length) return;
    setSyncing(true);
    try {
      for (const item of items) {
        if (item.kind === "track") {
          const firstTrack = item.tracks[0];
          const trackRef = getOfflineTrackAssetKey(firstTrack) || item.entityId;
          const manifestPaths = getOfflineTrackManifestPaths(firstTrack ?? item.entityId);
          let synced = false;
          let lastError: unknown = null;
          for (const manifestPath of manifestPaths) {
            try {
              await syncManifestIntoItem("track", trackRef, manifestPath);
              synced = true;
              break;
            } catch (error) {
              lastError = error;
            }
          }
          if (!synced) {
            throw (lastError instanceof Error ? lastError : new Error("Failed to fetch offline track manifest"));
          }
        } else if (item.kind === "album") {
          await syncManifestIntoItem("album", item.entityId, `/api/offline/albums/${item.entityId}/manifest`);
        } else if (item.kind === "playlist") {
          await syncManifestIntoItem("playlist", item.entityId, `/api/offline/playlists/${item.entityId}/manifest`);
        }
      }
    } finally {
      setSyncing(false);
    }
  }, [profileKey, supported, syncManifestIntoItem]);

  useEffect(() => {
    if (!profileKey || !supported) return;
    if (resumedProfileRef.current === profileKey) return;
    const hasPendingItems = Object.values(snapshot.items).some((item) => isOfflineBusy(item.state));
    if (!hasPendingItems) return;
    resumedProfileRef.current = profileKey;
    void enqueue(async () => {
      setSyncing(true);
      try {
        await syncAll();
      } finally {
        setSyncing(false);
      }
    });
  }, [enqueue, profileKey, snapshot.items, supported, syncAll]);

  useEffect(() => {
    if (!profileKey || !supported) return;
    const handleOnline = () => {
      void enqueue(async () => {
        setSyncing(true);
        try {
          await syncAll();
        } finally {
          setSyncing(false);
        }
      });
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("crate:network-restored", handleOnline as EventListener);
    const disposeResume = onAppResume(handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("crate:network-restored", handleOnline as EventListener);
      disposeResume();
    };
  }, [enqueue, profileKey, supported, syncAll]);

  const toggleTrackOffline = useCallback((input: OfflineTrackInput) => enqueue(async () => {
    const entityUid = input.entityUid?.trim();
    const assetKey = getOfflineTrackAssetKey({ entityUid });
    if (!assetKey) {
      throw new Error("Track offline requires entity_uid");
    }
    const existing = findTrackOfflineItem(snapshotRef.current.items, entityUid);
    if (existing) {
      await removeOfflineItem("track", existing.entityId);
      return "removed" as const;
    }
    const manifestPaths = getOfflineTrackManifestPaths({ entityUid });
    let synced = false;
    let lastError: unknown = null;
    for (const manifestPath of manifestPaths) {
      try {
        await syncManifestIntoItem("track", assetKey, manifestPath);
        synced = true;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!synced) {
      throw (lastError instanceof Error ? lastError : new Error("Failed to fetch offline track manifest"));
    }
    return "enabled" as const;
  }), [enqueue, removeOfflineItem, syncManifestIntoItem]);

  const toggleAlbumOffline = useCallback((input: OfflineAlbumInput) => enqueue(async () => {
    const albumId = input.albumId;
    if (albumId == null) {
      throw new Error("Album offline requires album ID");
    }
    if (snapshotRef.current.items[getOfflineItemKey("album", albumId)]) {
      await removeOfflineItem("album", albumId);
      return "removed" as const;
    }
    await syncManifestIntoItem("album", albumId, `/api/offline/albums/${albumId}/manifest`);
    return "enabled" as const;
  }), [enqueue, removeOfflineItem, syncManifestIntoItem]);

  const togglePlaylistOffline = useCallback((input: OfflinePlaylistInput) => enqueue(async () => {
    const playlistId = input.playlistId;
    if (playlistId == null) {
      throw new Error("Playlist offline requires playlist ID");
    }
    if (input.isSmart) {
      throw new Error("Offline is only available for static playlists");
    }
    if (snapshotRef.current.items[getOfflineItemKey("playlist", playlistId)]) {
      await removeOfflineItem("playlist", playlistId);
      return "removed" as const;
    }
    await syncManifestIntoItem("playlist", playlistId, `/api/offline/playlists/${playlistId}/manifest`);
    return "enabled" as const;
  }), [enqueue, removeOfflineItem, syncManifestIntoItem]);

  const clearActiveProfile = useCallback(async () => {
    if (!profileKey || !supported) return;
    commitSnapshot(EMPTY_SNAPSHOT);
    await clearOfflineAssets(profileKey);
  }, [commitSnapshot, profileKey, supported]);

  const items = useMemo(() => Object.values(snapshot.items), [snapshot.items]);
  const summary = useMemo(
    () => (supported ? summarizeOfflineSnapshot(snapshot) : EMPTY_SUMMARY),
    [snapshot, supported],
  );

  return useMemo<OfflineContextValue>(() => ({
    supported,
    syncing,
    summary,
    getTrackState: (entityUid) => aggregateTrackState(items, entityUid),
    getAlbumState: (albumId) => snapshot.items[getOfflineItemKey("album", albumId ?? "")]?.state ?? "idle",
    getPlaylistState: (playlistId) => snapshot.items[getOfflineItemKey("playlist", playlistId ?? "")]?.state ?? "idle",
    getAlbumRecord: (albumId) => snapshot.items[getOfflineItemKey("album", albumId ?? "")] ?? null,
    getPlaylistRecord: (playlistId) => snapshot.items[getOfflineItemKey("playlist", playlistId ?? "")] ?? null,
    isTrackOffline: (entityUid) => aggregateTrackState(items, entityUid) === "ready",
    isAlbumOffline: (albumId) => snapshot.items[getOfflineItemKey("album", albumId ?? "")]?.state === "ready",
    isPlaylistOffline: (playlistId) => snapshot.items[getOfflineItemKey("playlist", playlistId ?? "")]?.state === "ready",
    toggleTrackOffline,
    toggleAlbumOffline,
    togglePlaylistOffline,
    syncAll,
    clearActiveProfile,
  }), [
    clearActiveProfile,
    items,
    snapshot.items,
    summary,
    supported,
    syncAll,
    syncing,
    toggleAlbumOffline,
    togglePlaylistOffline,
    toggleTrackOffline,
  ]);
}
