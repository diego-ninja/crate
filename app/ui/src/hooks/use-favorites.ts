import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

interface StarredData {
  songs: { id: string; title: string; artist: string; album: string }[];
  albums: { id: string; name: string; artist: string }[];
  artists: { id: string; name: string }[];
}

const favoriteSongIds = new Set<string>();
let loaded = false;

export function useFavorites() {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (loaded) return;
    loaded = true;
    api<StarredData>("/api/navidrome/favorites")
      .then((data) => {
        for (const s of data.songs || []) favoriteSongIds.add(s.id);
        setTick((t) => t + 1);
      })
      .catch(() => {});
  }, []);

  const isFavorite = useCallback((navidromeId: string) => favoriteSongIds.has(navidromeId), []);

  const toggleFavorite = useCallback(async (navidromeId: string, type: string = "song") => {
    const isFav = favoriteSongIds.has(navidromeId);
    try {
      if (isFav) {
        await api("/api/navidrome/unstar", "POST", { navidrome_id: navidromeId, type });
        favoriteSongIds.delete(navidromeId);
      } else {
        await api("/api/navidrome/star", "POST", { navidrome_id: navidromeId, type });
        favoriteSongIds.add(navidromeId);
      }
      setTick((t) => t + 1);
    } catch { /* ignore if navidrome offline */ }
  }, []);

  return { isFavorite, toggleFavorite };
}
