import { useCallback, type MutableRefObject } from "react";

import { api } from "@/lib/api";
import type {
  OfflineItemKind,
  OfflineItemRecord,
  OfflineManifest,
  OfflineSnapshot,
} from "@/lib/offline";
import {
  buildAssetUsage,
  cacheTrackAsset,
  deleteCachedTrackAsset,
  ensureOfflineStorageBudget,
  getOfflineItemKey,
  getOfflineTrackAssetKey,
  hasCachedTrackAssets,
} from "@/lib/offline";
import {
  runBoundedOfflineTasks,
  waitForOfflineTransferPermission,
} from "@/lib/offline-scheduler";

interface UseOfflineManifestSyncOptions {
  supported: boolean;
  profileKey: string | null;
  snapshotRef: MutableRefObject<OfflineSnapshot>;
  transferAbortRef: MutableRefObject<AbortController | null>;
  commitSnapshot: (next: OfflineSnapshot, flush?: boolean) => void;
}

export function useOfflineManifestSync({
  supported,
  profileKey,
  snapshotRef,
  transferAbortRef,
  commitSnapshot,
}: UseOfflineManifestSyncOptions) {
  return useCallback(
    async (
      kind: OfflineItemKind,
      entityId: string | number,
      manifestPath: string,
    ) => {
      if (!supported || !profileKey) {
        throw new Error(
          "Offline playback is not supported in this environment",
        );
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
          errorMessage:
            (error as Error).message || "Failed to fetch offline manifest",
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
      const cachedAssetKeys = await hasCachedTrackAssets(
        profileKey,
        manifestTracks,
      );
      const readyAssetKeys = Array.from(cachedAssetKeys);
      readyCount = readyAssetKeys.length;
      let midItem: OfflineItemRecord = {
        ...provisional,
        title: manifest.title,
        state:
          manifestTracks.length > 0
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
        errorMessage: manifestTracks.length
          ? null
          : "Item has no playable tracks",
      };
      commitSnapshot({
        items: {
          ...snapshotRef.current.items,
          [itemKey]: midItem,
        },
      });

      const readyKeys = new Set(midItem.readyAssetKeys || []);
      const pendingTracks = manifestTracks.filter((track) => {
        const assetKey = getOfflineTrackAssetKey(track);
        if (!assetKey) {
          failureCount += 1;
          failureMessage = "One or more tracks are missing entity identifiers";
          return false;
        }
        return !readyKeys.has(assetKey);
      });
      transferAbortRef.current?.abort();
      const transferController = new AbortController();
      transferAbortRef.current = transferController;
      try {
        const runResult = await runBoundedOfflineTasks(
          pendingTracks,
          async (track) => {
            const assetKey = getOfflineTrackAssetKey(track);
            if (!assetKey) return;
            try {
              await waitForOfflineTransferPermission(transferController.signal);
              if (transferController.signal.aborted) return;
              await ensureOfflineStorageBudget(profileKey, [track], {
                assumeMissing: true,
              });
              await cacheTrackAsset(profileKey, track);
            } catch (error) {
              if (transferController.signal.aborted) return;
              failureCount += 1;
              failureMessage =
                (error as Error).message ||
                "Failed to cache one or more tracks";
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
              return;
            }
            readyKeys.add(assetKey);
            readyCount = readyKeys.size;
            midItem = {
              ...midItem,
              readyTrackCount: readyCount,
              readyAssetKeys: Array.from(readyKeys),
            };
            commitSnapshot({
              items: {
                ...snapshotRef.current.items,
                [itemKey]: midItem,
              },
            });
          },
          { concurrency: 2, signal: transferController.signal },
        );
        if (runResult.cancelled) return;
      } finally {
        if (transferAbortRef.current === transferController) {
          transferAbortRef.current = null;
        }
      }

      const nextItem: OfflineItemRecord = {
        ...midItem,
        state:
          readyCount === manifestTracks.length && failureCount === 0
            ? "ready"
            : "error",
        readyTrackCount: readyCount,
        lastSyncedAt: new Date().toISOString(),
        totalBytes: manifest.total_bytes ?? 0,
        errorMessage:
          readyCount === manifestTracks.length && failureCount === 0
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
      commitSnapshot(nextSnapshot, true);

      const oldAssetKeys = new Set(
        (existing?.tracks || []).reduce<string[]>((keys, track) => {
          const assetKey = getOfflineTrackAssetKey(track);
          if (assetKey) keys.push(assetKey);
          return keys;
        }, []),
      );
      for (const track of manifestTracks) {
        const assetKey = getOfflineTrackAssetKey(track);
        if (assetKey) {
          oldAssetKeys.delete(assetKey);
        }
      }
      if (oldAssetKeys.size) {
        const usage = buildAssetUsage(nextSnapshot);
        await Promise.all(
          [...oldAssetKeys].reduce<Promise<void>[]>((deletions, assetKey) => {
            if ((usage.get(assetKey) || 0) === 0) {
              deletions.push(deleteCachedTrackAsset(profileKey, assetKey));
            }
            return deletions;
          }, []),
        );
      }
    },
    [commitSnapshot, profileKey, snapshotRef, supported, transferAbortRef],
  );
}
