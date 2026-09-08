import { beforeEach, describe, expect, it } from "vitest";

import {
  getOfflineItemKey,
  loadOfflineSnapshot,
  normalizeOfflineSnapshot,
  saveOfflineSnapshot,
  type OfflineSnapshot,
} from "./offline-storage";

beforeEach(() => {
  localStorage.clear();
});

describe("offline storage", () => {
  it("round-trips a normalized snapshot per profile", () => {
    const snapshot: OfflineSnapshot = {
      items: {
        [getOfflineItemKey("track", "storage-1")]: {
          key: getOfflineItemKey("track", "storage-1"),
          kind: "track",
          entityId: "storage-1",
          title: "Track",
          state: "ready",
          trackCount: 1,
          readyTrackCount: 1,
          tracks: [
            {
              storage_id: "storage-1",
              title: "Track",
              artist: "Artist",
              stream_url: "/stream",
              download_url: "/download",
            },
          ],
        },
      },
    };

    saveOfflineSnapshot("profile-1", snapshot);

    expect(loadOfflineSnapshot("profile-1")).toEqual(snapshot);
  });

  it("canonicalizes legacy track identity during normalization", () => {
    const snapshot = normalizeOfflineSnapshot({
      items: {
        "track:storage-1": {
          key: "track:storage-1",
          kind: "track",
          entityId: "storage-1",
          title: "Track",
          state: "ready",
          trackCount: 1,
          readyTrackCount: 1,
          readyAssetKeys: ["storage-1"],
          tracks: [
            {
              entity_uid: "entity-1",
              storage_id: "storage-1",
              title: "Track",
              artist: "Artist",
              stream_url: "/stream",
              download_url: "/download",
            },
          ],
        },
      },
    });

    expect(snapshot.items["track:entity-1"]?.readyAssetKeys).toEqual([
      "entity-1",
    ]);
  });
});
