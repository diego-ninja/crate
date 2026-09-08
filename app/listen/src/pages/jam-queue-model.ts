import type { Track } from "@/contexts/PlayerContext";
import { albumCoverAssetPath } from "@/lib/library-routes";
import {
  hasPlayableTrackReference,
  toPlayableTrack,
} from "@/lib/playable-track";
import type { JamEvent, JamQueueItem, JamTrackRequest } from "./jam-types";

export function reorderTracks<T>(
  tracks: T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= tracks.length ||
    toIndex >= tracks.length
  ) {
    return tracks;
  }
  const next = [...tracks];
  const [item] = next.splice(fromIndex, 1);
  if (!item) return tracks;
  next.splice(toIndex, 0, item);
  return next;
}

export function deriveSharedQueue(events: JamEvent[]): Track[] {
  let queue: Track[] = [];
  for (const event of events) {
    const payload = (event.payload_json || {}) as Record<string, unknown>;
    if (event.event_type === "queue_add") {
      const track = payloadToTrack(
        payload.track as Record<string, unknown> | undefined,
      );
      if (track) queue = [...queue, track];
    } else if (
      event.event_type === "queue_remove" &&
      typeof payload.index === "number"
    ) {
      queue = queue.filter((_, index) => index !== payload.index);
    } else if (
      event.event_type === "queue_reorder" &&
      typeof payload.fromIndex === "number" &&
      typeof payload.toIndex === "number"
    ) {
      queue = reorderTracks(queue, payload.fromIndex, payload.toIndex);
    }
  }
  return queue;
}

export function deriveLegacyQueueItems(events: JamEvent[]): JamQueueItem[] {
  return deriveSharedQueue(events).map((track, index) => ({
    id: `legacy-${index}`,
    track,
    vote_count: 0,
    voted_by_me: false,
    position: index,
  }));
}

export function normalizeQueueItems(items: JamQueueItem[]): JamQueueItem[] {
  return items.flatMap((item) => {
    const track = normalizeQueueTrack(item.track);
    return track ? [{ ...item, track }] : [];
  });
}

export function normalizeTrackRequests(
  requests: JamTrackRequest[],
): JamTrackRequest[] {
  return requests.flatMap((request) => {
    const track = normalizeQueueTrack(request.track);
    return track ? [{ ...request, track }] : [];
  });
}

function normalizeQueueTrack(track: Track): Track | null {
  const payload = track as unknown as Record<string, unknown>;
  const normalized = payloadToTrack(payload);
  if (!normalized) return null;
  const hasGlobalTrackUid = Boolean(
    payload.globalTrackUid ?? payload.global_track_uid,
  );
  if (!hasGlobalTrackUid && typeof payload.id === "string") {
    return { ...normalized, id: payload.id };
  }
  return normalized;
}

export function sortQueueItemsForVotes(items: JamQueueItem[]): JamQueueItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftPlaying = left.item.status === "playing" ? 0 : 1;
      const rightPlaying = right.item.status === "playing" ? 0 : 1;
      if (leftPlaying !== rightPlaying) return leftPlaying - rightPlaying;

      const voteDifference = right.item.vote_count - left.item.vote_count;
      if (voteDifference !== 0) return voteDifference;

      const leftPosition = left.item.position ?? left.index;
      const rightPosition = right.item.position ?? right.index;
      return leftPosition - rightPosition || left.index - right.index;
    })
    .map(({ item }) => item);
}

function inferAlbumIdentityFromCover(cover: string | null | undefined) {
  if (!cover) return {};
  const globalMatch = cover.match(
    /\/api\/catalog\/albums\/([^/?#]+)\/cover(?:[/?#]|$)/,
  );
  if (globalMatch?.[1]) {
    return { globalAlbumUid: decodeURIComponent(globalMatch[1]) };
  }
  const entityMatch = cover.match(
    /\/api\/albums\/by-entity\/([^/?#]+)\/cover(?:[/?#]|$)/,
  );
  if (entityMatch?.[1]) {
    return { albumEntityUid: decodeURIComponent(entityMatch[1]) };
  }
  const idMatch = cover.match(/\/api\/albums\/(\d+)\/cover(?:[/?#]|$)/);
  if (idMatch?.[1]) return { albumId: Number(idMatch[1]) };
  return {};
}

export function payloadToTrack(
  payload: Record<string, unknown> | null | undefined,
): Track | null {
  if (!payload) return null;
  const input = {
    ...payload,
    artist: typeof payload.artist === "string" ? payload.artist : "",
    title: typeof payload.title === "string" ? payload.title : "Unknown",
  };
  const hasStringOrNumericId =
    (typeof payload.id === "string" && payload.id.trim().length > 0) ||
    (typeof payload.id === "number" && Number.isFinite(payload.id));
  if (!hasStringOrNumericId && !hasPlayableTrackReference(input)) return null;
  const coverIdentity = inferAlbumIdentityFromCover(
    typeof payload.albumCover === "string"
      ? payload.albumCover
      : typeof payload.album_cover === "string"
        ? payload.album_cover
        : undefined,
  );
  const canonicalAlbumCover = albumCoverAssetPath(
    {
      globalAlbumUid:
        typeof payload.globalAlbumUid === "string"
          ? payload.globalAlbumUid
          : typeof payload.global_album_uid === "string"
            ? payload.global_album_uid
            : coverIdentity.globalAlbumUid,
      albumId:
        typeof payload.albumId === "number"
          ? payload.albumId
          : typeof payload.album_id === "number"
            ? payload.album_id
            : coverIdentity.albumId,
      albumEntityUid:
        typeof payload.albumEntityUid === "string"
          ? payload.albumEntityUid
          : typeof payload.album_entity_uid === "string"
            ? payload.album_entity_uid
            : coverIdentity.albumEntityUid,
    },
    { size: 512 },
  );
  return toPlayableTrack(input, {
    cover: canonicalAlbumCover || undefined,
  });
}
