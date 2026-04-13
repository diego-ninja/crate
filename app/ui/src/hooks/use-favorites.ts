import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

// Global cache — shared across all hook instances
const favoriteIds = new Set<string>();
let loaded = false;
// Subscribers for re-render
const subscribers = new Set<() => void>();

function notifyAll() {
  for (const fn of subscribers) fn();
}

export function useFavorites() {
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    subscribers.add(rerender);
    return () => { subscribers.delete(rerender); };
  }, [rerender]);

  useEffect(() => {
    if (loaded) return;
    loaded = true;
    // Load from local favorites DB
    api<{ items: { item_id: string }[] }>("/api/favorites")
      .then((data) => {
        for (const f of data.items || []) favoriteIds.add(f.item_id);
        notifyAll();
      })
      .catch(() => {});
  }, []);

  const isFavorite = useCallback((id: string) => favoriteIds.has(id), []);

  const toggleFavorite = useCallback(async (id: string, type: string = "song") => {
    const wasFav = favoriteIds.has(id);
    // Optimistic update
    if (wasFav) favoriteIds.delete(id); else favoriteIds.add(id);
    notifyAll();

    try {
      if (wasFav) {
        await api("/api/favorites/remove", "POST", { item_id: id, type });
      } else {
        await api("/api/favorites/add", "POST", { item_id: id, type });
      }
    } catch {
      // Rollback
      if (wasFav) favoriteIds.add(id); else favoriteIds.delete(id);
      notifyAll();
    }
  }, []);

  return { isFavorite, toggleFavorite };
}
