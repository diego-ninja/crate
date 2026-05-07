import { useEffect } from "react";

import type { AuthUser } from "@/contexts/auth-context";
import type { HomeDiscoveryPayload, HomeGeneratedPlaylistSummary } from "@/components/home/home-model";
import { api, getApiBase } from "@/lib/api";
import { cacheSet } from "@/lib/cache";
import { setImageFetchPriority } from "@/lib/image-loading";
import {
  albumCoverApiUrl,
  artistBackgroundApiUrl,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

const WARMUP_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const WARMUP_CONCURRENCY = 2;
const WARMUP_STORAGE_PREFIX = "listen-warmup";

type WarmupTask = (signal: AbortSignal) => Promise<void>;
type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function scheduleWarmup(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const idleWindow = window as IdleWindow;
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 4_000 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(callback, 1_500);
  return () => window.clearTimeout(handle);
}

function warmupStorageKey(user: AuthUser): string {
  const origin = getApiBase() || window.location.origin || "listen";
  return `${WARMUP_STORAGE_PREFIX}:${origin}:${user.id}`;
}

function shouldRunWarmup(user: AuthUser): boolean {
  if (typeof window === "undefined") return false;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) return false;
  try {
    const lastRun = Number(localStorage.getItem(warmupStorageKey(user)) || 0);
    return !Number.isFinite(lastRun) || Date.now() - lastRun > WARMUP_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markWarmupStarted(user: AuthUser): void {
  try {
    localStorage.setItem(warmupStorageKey(user), String(Date.now()));
  } catch {
    // ignore persistence failures
  }
}

async function warmApiCache<T>(url: string, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return null;
  try {
    const data = await api<T>(url, "GET", undefined, { signal });
    if (!signal.aborted) cacheSet(url, data);
    return data;
  } catch {
    return null;
  }
}

async function runWarmupPool(tasks: WarmupTask[], signal: AbortSignal): Promise<void> {
  let index = 0;
  const workerCount = Math.min(warmupConcurrency(), tasks.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!signal.aborted) {
        const task = tasks[index++];
        if (!task) return;
        await task(signal);
      }
    }),
  );
}

function warmupConcurrency(): number {
  if (typeof window === "undefined") return WARMUP_CONCURRENCY;
  const navigatorWithConnection = navigator as Navigator & {
    connection?: { saveData?: boolean };
  };
  if (navigatorWithConnection.connection?.saveData) return 1;
  if (window.matchMedia?.("(max-width: 767px)").matches) return 1;
  return WARMUP_CONCURRENCY;
}

function addAsset(target: string[], url: string | null | undefined, limit = 24): void {
  if (!url || target.includes(url) || target.length >= limit) return;
  target.push(url);
}

function playlistArtworkAssets(item: HomeGeneratedPlaylistSummary): string[] {
  const urls: string[] = [];
  for (const track of item.artwork_tracks || []) {
    addAsset(urls, albumCoverApiUrl({
      albumId: track.album_id,
      albumEntityUid: track.album_entity_uid,
      artistEntityUid: track.artist_entity_uid,
      albumSlug: track.album_slug,
      artistName: track.artist,
      albumName: track.album,
    }, { size: 192 }), 4);
  }
  return urls;
}

export function collectHomeWarmupAssets(discovery: HomeDiscoveryPayload): string[] {
  const urls: string[] = [];
  const heroes = Array.isArray(discovery.hero)
    ? discovery.hero
    : discovery.hero
      ? [discovery.hero]
      : [];

  for (const hero of heroes.slice(0, 3)) {
    addAsset(urls, artistBackgroundApiUrl({
      artistId: hero.id,
      artistSlug: hero.slug,
      artistName: hero.name,
    }, { size: 1280 }));
  }

  for (const item of (discovery.recently_played || []).slice(0, 9)) {
    if (item.type === "artist") {
      addAsset(urls, artistPhotoApiUrl({
        artistId: item.artist_id,
        artistEntityUid: item.artist_entity_uid,
        artistSlug: item.artist_slug,
        artistName: item.artist_name,
      }, { size: 192 }));
    } else if (item.type === "album") {
      addAsset(urls, albumCoverApiUrl({
        albumId: item.album_id,
        albumEntityUid: item.album_entity_uid,
        artistEntityUid: item.artist_entity_uid,
        albumSlug: item.album_slug,
        artistName: item.artist_name,
        albumName: item.album_name,
      }, { size: 192 }));
    }
  }

  for (const album of (discovery.suggested_albums || []).slice(0, 8)) {
    addAsset(urls, albumCoverApiUrl({
      albumId: album.album_id,
      albumEntityUid: album.album_entity_uid,
      artistEntityUid: album.artist_entity_uid,
      albumSlug: album.album_slug,
      artistName: album.artist_name,
      albumName: album.album_name,
    }, { size: 256 }));
  }

  for (const station of (discovery.radio_stations || []).slice(0, 6)) {
    if (station.type === "album") {
      addAsset(urls, albumCoverApiUrl({
        albumId: station.album_id,
        albumEntityUid: station.album_entity_uid,
        artistEntityUid: station.artist_entity_uid,
        albumSlug: station.album_slug,
        artistName: station.artist_name,
        albumName: station.album_name,
      }, { size: 256 }));
    } else {
      addAsset(urls, artistPhotoApiUrl({
        artistId: station.artist_id,
        artistEntityUid: station.artist_entity_uid,
        artistSlug: station.artist_slug,
        artistName: station.artist_name,
      }, { size: 256 }));
    }
  }

  for (const artist of (discovery.favorite_artists || []).slice(0, 8)) {
    addAsset(urls, artistPhotoApiUrl({
      artistId: artist.artist_id,
      artistEntityUid: artist.artist_entity_uid,
      artistSlug: artist.artist_slug,
      artistName: artist.artist_name,
    }, { size: 192 }));
  }

  for (const playlist of [
    ...(discovery.custom_mixes || []).slice(0, 4),
    ...(discovery.essentials || []).slice(0, 4),
  ]) {
    for (const url of playlistArtworkAssets(playlist)) {
      addAsset(urls, url);
    }
  }

  return urls;
}

export function collectHomeWarmupPlaylistUrls(discovery: HomeDiscoveryPayload): string[] {
  const ids = new Set<string>();
  for (const playlist of [
    ...(discovery.custom_mixes || []).slice(0, 4),
    ...(discovery.essentials || []).slice(0, 4),
  ]) {
    if (playlist.id) ids.add(playlist.id);
  }
  return Array.from(ids).map((id) => `/api/me/home/playlists/${encodeURIComponent(id)}`);
}

function warmImage(url: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted || typeof Image === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    setImageFetchPriority(img, "low");
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

export function useListenWarmup(user: AuthUser | null): void {
  useEffect(() => {
    if (!user || !shouldRunWarmup(user)) return;

    const controller = new AbortController();
    const cancelSchedule = scheduleWarmup(() => {
      if (controller.signal.aborted) return;
      markWarmupStarted(user);
      void (async () => {
        const discovery = await warmApiCache<HomeDiscoveryPayload>(
          "/api/me/home/discovery",
          controller.signal,
        );
        if (controller.signal.aborted) return;

        const tasks: WarmupTask[] = [
          (signal) => warmApiCache("/api/me", signal).then(() => undefined),
          (signal) => warmApiCache("/api/me/playlists-page", signal).then(() => undefined),
          (signal) => warmApiCache("/api/me/albums", signal).then(() => undefined),
          (signal) => warmApiCache("/api/me/follows", signal).then(() => undefined),
          (signal) => warmApiCache("/api/me/upcoming", signal).then(() => undefined),
        ];

        if (discovery) {
          for (const url of collectHomeWarmupPlaylistUrls(discovery)) {
            const warmUrl = url;
            tasks.push((signal) => warmApiCache(warmUrl, signal).then(() => undefined));
          }
          for (const assetUrl of collectHomeWarmupAssets(discovery)) {
            const warmUrl = assetUrl;
            tasks.push((signal) => warmImage(warmUrl, signal));
          }
        }

        await runWarmupPool(tasks, controller.signal);
      })();
    });

    return () => {
      cancelSchedule();
      controller.abort();
    };
  }, [user]);
}
