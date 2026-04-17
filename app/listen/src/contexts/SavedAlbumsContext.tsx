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
  id: number;
  artist: string;
  name: string;
  year: string;
  has_cover: boolean;
  track_count: number;
  total_duration: number;
}

interface SavedAlbumsContextValue {
  savedAlbums: SavedAlbum[];
  loading: boolean;
  isSaved: (albumId?: number | null) => boolean;
  saveAlbum: (albumId?: number | null) => Promise<boolean>;
  unsaveAlbum: (albumId?: number | null) => Promise<boolean>;
  toggleAlbumSaved: (albumId?: number | null) => Promise<boolean>;
  refetch: () => Promise<void>;
}

const SavedAlbumsContext = createContext<SavedAlbumsContextValue | null>(null);

export function SavedAlbumsProvider({ children }: { children: ReactNode }) {
  const [savedAlbums, setSavedAlbums] = useState<SavedAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const savedAlbumsRequestRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    savedAlbumsRequestRef.current?.abort();
    const controller = new AbortController();
    savedAlbumsRequestRef.current = controller;
    setLoading(true);
    try {
      const albums = await api<SavedAlbum[]>("/api/me/albums", "GET", undefined, {
        signal: controller.signal,
      });
      setSavedAlbums(Array.isArray(albums) ? albums : []);
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === "AbortError") {
        return;
      }
      setSavedAlbums([]);
    } finally {
      if (savedAlbumsRequestRef.current === controller) {
        savedAlbumsRequestRef.current = null;
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

  const savedIds = useMemo(() => new Set(savedAlbums.map((album) => album.id)), [savedAlbums]);

  const isSaved = useCallback((albumId?: number | null) => {
    if (albumId == null) return false;
    return savedIds.has(albumId);
  }, [savedIds]);

  const saveAlbum = useCallback(async (albumId?: number | null) => {
    if (albumId == null) return false;
    await api("/api/me/albums", "POST", { album_id: albumId });
    await refetch();
    return true;
  }, [refetch]);

  const unsaveAlbum = useCallback(async (albumId?: number | null) => {
    if (albumId == null) return false;
    await api(`/api/me/albums/${albumId}`, "DELETE");
    setSavedAlbums((prev) => prev.filter((album) => album.id !== albumId));
    return true;
  }, []);

  const toggleAlbumSaved = useCallback(async (albumId?: number | null) => {
    if (albumId == null) return false;
    if (savedIds.has(albumId)) {
      return unsaveAlbum(albumId);
    }
    return saveAlbum(albumId);
  }, [saveAlbum, savedIds, unsaveAlbum]);

  const value = useMemo<SavedAlbumsContextValue>(() => ({
    savedAlbums,
    loading,
    isSaved,
    saveAlbum,
    unsaveAlbum,
    toggleAlbumSaved,
    refetch,
  }), [savedAlbums, loading, isSaved, saveAlbum, unsaveAlbum, toggleAlbumSaved, refetch]);

  return (
    <SavedAlbumsContext.Provider value={value}>
      {children}
    </SavedAlbumsContext.Provider>
  );
}

export function useSavedAlbums() {
  const ctx = useContext(SavedAlbumsContext);
  if (!ctx) throw new Error("useSavedAlbums must be used within SavedAlbumsProvider");
  return ctx;
}
