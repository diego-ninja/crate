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

interface FollowedArtist {
  artist_name: string;
  artist_id?: number;
  artist_slug?: string;
  created_at: string;
}

interface ArtistFollowsContextValue {
  followedArtists: FollowedArtist[];
  loading: boolean;
  isFollowing: (artistId?: number | null) => boolean;
  followArtist: (artistId?: number | null) => Promise<boolean>;
  unfollowArtist: (artistId?: number | null) => Promise<boolean>;
  toggleArtistFollow: (artistId?: number | null) => Promise<boolean>;
  refetch: () => Promise<void>;
}

const ArtistFollowsContext = createContext<ArtistFollowsContextValue | null>(null);

export function ArtistFollowsProvider({ children }: { children: ReactNode }) {
  const [followedArtists, setFollowedArtists] = useState<FollowedArtist[]>([]);
  const [loading, setLoading] = useState(true);
  const requestRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);

    try {
      const artists = await api<FollowedArtist[]>("/api/me/follows", "GET", undefined, {
        signal: controller.signal,
      });
      setFollowedArtists(Array.isArray(artists) ? artists : []);
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === "AbortError") {
        return;
      }
      setFollowedArtists([]);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refetch();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [refetch]);

  const followedIds = useMemo(
    () => new Set(followedArtists.flatMap((artist) => (artist.artist_id != null ? [artist.artist_id] : []))),
    [followedArtists],
  );

  const isFollowing = useCallback((artistId?: number | null) => {
    if (artistId == null) return false;
    return followedIds.has(artistId);
  }, [followedIds]);

  const followArtist = useCallback(async (artistId?: number | null) => {
    if (artistId == null) return false;
    // Optimistic: stamp the follow locally before the request resolves. If the
    // request fails we roll back. Avoids the global loading flash from refetch().
    const placeholder: FollowedArtist = {
      artist_id: artistId,
      artist_name: "",
      created_at: new Date().toISOString(),
    };
    setFollowedArtists((prev) => {
      if (prev.some((artist) => artist.artist_id === artistId)) return prev;
      return [placeholder, ...prev];
    });
    try {
      await api(`/api/me/follows/artists/${artistId}`, "POST");
      return true;
    } catch (error) {
      setFollowedArtists((prev) => prev.filter((artist) => artist.artist_id !== artistId));
      throw error;
    }
  }, []);

  const unfollowArtist = useCallback(async (artistId?: number | null) => {
    if (artistId == null) return false;
    const previous = followedArtists;
    setFollowedArtists((prev) => prev.filter((artist) => artist.artist_id !== artistId));
    try {
      await api(`/api/me/follows/artists/${artistId}`, "DELETE");
      return true;
    } catch (error) {
      setFollowedArtists(previous);
      throw error;
    }
  }, [followedArtists]);

  const toggleArtistFollow = useCallback(async (artistId?: number | null) => {
    if (artistId == null) return false;
    if (followedIds.has(artistId)) {
      return unfollowArtist(artistId);
    }
    return followArtist(artistId);
  }, [followArtist, followedIds, unfollowArtist]);

  const value = useMemo<ArtistFollowsContextValue>(() => ({
    followedArtists,
    loading,
    isFollowing,
    followArtist,
    unfollowArtist,
    toggleArtistFollow,
    refetch,
  }), [followArtist, followedArtists, isFollowing, loading, refetch, toggleArtistFollow, unfollowArtist]);

  return (
    <ArtistFollowsContext.Provider value={value}>
      {children}
    </ArtistFollowsContext.Provider>
  );
}

export function useArtistFollows() {
  const ctx = useContext(ArtistFollowsContext);
  if (!ctx) throw new Error("useArtistFollows must be used within ArtistFollowsProvider");
  return ctx;
}
