import type { TFunction } from "i18next";

import type { AuthUser } from "@/contexts/auth-context";
import type { Track } from "@/contexts/PlayerContext";
import { tracksMatch as playerTracksMatch } from "@/contexts/player-session";
import type { JamQueueItem, JamQueueMode, JamRoom } from "@/pages/jam-reducer";
import { payloadToTrack } from "@/pages/jam-reducer";

export interface JamRoomViewModel {
  isHost: boolean;
  myRole: "host" | "collab" | null;
  roomIsActive: boolean;
  queueMode: JamQueueMode;
  canManageQueue: boolean;
  canAddToQueue: boolean;
  canSuggestTrack: boolean;
  canEditQueue: boolean;
  roomCurrentTrack: Track | null;
  roomNowPlaying: Track | null | undefined;
  currentTrackAlreadyQueued: boolean;
  autoDjSuggestions: Track[];
  queuePrimaryActionLabel: string;
}

export function deriveJamRoomViewModel({
  room,
  user,
  currentTrack,
  queueItems,
  t,
}: {
  room: JamRoom | null;
  user: AuthUser | null;
  currentTrack: Track | undefined;
  queueItems: JamQueueItem[];
  t: TFunction;
}): JamRoomViewModel {
  const isHost = Boolean(room && user && room.host_user_id === user.id);
  const myRole =
    room && user
      ? room.members.find((member) => member.user_id === user.id)?.role || null
      : null;
  const roomIsActive = room?.status === "active";
  const queueMode: JamQueueMode = room?.queue_mode || "manual";
  const canManageQueue = roomIsActive && myRole === "host";
  const canAddToQueue =
    roomIsActive &&
    (myRole === "host" || (queueMode === "auto" && myRole === "collab"));
  const canSuggestTrack =
    roomIsActive && (myRole === "host" || myRole === "collab");
  const canEditQueue = canAddToQueue || canSuggestTrack;
  const roomCurrentTrack = payloadToTrack(
    room?.current_track_payload?.track as Record<string, unknown> | undefined,
  );
  const roomNowPlaying = roomCurrentTrack || currentTrack;
  const currentTrackAlreadyQueued = Boolean(
    currentTrack &&
      queueItems.some((item) => playerTracksMatch(item.track, currentTrack)),
  );
  const autoDjSuggestions = (room?.auto_dj_suggestions || [])
    .map((suggestion) => payloadToTrack(suggestion))
    .filter((suggestion): suggestion is Track => suggestion !== null);

  return {
    isHost,
    myRole,
    roomIsActive,
    queueMode,
    canManageQueue,
    canAddToQueue,
    canSuggestTrack,
    canEditQueue,
    roomCurrentTrack,
    roomNowPlaying,
    currentTrackAlreadyQueued,
    autoDjSuggestions,
    queuePrimaryActionLabel: t(
      isHost || canAddToQueue
        ? "jam.room.actions.addCurrentTrack"
        : "jam.room.suggestTrack",
    ),
  };
}
