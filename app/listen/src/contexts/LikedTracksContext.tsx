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
import { toTrackReferencePayload } from "@/lib/track-reference";

export interface LikedTrack {
  track_id: number;
  track_entity_uid?: string;
  path: string;
  relative_path?: string;
  liked_at: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_entity_uid?: string;
  album_slug?: string;
  duration: number;
}

interface LikedTracksContextValue {
  likedTracks: LikedTrack[];
  loading: boolean;
  isLiked: (
    trackId?: number | null,
    trackEntityUid?: string | null,
    trackPath?: string | null,
  ) => boolean;
  likeTrack: (
    trackId?: number | null,
    trackEntityUid?: string | null,
    trackPath?: string | null,
  ) => Promise<boolean>;
  unlikeTrack: (
    trackId?: number | null,
    trackEntityUid?: string | null,
    trackPath?: string | null,
  ) => Promise<boolean>;
  toggleTrackLike: (
    trackId?: number | null,
    trackEntityUid?: string | null,
    trackPath?: string | null,
  ) => Promise<boolean>;
  refetch: () => Promise<void>;
}

const LikedTracksContext = createContext<LikedTracksContextValue | null>(null);

function getComparableKeys(value?: string | null): string[] {
  if (!value) return [];
  const keys = new Set<string>([value]);
  if (value.startsWith("/music/")) {
    keys.add(value.slice("/music/".length));
  }
  return Array.from(keys);
}

export function LikedTracksProvider({ children }: { children: ReactNode }) {
  const [likedTracks, setLikedTracks] = useState<LikedTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const likedTracksRequestRef = useRef<AbortController | null>(null);

  const refetch = useCallback(async () => {
    likedTracksRequestRef.current?.abort();
    const controller = new AbortController();
    likedTracksRequestRef.current = controller;
    setLoading(true);
    try {
      const tracks = await api<LikedTrack[]>("/api/me/likes?limit=1000", "GET", undefined, {
        signal: controller.signal,
      });
      setLikedTracks(Array.isArray(tracks) ? tracks : []);
    } catch (error) {
      if (controller.signal.aborted || (error as Error).name === "AbortError") {
        return;
      }
      setLikedTracks([]);
    } finally {
      if (likedTracksRequestRef.current === controller) {
        likedTracksRequestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refetch();
    return () => {
      likedTracksRequestRef.current?.abort();
      likedTracksRequestRef.current = null;
    };
  }, [refetch]);

  // Sync with backend when SSE invalidation fires for "likes"
  useEffect(() => {
    return onCacheInvalidation((scope: string) => {
      if (scope === "likes") void refetch();
    });
  }, [refetch]);

  const likedIndex = useMemo(() => {
    const ids = new Set<number>();
    const entityUids = new Set<string>();
    const paths = new Set<string>();
    for (const track of likedTracks) {
      ids.add(track.track_id);
      if (track.track_entity_uid) entityUids.add(track.track_entity_uid);
      for (const key of getComparableKeys(track.path)) paths.add(key);
      for (const key of getComparableKeys(track.relative_path)) paths.add(key);
    }
    return { ids, entityUids, paths };
  }, [likedTracks]);

  const isLiked = useCallback((
    trackId?: number | null,
    trackEntityUid?: string | null,
    trackPath?: string | null,
  ) => {
    if (trackId != null && likedIndex.ids.has(trackId)) return true;
    if (trackEntityUid && likedIndex.entityUids.has(trackEntityUid)) return true;
    for (const key of getComparableKeys(trackPath)) {
      if (likedIndex.paths.has(key)) return true;
    }
    return false;
  }, [likedIndex]);

  const likeTrack = useCallback(async (
    trackId?: number | null,
    trackEntityUid?: string | null,
    trackPath?: string | null,
  ) => {
    if (trackId == null && !trackEntityUid && !trackPath) return false;
    const ref = toTrackReferencePayload({
      id: trackId,
      entity_uid: trackEntityUid,
      path: trackPath,
    });
    await api("/api/me/likes", "POST", {
      track_id: ref.track_id,
      track_entity_uid: ref.entity_uid,
      track_path: ref.path,
    });
    await refetch();
    return true;
  }, [refetch]);

  const unlikeTrack = useCallback(async (
    trackId?: number | null,
    trackEntityUid?: string | null,
    trackPath?: string | null,
  ) => {
    if (trackId == null && !trackEntityUid && !trackPath) return false;
    const ref = toTrackReferencePayload({
      id: trackId,
      entity_uid: trackEntityUid,
      path: trackPath,
    });
    await api("/api/me/likes", "DELETE", {
      track_id: ref.track_id,
      track_entity_uid: ref.entity_uid,
      track_path: ref.path,
    });
    setLikedTracks((prev) =>
      prev.filter((track) => {
        if (trackId != null && track.track_id === trackId) return false;
        if (trackEntityUid && track.track_entity_uid === trackEntityUid) return false;
        const trackKeys = new Set([
          ...getComparableKeys(track.path),
          ...getComparableKeys(track.relative_path),
        ]);
        return !getComparableKeys(trackPath).some((key) => trackKeys.has(key));
      }),
    );
    return true;
  }, []);

  const toggleTrackLike = useCallback(async (
    trackId?: number | null,
    trackEntityUid?: string | null,
    trackPath?: string | null,
  ) => {
    if (trackId == null && !trackEntityUid && !trackPath) return false;
    if (isLiked(trackId, trackEntityUid, trackPath)) {
      return unlikeTrack(trackId, trackEntityUid, trackPath);
    }
    return likeTrack(trackId, trackEntityUid, trackPath);
  }, [isLiked, likeTrack, unlikeTrack]);

  const value = useMemo<LikedTracksContextValue>(() => ({
    likedTracks,
    loading,
    isLiked,
    likeTrack,
    unlikeTrack,
    toggleTrackLike,
    refetch,
  }), [likedTracks, loading, isLiked, likeTrack, unlikeTrack, toggleTrackLike, refetch]);

  return (
    <LikedTracksContext.Provider value={value}>
      {children}
    </LikedTracksContext.Provider>
  );
}

export function useLikedTracks() {
  const ctx = useContext(LikedTracksContext);
  if (!ctx) throw new Error("useLikedTracks must be used within LikedTracksProvider");
  return ctx;
}
