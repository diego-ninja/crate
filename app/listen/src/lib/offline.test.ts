import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deriveOfflineProfileKeyFromStoredUser,
  getActiveOfflineProfileKey,
  getOfflineItemKey,
  loadOfflineSnapshot,
  saveOfflineSnapshot,
  setActiveOfflineProfileKey,
  summarizeOfflineSnapshot,
  type OfflineSnapshot,
} from "./offline";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("offline metadata helpers", () => {
  it("derives a profile key from the persisted user id", () => {
    localStorage.setItem("listen-auth-user-id", "42");

    const key = deriveOfflineProfileKeyFromStoredUser("https://api.example.test");

    expect(key).toBeTruthy();
    expect(typeof key).toBe("string");
  });

  it("round-trips the active offline profile key", () => {
    setActiveOfflineProfileKey("profile-1");
    expect(getActiveOfflineProfileKey()).toBe("profile-1");

    setActiveOfflineProfileKey(null);
    expect(getActiveOfflineProfileKey()).toBeNull();
  });

  it("loads and saves offline snapshots per profile", () => {
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
          totalBytes: 1234,
          tracks: [{
            storage_id: "storage-1",
            title: "Track",
            artist: "Artist",
            stream_url: "/api/tracks/by-storage/storage-1/stream",
            download_url: "/api/tracks/by-storage/storage-1/download",
          }],
        },
      },
    };

    saveOfflineSnapshot("profile-1", snapshot);

    expect(loadOfflineSnapshot("profile-1")).toEqual(snapshot);
  });

  it("summarizes offline state across items", () => {
    const summary = summarizeOfflineSnapshot({
      items: {
        "track:storage-1": {
          key: "track:storage-1",
          kind: "track",
          entityId: "storage-1",
          title: "Track A",
          state: "ready",
          trackCount: 1,
          readyTrackCount: 1,
          totalBytes: 100,
          tracks: [{
            storage_id: "storage-1",
            title: "Track A",
            artist: "Artist",
            stream_url: "/api/tracks/by-storage/storage-1/stream",
            download_url: "/api/tracks/by-storage/storage-1/download",
          }],
        },
        "album:14": {
          key: "album:14",
          kind: "album",
          entityId: "14",
          title: "Album",
          state: "error",
          trackCount: 2,
          readyTrackCount: 1,
          totalBytes: 300,
          tracks: [
            {
              storage_id: "storage-1",
              title: "Track A",
              artist: "Artist",
              stream_url: "/api/tracks/by-storage/storage-1/stream",
              download_url: "/api/tracks/by-storage/storage-1/download",
            },
            {
              storage_id: "storage-2",
              title: "Track B",
              artist: "Artist",
              stream_url: "/api/tracks/by-storage/storage-2/stream",
              download_url: "/api/tracks/by-storage/storage-2/download",
            },
          ],
        },
      },
    });

    expect(summary).toEqual({
      itemCount: 2,
      readyItemCount: 1,
      errorItemCount: 1,
      trackCount: 3,
      readyTrackCount: 2,
      totalBytes: 400,
    });
  });
});
