import { useEffect } from "react";

import type { AuthUser } from "@/contexts/auth-context";
import type { HomeDiscoveryPayload } from "@/components/home/home-model";

import {
  collectHomeWarmupAssets,
  collectHomeWarmupPlaylistUrls,
} from "./listen-warmup-assets";
import {
  markWarmupStarted,
  runWarmupPool,
  scheduleWarmup,
  shouldRunWarmup,
  warmApiCache,
  warmImage,
} from "./listen-warmup-runner";

export {
  collectHomeWarmupAssets,
  collectHomeWarmupPlaylistUrls,
} from "./listen-warmup-assets";

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

        const tasks: Array<(signal: AbortSignal) => Promise<void>> = [
          (signal: AbortSignal) =>
            warmApiCache("/api/me", signal).then(() => undefined),
          (signal: AbortSignal) =>
            warmApiCache("/api/me/playlists-page", signal).then(
              () => undefined,
            ),
          (signal: AbortSignal) =>
            warmApiCache("/api/catalog/me/albums", signal).then(
              () => undefined,
            ),
          (signal: AbortSignal) =>
            warmApiCache("/api/catalog/me/follows", signal).then(
              () => undefined,
            ),
          (signal: AbortSignal) =>
            warmApiCache("/api/me/upcoming", signal).then(() => undefined),
        ];

        if (discovery) {
          for (const url of collectHomeWarmupPlaylistUrls(discovery)) {
            const warmUrl = url;
            tasks.push((signal) =>
              warmApiCache(warmUrl, signal).then(() => undefined),
            );
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
