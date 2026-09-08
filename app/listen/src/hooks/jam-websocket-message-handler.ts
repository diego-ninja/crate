import { tracksMatch } from "@/contexts/player-session";
import {
  handleJamWebSocketControlMessage,
  type JamWebSocketMessageHandlerContext,
  type JamWebSocketPayload,
} from "@/hooks/jam-websocket-control-handler";
import {
  projectJamClockPosition,
  queueSnapshotTracks,
} from "@/hooks/jam-websocket-utils";
import type { JamQueueItem, JamRoom } from "@/pages/jam-reducer";
import { payloadToTrack } from "@/pages/jam-reducer";
import { toast } from "sonner";

export function handleJamWebSocketMessage(
  data: string,
  context: JamWebSocketMessageHandlerContext,
) {
  const {
    dispatch,
    userId,
    playerActionsRef,
    roomNameRef,
    authoritativeQueueRef,
    serverClockOffsetMsRef,
    roomRevisionRef,
    seenEventIdsRef,
  } = context;
  try {
    const payload = JSON.parse(data) as JamWebSocketPayload;
    if (handleJamWebSocketControlMessage(payload, context)) return;

    if (!payload.event) return;

    const eventRow = payload.event;
    const eventId = Number(eventRow.id);
    if (
      Number.isFinite(eventId) &&
      eventId > 0 &&
      eventId < roomRevisionRef.current
    ) {
      return;
    }
    if (Number.isFinite(eventId) && eventId > 0) {
      roomRevisionRef.current = Math.max(roomRevisionRef.current, eventId);
    }
    if (Number.isFinite(eventId) && seenEventIdsRef.current.has(eventId)) {
      return;
    }
    if (Number.isFinite(eventId) && eventId > 0) {
      seenEventIdsRef.current.add(eventId);
    }

    if (payload.type === "room_updated" && payload.room) {
      dispatch({ type: "APPLY_ROOM_DATA", payload: payload.room });
      roomNameRef.current = payload.room.name;
      toast.info("Room settings updated");
      return;
    }

    const eventPayload = (eventRow.payload_json || {}) as Record<
      string,
      unknown
    >;
    const eventTrack = payloadToTrack(
      eventPayload.track as Record<string, unknown> | undefined,
    );
    const eventCurrentTrack = payloadToTrack(
      eventPayload.current_track as Record<string, unknown> | undefined,
    );
    const queueAddStartsPlayback =
      payload.type === "queue_add" &&
      eventCurrentTrack !== null &&
      eventPayload.playing === true;

    const queueSnapshot = Array.isArray(payload.queue)
      ? (payload.queue as JamQueueItem[])
      : undefined;
    if (queueSnapshot) {
      authoritativeQueueRef.current = queueSnapshotTracks(queueSnapshot);
    }
    const roomTracksForTransport = queueSnapshot
      ? queueSnapshotTracks(queueSnapshot)
      : authoritativeQueueRef.current;
    const isTransportEvent =
      (payload.type === "play" ||
        payload.type === "pause" ||
        payload.type === "seek") &&
      eventTrack;
    if (
      isTransportEvent &&
      roomTracksForTransport.length > 0 &&
      !roomTracksForTransport.some((candidate) =>
        tracksMatch(candidate, eventTrack),
      )
    ) {
      // A stale or forged transport event must not replace the room's current
      // track or make a member play outside the authoritative queue.
      return;
    }
    if (queueSnapshot) {
      dispatch({ type: "QUEUE_SNAPSHOT", payload: queueSnapshot });
      const transportEventHasTrack =
        (payload.type === "play" ||
          payload.type === "pause" ||
          payload.type === "seek") &&
        eventTrack;
      if (
        payload.type !== "play_next" &&
        payload.type !== "queue_play" &&
        !queueAddStartsPlayback &&
        !transportEventHasTrack
      ) {
        playerActionsRef.current.syncJamQueue(
          queueSnapshotTracks(queueSnapshot),
          {
            queueOnly: true,
            source: {
              type: "queue",
              name: `Jam: ${roomNameRef.current}`,
            },
          },
        );
      }
    }
    if (payload.requests) {
      dispatch({ type: "REQUESTS_SNAPSHOT", payload: payload.requests });
    }
    if (
      payload.type === "queue_vote" &&
      typeof eventPayload.queue_item_id === "string" &&
      typeof eventPayload.vote_count === "number" &&
      Number(eventRow.user_id) === userId
    ) {
      dispatch({
        type: "QUEUE_VOTE",
        payload: {
          queueItemId: eventPayload.queue_item_id,
          voted: eventPayload.voted === true,
          voteCount: eventPayload.vote_count,
        },
      });
    }

    dispatch({
      type: "SET_ROOM",
      payload: (prev: JamRoom | null) => {
        if (!prev) return prev;
        const nextRoom = {
          ...prev,
          members: payload.members || prev.members,
          events: [...prev.events, eventRow].slice(-80),
        };
        if (
          payload.type === "play" ||
          payload.type === "pause" ||
          payload.type === "seek" ||
          payload.type === "play_next" ||
          payload.type === "queue_play" ||
          queueAddStartsPlayback
        ) {
          nextRoom.current_track_payload = {
            track: eventPayload.current_track ?? eventPayload.track,
            position: eventPayload.position,
            playing: eventPayload.playing,
          };
        }
        return nextRoom;
      },
    });

    if (!queueSnapshot) {
      if (payload.type === "queue_add" && eventTrack) {
        dispatch({ type: "QUEUE_ADD", payload: eventTrack });
      } else if (
        payload.type === "queue_remove" &&
        typeof eventPayload.index === "number"
      ) {
        dispatch({
          type: "QUEUE_REMOVE",
          payload: eventPayload.index as number,
        });
      } else if (
        payload.type === "queue_reorder" &&
        typeof eventPayload.fromIndex === "number" &&
        typeof eventPayload.toIndex === "number"
      ) {
        dispatch({
          type: "QUEUE_REORDER",
          payload: {
            fromIndex: eventPayload.fromIndex as number,
            toIndex: eventPayload.toIndex as number,
          },
        });
      }
    }

    if (
      eventRow.user_id === userId &&
      payload.type !== "play_next" &&
      payload.type !== "queue_play" &&
      !queueAddStartsPlayback
    ) {
      return;
    }

    const { play, pause, resume, seek } = playerActionsRef.current;

    if (queueAddStartsPlayback && eventCurrentTrack) {
      const roomTracks = queueSnapshot
        ? queueSnapshotTracks(queueSnapshot)
        : authoritativeQueueRef.current;
      const positionSeconds =
        typeof eventPayload.position === "number"
          ? projectJamClockPosition({
              positionMs: eventPayload.position * 1000,
              serverTimeMs:
                typeof eventPayload.server_time_ms === "number"
                  ? eventPayload.server_time_ms
                  : undefined,
              clientNowMs: Date.now(),
              clockOffsetMs: serverClockOffsetMsRef.current,
              playing: true,
            }) / 1000
          : 0;
      playerActionsRef.current.syncJamQueue(
        roomTracks.length > 0 ? roomTracks : [eventCurrentTrack],
        {
          currentTrack: eventCurrentTrack,
          positionSeconds,
          playing: true,
          source: {
            type: "queue",
            name: `Jam: ${roomNameRef.current}`,
          },
        },
      );
      return;
    }

    if (
      (payload.type === "play" ||
        payload.type === "pause" ||
        payload.type === "seek") &&
      eventTrack
    ) {
      const roomTracks = queueSnapshot
        ? queueSnapshotTracks(queueSnapshot)
        : authoritativeQueueRef.current;
      const trackIsInRoomQueue = roomTracks.some((candidate) =>
        tracksMatch(candidate, eventTrack),
      );
      if (trackIsInRoomQueue) {
        const playing =
          payload.type === "play"
            ? true
            : payload.type === "pause"
              ? false
              : typeof eventPayload.playing === "boolean"
                ? eventPayload.playing
                : undefined;
        const positionSeconds =
          typeof eventPayload.position === "number"
            ? projectJamClockPosition({
                positionMs: eventPayload.position * 1000,
                serverTimeMs:
                  typeof eventPayload.server_time_ms === "number"
                    ? eventPayload.server_time_ms
                    : undefined,
                clientNowMs: Date.now(),
                clockOffsetMs: serverClockOffsetMsRef.current,
                playing: playing === true,
              }) / 1000
            : undefined;
        playerActionsRef.current.syncJamQueue(roomTracks, {
          currentTrack: eventTrack,
          positionSeconds,
          playing,
          queueOnly: true,
          // A transport command is a user-visible discontinuity. Apply its
          // position even when the network delta is below the periodic
          // heartbeat threshold; heartbeats use rate matching instead.
          forcePosition: true,
          source: {
            type: "queue",
            name: `Jam: ${roomNameRef.current}`,
          },
        });
        return;
      }
    }

    if (payload.type === "play_next" || payload.type === "queue_play") {
      const tracks = queueSnapshot
        ? queueSnapshotTracks(queueSnapshot)
        : authoritativeQueueRef.current;
      const transportTrack = eventTrack;
      const targetTrack = transportTrack || tracks[0];
      if (targetTrack) {
        const startPositionSeconds =
          projectJamClockPosition({
            positionMs: 0,
            serverTimeMs:
              typeof eventPayload.server_time_ms === "number"
                ? eventPayload.server_time_ms
                : undefined,
            clientNowMs: Date.now(),
            clockOffsetMs: serverClockOffsetMsRef.current,
            playing: true,
          }) / 1000;
        playerActionsRef.current.syncJamQueue(
          tracks.length > 0 ? tracks : [targetTrack],
          {
            currentTrack: targetTrack,
            positionSeconds: startPositionSeconds,
            playing: true,
            source: {
              type: "queue",
              name: `Jam: ${roomNameRef.current}`,
            },
          },
        );
      } else {
        pause();
      }
    } else if (payload.type === "play") {
      if (eventTrack) {
        play(eventTrack, {
          type: "queue",
          name: `Jam: ${roomNameRef.current}`,
        });
      } else {
        resume();
      }
      const eventPosition = eventPayload.position;
      if (typeof eventPosition === "number") {
        window.setTimeout(() => {
          const positionSeconds =
            projectJamClockPosition({
              positionMs: eventPosition * 1000,
              serverTimeMs:
                typeof eventPayload.server_time_ms === "number"
                  ? eventPayload.server_time_ms
                  : undefined,
              clientNowMs: Date.now(),
              clockOffsetMs: serverClockOffsetMsRef.current,
              playing: true,
            }) / 1000;
          seek(positionSeconds);
        }, 120);
      }
    } else if (payload.type === "pause") {
      if (typeof eventPayload.position === "number") {
        seek(eventPayload.position as number);
      }
      pause();
    } else if (
      payload.type === "seek" &&
      typeof eventPayload.position === "number"
    ) {
      seek(
        projectJamClockPosition({
          positionMs: eventPayload.position * 1000,
          serverTimeMs:
            typeof eventPayload.server_time_ms === "number"
              ? eventPayload.server_time_ms
              : undefined,
          clientNowMs: Date.now(),
          clockOffsetMs: serverClockOffsetMsRef.current,
          playing: eventPayload.playing === true,
        }) / 1000,
      );
    }
  } catch {
    // Ignore malformed payloads from the socket.
  }
}
