import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api } from "@/lib/api";

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

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const albums = await api<SavedAlbum[]>("/api/me/albums");
      setSavedAlbums(Array.isArray(albums) ? albums : []);
    } catch {
      setSavedAlbums([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
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
