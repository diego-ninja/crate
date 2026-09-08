import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api } from "@/lib/api";
import { onCacheInvalidation } from "@/lib/cache";

export interface SavedAlbum {
  saved_at: string;
  id?: number | null;
  global_album_uid?: string;
  artist: string;
  name: string;
  year: string;
  has_cover: boolean;
  track_count: number;
  total_duration: number;
}

type SavedAlbumMutation = "saved" | "unsaved";

function albumReferenceKeys(
  albumId?: number | null,
  globalAlbumUid?: string | null,
): string[] {
  return [
    ...(globalAlbumUid ? [`global:${globalAlbumUid}`] : []),
    ...(albumId != null ? [`local:${albumId}`] : []),
  ];
}

function savedAlbumReferenceKeys(album: SavedAlbum): string[] {
  return albumReferenceKeys(album.id, album.global_album_uid);
}

function matchesSavedAlbum(
  album: SavedAlbum,
  albumId?: number | null,
  globalAlbumUid?: string | null,
): boolean {
  const requestedKeys = new Set(albumReferenceKeys(albumId, globalAlbumUid));
  return savedAlbumReferenceKeys(album).some((key) => requestedKeys.has(key));
}

interface SavedAlbumsContextValue {
  savedAlbums: SavedAlbum[];
  loading: boolean;
  isSaved: (albumId?: number | null, globalAlbumUid?: string | null) => boolean;
  saveAlbum: (
    albumId?: number | null,
    globalAlbumUid?: string | null,
  ) => Promise<boolean>;
  unsaveAlbum: (
    albumId?: number | null,
    globalAlbumUid?: string | null,
  ) => Promise<boolean>;
  toggleAlbumSaved: (
    albumId?: number | null,
    globalAlbumUid?: string | null,
  ) => Promise<boolean>;
  refetch: () => Promise<void>;
}

const SavedAlbumsContext = createContext<SavedAlbumsContextValue | null>(null);

export function SavedAlbumsProvider({ children }: { children: ReactNode }) {
  const [savedAlbums, setSavedAlbums] = useState<SavedAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [optimisticMutations, setOptimisticMutations] = useState<
    Record<string, SavedAlbumMutation>
  >({});
  const savedAlbumsRequestRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    savedAlbumsRequestRef.current?.abort();
    const controller = new AbortController();
    savedAlbumsRequestRef.current = controller;
    setLoading(true);
    try {
      const albums = await api<SavedAlbum[]>(
        "/api/catalog/me/albums/saved",
        "GET",
        undefined,
        {
          signal: controller.signal,
        },
      );
      if (savedAlbumsRequestRef.current !== controller) return;
      const nextAlbums = Array.isArray(albums) ? albums : [];
      const serverKeys = new Set(
        nextAlbums.flatMap((album) => savedAlbumReferenceKeys(album)),
      );
      setSavedAlbums(nextAlbums);
      setOptimisticMutations((current) => {
        const next = { ...current };
        for (const [key, mutation] of Object.entries(current)) {
          const present = serverKeys.has(key);
          if (
            (mutation === "saved" && present) ||
            (mutation === "unsaved" && !present)
          ) {
            delete next[key];
          }
        }
        return next;
      });
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === "AbortError") {
        return;
      }
    } finally {
      if (savedAlbumsRequestRef.current === controller) {
        savedAlbumsRequestRef.current = null;
        // The identity guard prevents an older request from clearing a newer one.
        // react-doctor-disable-next-line no-loading-flag-reset-outside-finally
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refetch();
    return () => {
      savedAlbumsRequestRef.current?.abort();
      savedAlbumsRequestRef.current = null;
    };
  }, [refetch]);

  // Sync with backend when SSE invalidation fires for "saved_albums"
  useEffect(() => {
    return onCacheInvalidation((scope: string) => {
      if (scope === "saved_albums") void refetch();
    });
  }, [refetch]);

  const savedIds = useMemo(
    () =>
      new Set(
        savedAlbums.flatMap((album) => (album.id != null ? [album.id] : [])),
      ),
    [savedAlbums],
  );
  const savedGlobalUids = useMemo(
    () =>
      new Set(
        savedAlbums.flatMap((album) =>
          album.global_album_uid ? [album.global_album_uid] : [],
        ),
      ),
    [savedAlbums],
  );

  const isSaved = useCallback(
    (albumId?: number | null, globalAlbumUid?: string | null) => {
      const keys = albumReferenceKeys(albumId, globalAlbumUid);
      const preferredKey = keys[0];
      const mutation = preferredKey ? optimisticMutations[preferredKey] : null;
      if (mutation === "saved") return true;
      if (mutation === "unsaved") return false;
      if (globalAlbumUid) return savedGlobalUids.has(globalAlbumUid);
      if (albumId == null) return false;
      return savedIds.has(albumId);
    },
    [optimisticMutations, savedGlobalUids, savedIds],
  );

  const saveAlbum = useCallback(
    async (albumId?: number | null, globalAlbumUid?: string | null) => {
      if (albumId == null && !globalAlbumUid) return false;
      const keys = albumReferenceKeys(albumId, globalAlbumUid);
      setOptimisticMutations((current) => {
        const next = { ...current };
        for (const key of keys) next[key] = "saved";
        return next;
      });
      try {
        if (globalAlbumUid) {
          await api(
            `/api/catalog/me/albums/${encodeURIComponent(globalAlbumUid)}/save`,
            "POST",
          );
        } else {
          await api("/api/me/albums", "POST", { album_id: albumId });
        }
        await refetch();
        return true;
      } catch (error) {
        setOptimisticMutations((current) => {
          const next = { ...current };
          for (const key of keys) {
            if (next[key] === "saved") delete next[key];
          }
          return next;
        });
        throw error;
      }
    },
    [refetch],
  );

  const unsaveAlbum = useCallback(
    async (albumId?: number | null, globalAlbumUid?: string | null) => {
      if (albumId == null && !globalAlbumUid) return false;
      const keys = albumReferenceKeys(albumId, globalAlbumUid);
      setOptimisticMutations((current) => {
        const next = { ...current };
        for (const key of keys) next[key] = "unsaved";
        return next;
      });
      try {
        if (globalAlbumUid) {
          await api(
            `/api/catalog/me/albums/${encodeURIComponent(globalAlbumUid)}/save`,
            "DELETE",
          );
        } else {
          await api(`/api/me/albums/${albumId}`, "DELETE");
        }
      } catch (error) {
        setOptimisticMutations((current) => {
          const next = { ...current };
          for (const key of keys) {
            if (next[key] === "unsaved") delete next[key];
          }
          return next;
        });
        throw error;
      }
      setSavedAlbums((prev) =>
        prev.filter(
          (album) => !matchesSavedAlbum(album, albumId, globalAlbumUid),
        ),
      );
      return true;
    },
    [],
  );

  const toggleAlbumSaved = useCallback(
    async (albumId?: number | null, globalAlbumUid?: string | null) => {
      if (albumId == null && !globalAlbumUid) return false;
      if (isSaved(albumId, globalAlbumUid)) {
        return unsaveAlbum(albumId, globalAlbumUid);
      }
      return saveAlbum(albumId, globalAlbumUid);
    },
    [isSaved, saveAlbum, unsaveAlbum],
  );

  const value = useMemo<SavedAlbumsContextValue>(
    () => ({
      savedAlbums,
      loading,
      isSaved,
      saveAlbum,
      unsaveAlbum,
      toggleAlbumSaved,
      refetch,
    }),
    [
      savedAlbums,
      loading,
      isSaved,
      saveAlbum,
      unsaveAlbum,
      toggleAlbumSaved,
      refetch,
    ],
  );

  return (
    <SavedAlbumsContext.Provider value={value}>
      {children}
    </SavedAlbumsContext.Provider>
  );
}

export function useSavedAlbums() {
  const ctx = useContext(SavedAlbumsContext);
  if (!ctx)
    throw new Error("useSavedAlbums must be used within SavedAlbumsProvider");
  return ctx;
}
