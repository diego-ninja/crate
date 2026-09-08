import { useEffect, useRef } from "react";

import type { PlayerActionsValue } from "@/contexts/player-context";
import type {
  JamQueueItem,
  JamRoom,
  JamSessionAction,
  SearchData,
} from "@/pages/jam-reducer";
import { payloadToTrack } from "@/pages/jam-reducer";
import { api } from "@/lib/api";
import {
  getPlaybackDeliveryPolicyPreference,
  PLAYER_PLAYBACK_PREFS_EVENT,
  setPlaybackDeliveryPolicyPreference,
  type PlaybackDeliveryPreference,
} from "@/lib/player-playback-prefs";

type Dispatch = (action: JamSessionAction) => void;
type PlayerActions = Pick<PlayerActionsValue, "pause" | "syncJamQueue">;

export interface UseJamSessionLifecycleOptions {
  roomId: string | undefined;
  room: JamRoom | null;
  data: JamRoom | null | undefined;
  isConnected: boolean;
  roomIsActive: boolean;
  queueItems: JamQueueItem[];
  queueSearch: string;
  canEditQueue: boolean;
  roomNameRef: { current: string };
  playerActionsRef: { current: PlayerActions };
  dispatch: Dispatch;
  enterJamSession: () => void;
  leaveJamSession: () => void;
}

export function useJamSessionLifecycle({
  roomId,
  room,
  data,
  isConnected,
  roomIsActive,
  queueItems,
  queueSearch,
  canEditQueue,
  roomNameRef,
  playerActionsRef,
  dispatch,
  enterJamSession,
  leaveJamSession,
}: UseJamSessionLifecycleOptions) {
  const prevQualityRef = useRef<PlaybackDeliveryPreference | null>(null);
  const restHydratedRoomRef = useRef<string | null>(null);

  useEffect(() => {
    if (!roomId) {
      leaveJamSession();
      return;
    }
    enterJamSession();
    return () => leaveJamSession();
  }, [enterJamSession, leaveJamSession, roomId]);

  useEffect(() => {
    if (roomId && room?.status === "ended") {
      leaveJamSession();
    }
  }, [leaveJamSession, room?.status, roomId]);

  useEffect(() => {
    if (roomId) {
      const current = getPlaybackDeliveryPolicyPreference();
      if (current !== "original") {
        prevQualityRef.current = current;
        setPlaybackDeliveryPolicyPreference("original");
        window.dispatchEvent(
          new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
            detail: { playbackDeliveryPolicy: "original" },
          }),
        );
      }
    }
    return () => {
      if (prevQualityRef.current) {
        setPlaybackDeliveryPolicyPreference(prevQualityRef.current);
        window.dispatchEvent(
          new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
            detail: { playbackDeliveryPolicy: prevQualityRef.current },
          }),
        );
        prevQualityRef.current = null;
      }
    };
  }, [roomId]);

  useEffect(() => {
    if (data) {
      dispatch({ type: "APPLY_ROOM_DATA", payload: data });
      roomNameRef.current = data.name;
    }
  }, [data, dispatch, roomNameRef]);

  useEffect(() => {
    if (!roomId) {
      restHydratedRoomRef.current = null;
      return;
    }

    const syncRoom = room?.id === roomId ? room : data;
    if (
      isConnected ||
      restHydratedRoomRef.current === roomId ||
      !roomIsActive ||
      !syncRoom
    ) {
      return;
    }
    restHydratedRoomRef.current = roomId;

    const currentPayload = syncRoom.current_track_payload;
    const currentTrack = payloadToTrack(
      currentPayload?.track as Record<string, unknown> | undefined,
    );
    const position = Number(currentPayload?.position);

    if (currentPayload?.playing === true && currentTrack) {
      playerActionsRef.current.pause();
      return;
    }

    playerActionsRef.current.syncJamQueue(
      queueItems.map((item) => item.track),
      {
        currentTrack,
        positionSeconds: Number.isFinite(position) ? Math.max(0, position) : 0,
        playing: false,
        source: { type: "queue", name: `Jam: ${syncRoom.name}` },
      },
    );
  }, [
    data,
    isConnected,
    playerActionsRef,
    queueItems,
    room,
    roomId,
    roomIsActive,
  ]);

  useEffect(() => {
    const query = queueSearch.trim();
    if (!roomId || !canEditQueue || query.length < 2) {
      dispatch({ type: "SET_QUEUE_SEARCH_RESULTS", payload: [] });
      dispatch({ type: "SET_QUEUE_SEARCH_LOADING", payload: false });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      dispatch({ type: "SET_QUEUE_SEARCH_LOADING", payload: true });
      api<SearchData>(
        `/api/catalog/search?q=${encodeURIComponent(query)}&limit=8`,
        "GET",
        undefined,
        { signal: controller.signal },
      )
        .then((result) =>
          dispatch({
            type: "SET_QUEUE_SEARCH_RESULTS",
            payload: result.tracks || [],
          }),
        )
        .catch(() => {
          if (!controller.signal.aborted) {
            dispatch({ type: "SET_QUEUE_SEARCH_RESULTS", payload: [] });
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            dispatch({ type: "SET_QUEUE_SEARCH_LOADING", payload: false });
          }
        });
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canEditQueue, queueSearch, roomId, dispatch]);
}
