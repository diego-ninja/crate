import type { Track } from "@/contexts/PlayerContext";
import type { PlaySource } from "@/contexts/player-types";
import type { JamQueueItem } from "@/pages/jam-reducer";
import { payloadToTrack } from "@/pages/jam-reducer";

export function isJamPlaybackSource(
  source: PlaySource | null | undefined,
): boolean {
  return source?.type === "queue" && source.name.startsWith("Jam:");
}

export function queueSnapshotTracks(
  queue: JamQueueItem[] | undefined,
): Track[] {
  if (!queue) return [];
  return queue
    .map((item) =>
      payloadToTrack(item.track as unknown as Record<string, unknown>),
    )
    .filter((track): track is Track => track !== null);
}

export function projectJamClockPosition({
  positionMs,
  serverTimeMs,
  clientNowMs,
  clockOffsetMs,
  playing,
}: {
  positionMs: number;
  serverTimeMs?: number;
  clientNowMs: number;
  clockOffsetMs: number;
  playing: boolean;
}): number {
  if (!playing || typeof serverTimeMs !== "number") return positionMs;
  return positionMs + Math.max(0, clientNowMs + clockOffsetMs - serverTimeMs);
}
