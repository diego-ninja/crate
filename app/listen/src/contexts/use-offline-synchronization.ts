import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { onAppResume } from "@/lib/capacitor";
import type { OfflineItemKind, OfflineSnapshot } from "@/lib/offline";
import {
  getOfflineTrackAssetKey,
  getOfflineTrackManifestPaths,
  isOfflineBusy,
} from "@/lib/offline";

type Enqueue = <T>(fn: () => Promise<T>) => Promise<T>;
type SyncManifestIntoItem = (
  kind: OfflineItemKind,
  entityId: string | number,
  manifestPath: string,
) => Promise<void>;

interface UseOfflineSynchronizationOptions {
  enqueue: Enqueue;
  profileKey: string | null;
  snapshot: OfflineSnapshot;
  snapshotRef: MutableRefObject<OfflineSnapshot>;
  supported: boolean;
  syncManifestIntoItem: SyncManifestIntoItem;
  transferAbortRef: MutableRefObject<AbortController | null>;
}

export function useOfflineSynchronization({
  enqueue,
  profileKey,
  snapshot,
  snapshotRef,
  supported,
  syncManifestIntoItem,
  transferAbortRef,
}: UseOfflineSynchronizationOptions) {
  const [syncing, setSyncing] = useState(false);
  const resumedProfileRef = useRef<string | null>(null);

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
          const manifestPaths = getOfflineTrackManifestPaths(
            firstTrack ?? item.entityId,
          );
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
            throw lastError instanceof Error
              ? lastError
              : new Error("Failed to fetch offline track manifest");
          }
        } else if (item.kind === "album") {
          // Album and playlist manifests update the same item snapshot; keep
          // the outer sync sequential to avoid lost updates.
          // react-doctor-disable-next-line async-await-in-loop
          await syncManifestIntoItem(
            "album",
            item.entityId,
            `/api/offline/albums/${item.entityId}/manifest`,
          );
        } else if (item.kind === "playlist") {
          // Album and playlist manifests update the same item snapshot; keep
          // the outer sync sequential to avoid lost updates.
          // react-doctor-disable-next-line async-await-in-loop
          await syncManifestIntoItem(
            "playlist",
            item.entityId,
            `/api/offline/playlists/${item.entityId}/manifest`,
          );
        }
      }
    } finally {
      setSyncing(false);
    }
  }, [profileKey, snapshotRef, supported, syncManifestIntoItem]);

  const enqueueSync = useCallback(() => {
    void enqueue(async () => {
      setSyncing(true);
      try {
        await syncAll();
      } finally {
        setSyncing(false);
      }
    });
  }, [enqueue, syncAll]);

  useEffect(() => {
    if (!profileKey || !supported) return;
    if (resumedProfileRef.current === profileKey) return;
    const hasPendingItems = Object.values(snapshot.items).some((item) =>
      isOfflineBusy(item.state),
    );
    if (!hasPendingItems) return;
    resumedProfileRef.current = profileKey;
    // Rehydrated work must enter the shared queue owned by the runtime;
    // invoking it here is the synchronization side effect, not parent data.
    // react-doctor-disable-next-line no-pass-data-to-parent
    enqueueSync();
  }, [enqueueSync, profileKey, snapshot.items, supported]);

  useEffect(() => {
    if (!profileKey || !supported) return;
    const handleOnline = () => {
      enqueueSync();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener(
      "crate:network-restored",
      handleOnline as EventListener,
    );
    const disposeResume = onAppResume(handleOnline);
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        transferAbortRef.current?.abort();
      } else {
        enqueueSync();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener(
        "crate:network-restored",
        handleOnline as EventListener,
      );
      document.removeEventListener("visibilitychange", handleVisibility);
      disposeResume();
    };
  }, [enqueueSync, profileKey, supported, transferAbortRef]);

  return { syncing, syncAll };
}
