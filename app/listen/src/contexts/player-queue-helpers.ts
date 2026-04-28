import type { Track } from "@/contexts/player-types";
import { getStreamUrl } from "@/contexts/player-utils";

const PREV_RESTART_THRESHOLD_SECONDS = 3;

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

export function shouldRestartTrackBeforePrev(params: {
  currentTimeSeconds: number;
  justRestartedCurrentTrack: boolean;
}): boolean {
  return params.currentTimeSeconds > PREV_RESTART_THRESHOLD_SECONDS && !params.justRestartedCurrentTrack;
}

export function shuffleKeepingCurrent<T>(queue: T[], pinnedIndex: number): T[] {
  const pinned = queue[pinnedIndex];
  const others = queue.filter((_, index) => index !== pinnedIndex);
  for (let index = others.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [others[index], others[randomIndex]] = [others[randomIndex]!, others[index]!];
  }
  return pinned ? [pinned, ...others] : others;
}

export function resolveQueueFromUrls(
  urls: string[],
  sourceQueue: Track[],
  engineTrackMap: Map<string, Track[]>,
): Track[] {
  if (!urls.length) return sourceQueue;

  const buckets = new Map<string, Track[]>();
  for (const [url, tracks] of engineTrackMap) {
    buckets.set(url, tracks.slice());
  }

  const resolved: Track[] = [];
  for (const url of urls) {
    const bucket = buckets.get(url);
    if (bucket?.length) {
      resolved.push(bucket.shift()!);
      continue;
    }
    const fallback = sourceQueue.find((track) => getStreamUrl(track) === url);
    if (fallback) resolved.push(fallback);
  }

  return resolved.length > 0 ? resolved : sourceQueue;
}
