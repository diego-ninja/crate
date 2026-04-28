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
  storageId?: string | null,
): OfflineItemState {
  if (!storageId) return "idle";
  const matches = items.filter((item) => item.tracks.some((track) => track.storage_id === storageId));
  if (!matches.length) return "idle";
  if (matches.some((item) => item.readyStorageIds?.includes(storageId) || item.state === "ready")) return "ready";
  if (matches.some((item) => item.state === "downloading")) return "downloading";
  if (matches.some((item) => item.state === "syncing")) return "syncing";
  if (matches.some((item) => item.state === "queued")) return "queued";
  if (matches.some((item) => item.state === "error")) return "error";
  return "idle";
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
      readyStorageIds: existing?.readyStorageIds || [],
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
    const readyStorageIds: string[] = [];
    for (const track of manifestTracks) {
      if (!track.storage_id) continue;
      if (await hasCachedTrackAsset(profileKey, track.storage_id)) {
        readyCount += 1;
        readyStorageIds.push(track.storage_id);
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
      readyStorageIds,
      errorMessage: manifestTracks.length ? null : "Item has no playable tracks",
    };
    commitSnapshot({
      items: {
        ...snapshotRef.current.items,
        [itemKey]: midItem,
      },
    });

    for (const track of manifestTracks) {
      if (!track.storage_id) {
        failureCount += 1;
        failureMessage = "One or more tracks are missing storage IDs";
        continue;
      }
      if (midItem.readyStorageIds?.includes(track.storage_id)) {
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
        readyStorageIds: Array.from(
          new Set([...(midItem.readyStorageIds || []), track.storage_id]),
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
      readyStorageIds: midItem.readyStorageIds || [],
    };

    const nextSnapshot: OfflineSnapshot = {
      items: {
        ...snapshotRef.current.items,
        [itemKey]: nextItem,
      },
    };
    commitSnapshot(nextSnapshot);

    const oldStorageIds = new Set((existing?.tracks || []).map((track) => track.storage_id));
    for (const track of manifestTracks) {
      oldStorageIds.delete(track.storage_id);
    }
    if (oldStorageIds.size) {
      const usage = buildAssetUsage(nextSnapshot);
      for (const storageId of oldStorageIds) {
        if ((usage.get(storageId) || 0) === 0) {
          await deleteCachedTrackAsset(profileKey, storageId);
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
      if ((usage.get(track.storage_id) || 0) === 0) {
        await deleteCachedTrackAsset(profileKey, track.storage_id);
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
          await syncManifestIntoItem("track", item.entityId, `/api/offline/tracks/by-storage/${encodeURIComponent(item.entityId)}/manifest`);
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
    const storageId = input.storageId?.trim();
    if (!storageId) {
      throw new Error("Track offline requires storage_id");
    }
    if (snapshotRef.current.items[getOfflineItemKey("track", storageId)]) {
      await removeOfflineItem("track", storageId);
      return "removed" as const;
    }
    await syncManifestIntoItem("track", storageId, `/api/offline/tracks/by-storage/${encodeURIComponent(storageId)}/manifest`);
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
    getTrackState: (storageId) => aggregateTrackState(items, storageId),
    getAlbumState: (albumId) => snapshot.items[getOfflineItemKey("album", albumId ?? "")]?.state ?? "idle",
    getPlaylistState: (playlistId) => snapshot.items[getOfflineItemKey("playlist", playlistId ?? "")]?.state ?? "idle",
    getAlbumRecord: (albumId) => snapshot.items[getOfflineItemKey("album", albumId ?? "")] ?? null,
    getPlaylistRecord: (playlistId) => snapshot.items[getOfflineItemKey("playlist", playlistId ?? "")] ?? null,
    isTrackOffline: (storageId) => aggregateTrackState(items, storageId) === "ready",
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
