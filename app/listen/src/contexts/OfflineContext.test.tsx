import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  clearOfflineAssetsMock,
  hydrateOfflineProfileStateMock,
  isOfflineSupportedMock,
  saveOfflineSnapshotMock,
  setActiveOfflineProfileKeyMock,
  syncOfflineProfileToServiceWorkerMock,
} = vi.hoisted(() => ({
  clearOfflineAssetsMock: vi.fn(async () => {}),
  hydrateOfflineProfileStateMock: vi.fn(async () => ({
    items: {
      "track:storage-1": {
        key: "track:storage-1",
        kind: "track",
        entityId: "storage-1",
        title: "Track One",
        state: "ready",
        trackCount: 1,
        readyTrackCount: 1,
        totalBytes: 1234,
        readyStorageIds: ["storage-1"],
        tracks: [{
          storage_id: "storage-1",
          title: "Track One",
          artist: "Artist",
          stream_url: "/api/tracks/by-storage/storage-1/stream",
          download_url: "/api/tracks/by-storage/storage-1/download",
        }],
      },
    },
  })),
  isOfflineSupportedMock: vi.fn(() => true),
  saveOfflineSnapshotMock: vi.fn(),
  setActiveOfflineProfileKeyMock: vi.fn(),
  syncOfflineProfileToServiceWorkerMock: vi.fn(),
}));

vi.mock("@/lib/offline", () => ({
  buildAssetUsage: vi.fn(() => new Map()),
  cacheTrackAsset: vi.fn(async () => {}),
  clearOfflineAssets: clearOfflineAssetsMock,
  deleteCachedTrackAsset: vi.fn(async () => {}),
  deriveOfflineProfileKey: vi.fn(() => "profile-1"),
  ensureOfflineStorageBudget: vi.fn(async () => {}),
  getOfflineItemKey: (kind: string, entityId: string | number) => `${kind}:${entityId}`,
  hasCachedTrackAsset: vi.fn(async () => false),
  hydrateOfflineProfileState: hydrateOfflineProfileStateMock,
  isOfflineBusy: (state: string) => ["queued", "downloading", "syncing"].includes(state),
  isOfflineSupported: isOfflineSupportedMock,
  saveOfflineSnapshot: saveOfflineSnapshotMock,
  setActiveOfflineProfileKey: setActiveOfflineProfileKeyMock,
  summarizeOfflineSnapshot: vi.fn((snapshot) => ({
    itemCount: Object.keys(snapshot.items).length,
    readyItemCount: 1,
    errorItemCount: 0,
    trackCount: 1,
    readyTrackCount: 1,
    totalBytes: 1234,
  })),
  syncOfflineProfileToServiceWorker: syncOfflineProfileToServiceWorkerMock,
}));

import { AuthContext, type AuthContextValue } from "@/contexts/auth-context";
import { OfflineProvider, useOffline } from "@/contexts/OfflineContext";

function createAuthValue(
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return {
    user: {
      id: 7,
      email: "listener@example.test",
      name: "Listener",
      role: "user",
    },
    loading: false,
    refetch: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    ...overrides,
  };
}

function OfflineProbe() {
  const offline = useOffline();
  return (
    <div>
      <div>{offline.summary.itemCount}</div>
      <div>{offline.getTrackState("storage-1")}</div>
      <button onClick={() => void offline.clearActiveProfile()}>clear</button>
    </div>
  );
}

describe("OfflineProvider", () => {
  beforeEach(() => {
    clearOfflineAssetsMock.mockClear();
    hydrateOfflineProfileStateMock.mockClear();
    isOfflineSupportedMock.mockClear();
    saveOfflineSnapshotMock.mockClear();
    setActiveOfflineProfileKeyMock.mockClear();
    syncOfflineProfileToServiceWorkerMock.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("hydrates the active profile and exposes ready offline state", async () => {
    render(
      <AuthContext.Provider value={createAuthValue()}>
        <OfflineProvider>
          <OfflineProbe />
        </OfflineProvider>
      </AuthContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText("1")).toBeTruthy();
    });
    expect(screen.getByText("ready")).toBeTruthy();
    expect(setActiveOfflineProfileKeyMock).toHaveBeenCalledWith("profile-1");
    expect(syncOfflineProfileToServiceWorkerMock).toHaveBeenCalledWith("profile-1");
  });

  it("clears assets for the active profile when asked", async () => {
    render(
      <AuthContext.Provider value={createAuthValue()}>
        <OfflineProvider>
          <OfflineProbe />
        </OfflineProvider>
      </AuthContext.Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText("ready")).toBeTruthy();
    });

    screen.getByRole("button", { name: "clear" }).click();

    await waitFor(() => {
      expect(clearOfflineAssetsMock).toHaveBeenCalledWith("profile-1");
    });
  });
});
