import type { TFunction } from "i18next";

import type { Track } from "@/contexts/player-types";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import {
  payloadToTrack,
  type JamEvent,
  type JamMember,
  type SearchTrack,
} from "@/pages/jam-reducer";

export function trackToPayload(track: Track) {
  return {
    id: track.id,
    globalTrackUid: track.globalTrackUid,
    globalArtistUid: track.globalArtistUid,
    globalAlbumUid: track.globalAlbumUid,
    entityUid: track.entityUid,
    title: track.title,
    artist: track.artist,
    artistId: track.artistId,
    artistEntityUid: track.artistEntityUid,
    artistSlug: track.artistSlug,
    album: track.album,
    albumId: track.albumId,
    albumEntityUid: track.albumEntityUid,
    albumSlug: track.albumSlug,
    duration: track.duration,
    path: track.path,
    libraryTrackId: track.libraryTrackId,
  };
}

export function trackIdentity(track: Track) {
  return (
    track.globalTrackUid ||
    track.entityUid ||
    (track.libraryTrackId != null ? `library:${track.libraryTrackId}` : null) ||
    track.id ||
    track.path ||
    "unknown"
  );
}

export function searchTrackToTrack(track: SearchTrack): Track {
  const globalTrackUid =
    track.globalTrackUid ?? track.global_track_uid ?? track.global_uid;
  const globalAlbumUid =
    track.globalAlbumUid ?? track.global_album_uid ?? track.album_entity_uid;
  return toPlayableTrack(
    {
      ...track,
      globalTrackUid,
      globalAlbumUid,
      library_track_id:
        !globalTrackUid && typeof track.id === "number" ? track.id : undefined,
    },
    {
      cover: track.album
        ? globalTrackUid && globalAlbumUid
          ? albumCoverApiUrl({ globalAlbumUid }, { size: 512 })
          : albumCoverApiUrl(
              {
                albumId: track.album_id,
                albumEntityUid: track.album_entity_uid,
                artistEntityUid: track.artist_entity_uid,
                albumSlug: track.album_slug,
                artistName: track.artist,
                albumName: track.album,
              },
              { size: 512 },
            )
        : undefined,
    },
  );
}

export function parseRoomTags(value: string) {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value.split(/[,\n]/)) {
    const tag = raw.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag.slice(0, 40));
    if (tags.length >= 12) break;
  }
  return tags;
}

export function formatRoomTagsInput(tags: string[] | undefined | null) {
  return (tags || []).join(", ");
}

export function displayName(person: {
  display_name?: string | null;
  username?: string | null;
  user_id?: number | null;
}) {
  const profileName = person.display_name?.trim();
  const username = person.username?.trim();
  return (
    profileName ||
    username ||
    (person.user_id ? `User ${person.user_id}` : "Someone")
  );
}

export function resolveJamActor(
  event: JamEvent,
  members: JamMember[],
  currentUser?: {
    id: number;
    username?: string | null;
    name?: string | null;
    avatar?: string | null;
  } | null,
) {
  const member =
    event.user_id == null
      ? null
      : members.find((candidate) => candidate.user_id === event.user_id);
  const ownUser =
    currentUser && event.user_id === currentUser.id ? currentUser : null;
  const actor = {
    user_id: event.user_id,
    username: event.username || member?.username || ownUser?.username || null,
    display_name:
      event.display_name || member?.display_name || ownUser?.name || null,
    avatar: event.avatar || member?.avatar || ownUser?.avatar || null,
  };
  return {
    name: displayName(actor),
    avatar: actor.avatar,
    user_id: actor.user_id,
  };
}

export function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] || "?").toUpperCase() + (parts[1]?.[0] || "").toUpperCase()
  );
}

export function eventActivityText(
  event: JamEvent,
  actorName: string | undefined,
  t: TFunction,
) {
  const payload = (event.payload_json || {}) as Record<string, unknown>;
  const actor =
    payload.source === "auto_dj" ? "Crate DJ" : actorName || displayName(event);
  const track = payloadToTrack(
    payload.track as Record<string, unknown> | undefined,
  );
  if (event.event_type === "join") return t("jam.activity.join", { actor });
  if (event.event_type === "queue_add")
    return t("jam.activity.queueAdd", {
      actor,
      title: track?.title || t("jam.activity.aTrack"),
    });
  if (event.event_type === "queue_remove")
    return t("jam.activity.queueRemove", { actor });
  if (event.event_type === "queue_reorder")
    return t("jam.activity.queueReorder", { actor });
  if (event.event_type === "play") return t("jam.activity.play", { actor });
  if (event.event_type === "pause") return t("jam.activity.pause", { actor });
  if (event.event_type === "seek") return t("jam.activity.seek", { actor });
  if (event.event_type === "room_updated")
    return t("jam.activity.roomUpdated", { actor });
  if (event.event_type === "room_ended")
    return t("jam.activity.roomEnded", { actor });
  return t("jam.activity.fallback", {
    actor,
    event: event.event_type.replace("_", " "),
  });
}

export function extractInviteToken(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const marker = "/jam/invite/";
  const index = trimmed.indexOf(marker);
  if (index >= 0) {
    return trimmed.slice(index + marker.length).replace(/^\/+/, "");
  }
  return trimmed.replace(/^\/+/, "");
}
