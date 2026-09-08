import type { Dispatch, MutableRefObject } from "react";
import type { NavigateFunction } from "react-router";
import { toast } from "sonner";

import type { Track } from "@/contexts/PlayerContext";
import {
  isJamPlaybackSource,
  projectJamClockPosition,
  queueSnapshotTracks,
} from "@/hooks/jam-websocket-utils";
import type { JamPlayerActionsRef } from "@/hooks/use-jam-websocket-sync";
import type {
  JamEvent,
  JamMember,
  JamQueueItem,
  JamRoom,
  JamSessionAction,
  JamTrackRequest,
} from "@/pages/jam-reducer";
import { payloadToTrack } from "@/pages/jam-reducer";

export type JamWebSocketPayload = {
  type: string;
  room?: JamRoom;
  event?: JamEvent;
  members?: JamMember[];
  queue?: JamQueueItem[];
  requests?: JamTrackRequest[];
  track?: Record<string, unknown>;
  position_ms?: number;
  server_time_ms?: number;
  client_sent_at_ms?: number;
  playing?: boolean;
  force_sync?: boolean;
  detail?: string;
};

export type SyncSeek = (
  track: Record<string, unknown> | null | undefined,
  positionMs: number,
  playing?: boolean,
  forcePosition?: boolean,
) => void;

export interface JamWebSocketMessageHandlerContext {
  dispatch: Dispatch<JamSessionAction>;
  navigate: NavigateFunction;
  userId: number;
  playerActionsRef: MutableRefObject<JamPlayerActionsRef>;
  roomNameRef: MutableRefObject<string>;
  authoritativeQueueRef: MutableRefObject<Track[]>;
  awaitingInitialClockRef: MutableRefObject<boolean>;
  serverClockOffsetMsRef: MutableRefObject<number>;
  hasServerClockOffsetRef: MutableRefObject<boolean>;
  roomRevisionRef: MutableRefObject<number>;
  seenEventIdsRef: MutableRefObject<Set<number>>;
  syncSeek: SyncSeek;
}

type JamWebSocketControlContext = Pick<
  JamWebSocketMessageHandlerContext,
  | "dispatch"
  | "navigate"
  | "playerActionsRef"
  | "roomNameRef"
  | "authoritativeQueueRef"
  | "awaitingInitialClockRef"
  | "serverClockOffsetMsRef"
  | "hasServerClockOffsetRef"
  | "roomRevisionRef"
  | "seenEventIdsRef"
  | "syncSeek"
>;

export function handleJamWebSocketControlMessage(
  payload: JamWebSocketPayload,
  {
    dispatch,
    navigate,
    playerActionsRef,
    roomNameRef,
    authoritativeQueueRef,
    awaitingInitialClockRef,
    serverClockOffsetMsRef,
    hasServerClockOffsetRef,
    roomRevisionRef,
    seenEventIdsRef,
    syncSeek,
  }: JamWebSocketControlContext,
): boolean {
  if (payload.type === "pong") {
    updateServerClockOffset(
      payload,
      serverClockOffsetMsRef,
      hasServerClockOffsetRef,
    );
    return true;
  }

  if (payload.type === "warning") {
    if (payload.detail) toast.info(payload.detail);
    return true;
  }

  if (payload.type === "error") {
    if (payload.detail) toast.error(payload.detail);
    return true;
  }

  if (
    payload.type === "sync_clock" &&
    typeof payload.position_ms === "number"
  ) {
    handleSyncClock(payload, {
      dispatch,
      playerActionsRef,
      roomNameRef,
      authoritativeQueueRef,
      awaitingInitialClockRef,
      serverClockOffsetMsRef,
      syncSeek,
    });
    return true;
  }

  if (payload.type === "state_sync" && payload.room) {
    handleStateSync(payload.room, {
      dispatch,
      playerActionsRef,
      roomNameRef,
      authoritativeQueueRef,
      awaitingInitialClockRef,
      roomRevisionRef,
      seenEventIdsRef,
    });
    return true;
  }

  if (payload.type === "room_ended" && payload.room) {
    dispatch({ type: "ROOM_ENDED", payload: payload.room });
    toast.info("This jam room has ended");
    return true;
  }

  if (payload.type === "room_deleted") {
    dispatch({ type: "ROOM_DELETED" });
    toast.info("This jam room was deleted");
    navigate("/jam", { replace: true });
    return true;
  }

  if (payload.type === "presence") {
    dispatch({
      type: "UPDATE_ROOM_MEMBERS",
      payload: payload.members || [],
    });
    return true;
  }

  return false;
}

function updateServerClockOffset(
  payload: JamWebSocketPayload,
  serverClockOffsetMsRef: MutableRefObject<number>,
  hasServerClockOffsetRef: MutableRefObject<boolean>,
) {
  if (
    typeof payload.server_time_ms !== "number" ||
    typeof payload.client_sent_at_ms !== "number"
  ) {
    return;
  }

  const receivedAtMs = Date.now();
  const roundTripMs = receivedAtMs - payload.client_sent_at_ms;
  if (roundTripMs < 0 || roundTripMs > 5_000) return;

  const sampleOffsetMs =
    payload.server_time_ms - (payload.client_sent_at_ms + roundTripMs / 2);
  serverClockOffsetMsRef.current = hasServerClockOffsetRef.current
    ? serverClockOffsetMsRef.current * 0.8 + sampleOffsetMs * 0.2
    : sampleOffsetMs;
  hasServerClockOffsetRef.current = true;
}

function handleSyncClock(
  payload: JamWebSocketPayload,
  {
    dispatch,
    playerActionsRef,
    roomNameRef,
    authoritativeQueueRef,
    awaitingInitialClockRef,
    serverClockOffsetMsRef,
    syncSeek,
  }: Pick<
    JamWebSocketMessageHandlerContext,
    | "dispatch"
    | "playerActionsRef"
    | "roomNameRef"
    | "authoritativeQueueRef"
    | "awaitingInitialClockRef"
    | "serverClockOffsetMsRef"
    | "syncSeek"
  >,
) {
  const playing = payload.playing !== false;
  const projectedPositionMs = projectJamClockPosition({
    positionMs: payload.position_ms as number,
    serverTimeMs: payload.server_time_ms,
    clientNowMs: Date.now(),
    clockOffsetMs: serverClockOffsetMsRef.current,
    playing,
  });
  const initialTrack = payloadToTrack(payload.track);
  if (awaitingInitialClockRef.current && initialTrack) {
    awaitingInitialClockRef.current = false;
    const authoritativeQueue = authoritativeQueueRef.current;
    playerActionsRef.current.syncJamQueue(
      authoritativeQueue.length > 0 ? authoritativeQueue : [initialTrack],
      {
        currentTrack: initialTrack,
        positionSeconds: projectedPositionMs / 1000,
        playing,
        forcePosition: true,
        source: {
          type: "queue",
          name: `Jam: ${roomNameRef.current}`,
        },
      },
    );
    dispatch({
      type: "SET_SYNC_STATUS",
      payload: playing ? "synced" : "idle",
    });
    return;
  }

  syncSeek(
    payload.track,
    projectedPositionMs,
    playing,
    payload.force_sync === true,
  );
}

function handleStateSync(
  room: JamRoom,
  {
    dispatch,
    playerActionsRef,
    roomNameRef,
    authoritativeQueueRef,
    awaitingInitialClockRef,
    roomRevisionRef,
    seenEventIdsRef,
  }: Pick<
    JamWebSocketMessageHandlerContext,
    | "dispatch"
    | "playerActionsRef"
    | "roomNameRef"
    | "authoritativeQueueRef"
    | "awaitingInitialClockRef"
    | "roomRevisionRef"
    | "seenEventIdsRef"
  >,
) {
  dispatch({ type: "APPLY_ROOM_DATA", payload: room });
  const eventIds = (room.events || []).reduce<number[]>((ids, roomEvent) => {
    const eventId = Number(roomEvent.id);
    if (Number.isFinite(eventId) && eventId > 0) ids.push(eventId);
    return ids;
  }, []);
  roomRevisionRef.current = Math.max(0, ...eventIds);
  seenEventIdsRef.current = new Set(eventIds);
  roomNameRef.current = room.name;
  const current = room.current_track_payload;
  const roomQueue = queueSnapshotTracks(room.queue);
  authoritativeQueueRef.current = roomQueue;
  const currentTrack = payloadToTrack(
    current?.track as Record<string, unknown> | undefined,
  );
  const roomHasCurrentTrack = !!currentTrack;
  // A room with a current track must be hydrated from its authoritative
  // clock, not from the persisted room position. Starting the async queue
  // load here would allow the following sync_clock message to seek the old
  // engine and then be overwritten by this load at the stale position.
  awaitingInitialClockRef.current = roomHasCurrentTrack;
  if (roomHasCurrentTrack) {
    if (
      playerActionsRef.current.isPlaying &&
      !isJamPlaybackSource(playerActionsRef.current.playSource)
    ) {
      playerActionsRef.current.pause();
    }
    return;
  }
  // Always hand the authoritative room queue to the player, including an
  // empty queue. This switches a new room from the local queue into Jam
  // readonly mode.
  playerActionsRef.current.syncJamQueue(roomQueue, {
    currentTrack,
    positionSeconds: Number(current?.position || 0),
    playing: false,
    source: {
      type: "queue",
      name: `Jam: ${roomNameRef.current}`,
    },
  });
}
