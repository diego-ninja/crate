import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { isNative } from "@/lib/capacitor";
import { getCurrentServer } from "@/lib/server-store";
import {
  type OfflineItemKind,
  type OfflineItemRecord,
  type OfflineItemState,
  type OfflineSnapshot,
  type OfflineSummary,
  buildAssetUsage,
  clearOfflineAssets,
  deleteCachedTrackAsset,
  deriveOfflineProfileKey,
  getOfflineItemKey,
  getOfflineTrackAssetKey,
  getOfflineTrackManifestPaths,
  hydrateOfflineProfileState,
  isOfflineSupported,
  saveOfflineSnapshot,
  setActiveOfflineProfileKey,
  summarizeOfflineSnapshot,
  syncOfflineProfileToServiceWorker,
} from "@/lib/offline";
import {
  createCoalescedOfflineWriter,
  type CoalescedOfflineWriter,
} from "@/lib/offline-scheduler";
import { useOfflineManifestSync } from "@/contexts/use-offline-manifest-sync";
import { useOfflineSynchronization } from "@/contexts/use-offline-synchronization";

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
  ref?: string | OfflineTrackInput | null,
): OfflineItemState {
  const assetKey = getOfflineTrackAssetKey(ref);
  const trackId =
    typeof ref === "object" && ref
      ? ref.libraryTrackId ?? ref.trackId ?? null
      : null;
  if (!assetKey && trackId == null) return "idle";
  const matches = items.filter((item) =>
    item.tracks.some(
      (track) =>
        (assetKey && getOfflineTrackAssetKey(track) === assetKey) ||
        (trackId != null && track.track_id === trackId),
    ),
  );
  if (!matches.length) return "idle";
  if (
    matches.some(
      (item) =>
        (assetKey && item.readyAssetKeys?.includes(assetKey)) ||
        item.state === "ready",
    )
  )
    return "ready";
  if (matches.some((item) => item.state === "downloading"))
    return "downloading";
  if (matches.some((item) => item.state === "syncing")) return "syncing";
  if (matches.some((item) => item.state === "queued")) return "queued";
  if (matches.some((item) => item.state === "error")) return "error";
  return "idle";
}

function findTrackOfflineItem(
  items: Record<string, OfflineItemRecord>,
  ref?: string | OfflineTrackInput | null,
): OfflineItemRecord | null {
  const assetKey = getOfflineTrackAssetKey(ref);
  const trackId =
    typeof ref === "object" && ref
      ? ref.libraryTrackId ?? ref.trackId ?? null
      : null;
  if (!assetKey && trackId == null) return null;
  return (
    Object.values(items).find(
      (item) =>
        item.kind === "track" &&
        ((assetKey && item.entityId === assetKey) ||
          item.tracks.some(
            (track) =>
              (assetKey && getOfflineTrackAssetKey(track) === assetKey) ||
              (trackId != null && track.track_id === trackId),
          )),
    ) || null
  );
}

export function useOfflineRuntime(user: AuthUser | null): OfflineContextValue {
  const supported = isOfflineSupported();
  const [snapshot, setSnapshot] = useState<OfflineSnapshot>(EMPTY_SNAPSHOT);
  const snapshotRef = useRef<OfflineSnapshot>(EMPTY_SNAPSHOT);
  const queue = useMemo(() => Promise.resolve(), []);
  const queueRef = useRef(queue);
  const persistenceRef = useRef<{
    profileKey: string | null;
    writer: CoalescedOfflineWriter<OfflineSnapshot>;
  } | null>(null);
  const transferAbortRef = useRef<AbortController | null>(null);

  const profileKey = useMemo(() => {
    if (!user?.id || !supported) return null;
    const origin = isNative
      ? getCurrentServer()?.url || window.location.origin
      : window.location.origin;
    return deriveOfflineProfileKey(user.id, origin);
  }, [supported, user?.id]);
  const activeProfileRef = useRef(profileKey);
  useLayoutEffect(() => {
    activeProfileRef.current = profileKey;
  }, [profileKey]);

  const commitSnapshot = useCallback(
    (next: OfflineSnapshot, flush = false) => {
      if (activeProfileRef.current !== profileKey) return;
      snapshotRef.current = next;
      setSnapshot(next);
      if (persistenceRef.current?.profileKey !== profileKey) {
        persistenceRef.current?.writer.dispose();
        persistenceRef.current = {
          profileKey,
          writer: createCoalescedOfflineWriter((snapshotToPersist) => {
            saveOfflineSnapshot(profileKey, snapshotToPersist);
          }),
        };
      }
      persistenceRef.current.writer.schedule(next);
      if (flush) persistenceRef.current.writer.flush();
    },
    [profileKey],
  );

  // Profile teardown must abort whichever transfer is active at cleanup time;
  // a transfer may start after this effect is mounted, so reading the ref in
  // cleanup is intentional rather than a stale-closure bug.
  // react-doctor-disable-next-line exhaustive-deps
  useEffect(() => {
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
      transferAbortRef.current?.abort();
      persistenceRef.current?.writer.dispose();
      persistenceRef.current = null;
      setActiveOfflineProfileKey(null);
      void syncOfflineProfileToServiceWorker(null);
    };
  }, [profileKey]);

  const enqueue = useCallback(<T>(fn: () => Promise<T>) => {
    const nextRun = queueRef.current.then(fn, fn);
    queueRef.current = nextRun.then(
      () => undefined,
      () => undefined,
    );
    return nextRun;
  }, []);

  const syncManifestIntoItem = useOfflineManifestSync({
    commitSnapshot,
    profileKey,
    snapshotRef,
    supported,
    transferAbortRef,
  });

  const { syncing, syncAll } = useOfflineSynchronization({
    enqueue,
    profileKey,
    snapshot,
    snapshotRef,
    supported,
    syncManifestIntoItem,
    transferAbortRef,
  });

  const removeOfflineItem = useCallback(
    async (kind: OfflineItemKind, entityId: string | number) => {
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
      await Promise.all(
        existing.tracks
          .reduce<OfflineTrackInput[]>((tracks, track) => {
            const assetKey = getOfflineTrackAssetKey(track);
            if (assetKey && (usage.get(assetKey) || 0) === 0)
              tracks.push(track);
            return tracks;
          }, [])
          .map((track) => deleteCachedTrackAsset(profileKey, track)),
      );
    },
    [commitSnapshot, profileKey, supported],
  );

  const toggleTrackOffline = useCallback(
    (input: OfflineTrackInput) =>
      enqueue(async () => {
        const trackRef = {
          entityUid: input.entityUid?.trim() || null,
          storageId: input.storageId?.trim() || null,
          trackId: input.trackId ?? input.libraryTrackId ?? null,
          path: input.path?.trim() || null,
        };
        const assetKey =
          getOfflineTrackAssetKey(trackRef) ??
          (trackRef.trackId != null ? String(trackRef.trackId) : null) ??
          trackRef.path;
        if (!assetKey) {
          throw new Error("Track offline requires track identity");
        }
        const existing = findTrackOfflineItem(
          snapshotRef.current.items,
          trackRef,
        );
        if (existing) {
          await removeOfflineItem("track", existing.entityId);
          return "removed" as const;
        }
        const manifestPaths = getOfflineTrackManifestPaths(trackRef);
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
          throw lastError instanceof Error
            ? lastError
            : new Error("Failed to fetch offline track manifest");
        }
        return "enabled" as const;
      }),
    [enqueue, removeOfflineItem, syncManifestIntoItem],
  );

  const toggleAlbumOffline = useCallback(
    (input: OfflineAlbumInput) =>
      enqueue(async () => {
        const albumId = input.albumId;
        if (albumId == null) {
          throw new Error("Album offline requires album ID");
        }
        if (snapshotRef.current.items[getOfflineItemKey("album", albumId)]) {
          await removeOfflineItem("album", albumId);
          return "removed" as const;
        }
        await syncManifestIntoItem(
          "album",
          albumId,
          `/api/offline/albums/${albumId}/manifest`,
        );
        return "enabled" as const;
      }),
    [enqueue, removeOfflineItem, syncManifestIntoItem],
  );

  const togglePlaylistOffline = useCallback(
    (input: OfflinePlaylistInput) =>
      enqueue(async () => {
        const playlistId = input.playlistId;
        if (playlistId == null) {
          throw new Error("Playlist offline requires playlist ID");
        }
        if (input.isSmart) {
          throw new Error("Offline is only available for static playlists");
        }
        if (
          snapshotRef.current.items[getOfflineItemKey("playlist", playlistId)]
        ) {
          await removeOfflineItem("playlist", playlistId);
          return "removed" as const;
        }
        await syncManifestIntoItem(
          "playlist",
          playlistId,
          `/api/offline/playlists/${playlistId}/manifest`,
        );
        return "enabled" as const;
      }),
    [enqueue, removeOfflineItem, syncManifestIntoItem],
  );

  const clearActiveProfile = useCallback(async () => {
    if (!profileKey || !supported) return;
    commitSnapshot(EMPTY_SNAPSHOT, true);
    await clearOfflineAssets(profileKey);
  }, [commitSnapshot, profileKey, supported]);

  const items = useMemo(() => Object.values(snapshot.items), [snapshot.items]);
  const summary = useMemo(
    () => (supported ? summarizeOfflineSnapshot(snapshot) : EMPTY_SUMMARY),
    [snapshot, supported],
  );

  return useMemo<OfflineContextValue>(
    () => ({
      supported,
      syncing,
      summary,
      getTrackState: (ref) => aggregateTrackState(items, ref),
      getAlbumState: (albumId) =>
        snapshot.items[getOfflineItemKey("album", albumId ?? "")]?.state ??
        "idle",
      getPlaylistState: (playlistId) =>
        snapshot.items[getOfflineItemKey("playlist", playlistId ?? "")]
          ?.state ?? "idle",
      getAlbumRecord: (albumId) =>
        snapshot.items[getOfflineItemKey("album", albumId ?? "")] ?? null,
      getPlaylistRecord: (playlistId) =>
        snapshot.items[getOfflineItemKey("playlist", playlistId ?? "")] ?? null,
      isTrackOffline: (ref) => aggregateTrackState(items, ref) === "ready",
      isAlbumOffline: (albumId) =>
        snapshot.items[getOfflineItemKey("album", albumId ?? "")]?.state ===
        "ready",
      isPlaylistOffline: (playlistId) =>
        snapshot.items[getOfflineItemKey("playlist", playlistId ?? "")]
          ?.state === "ready",
      toggleTrackOffline,
      toggleAlbumOffline,
      togglePlaylistOffline,
      syncAll,
      clearActiveProfile,
    }),
    [
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
    ],
  );
}
