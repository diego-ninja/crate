import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { apiWsUrl } from "@/lib/api";
import type { JamRoom, JamSessionAction } from "@/pages/jam-reducer";
import { handleJamWebSocketMessage } from "@/hooks/jam-websocket-message-handler";
import {
  type JamPlayerActionsRef,
  useJamWebSocketSync,
} from "@/hooks/use-jam-websocket-sync";

export { projectJamClockPosition } from "@/hooks/jam-websocket-utils";

function jamCloseMessage(code: number) {
  if (code === 4401)
    return "Your session is not valid anymore. Log in again to join this room.";
  if (code === 4403)
    return "You do not have access to this room, or the room is no longer active.";
  if (code === 4500)
    return "Room sync is temporarily unavailable. Retrying... (4500)";
  return `Room connection dropped. Retrying... (${code || "unknown"})`;
}

function shouldReconnectJamClose(code: number) {
  return ![4401, 4403, 4409].includes(code);
}

interface UseJamWebSocketOptions {
  roomId: string | undefined;
  userId: number | undefined;
  dispatch: React.Dispatch<JamSessionAction>;
  playerActionsRef: React.MutableRefObject<JamPlayerActionsRef>;
  currentTimeRef: React.MutableRefObject<number>;
  roomNameRef: React.MutableRefObject<string>;
}

export function useJamWebSocket({
  roomId,
  userId,
  dispatch,
  playerActionsRef,
  currentTimeRef,
  roomNameRef,
}: UseJamWebSocketOptions) {
  const socketRef = useRef<WebSocket | null>(null);
  const seenEventIdsRef = useRef<Set<number>>(new Set());
  const roomRevisionRef = useRef(0);
  const navigate = useNavigate();

  const {
    authoritativeQueueRef,
    awaitingInitialClockRef,
    hasServerClockOffsetRef,
    jamRateCorrectionRef,
    lastHardCorrectionAtRef,
    pendingSyncTrackRef,
    serverClockOffsetMsRef,
    syncSeek,
  } = useJamWebSocketSync({
    currentTimeRef,
    dispatch,
    playerActionsRef,
    roomNameRef,
  });

  const sendEvent = useCallback(
    (payload: Record<string, unknown>) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        const message = "Room connection dropped. Retrying... (not open)";
        dispatch({ type: "SEND_EVENT_FAIL", payload: message });
        toast.error(message);
        return false;
      }
      socket.send(JSON.stringify(payload));
      return true;
    },
    [dispatch],
  );

  useEffect(() => {
    if (!roomId || !userId) return;
    const connectedUserId = userId;
    pendingSyncTrackRef.current = null;
    awaitingInitialClockRef.current = false;
    authoritativeQueueRef.current = [];
    serverClockOffsetMsRef.current = 0;
    hasServerClockOffsetRef.current = false;
    lastHardCorrectionAtRef.current = 0;
    let cancelled = false;
    let retries = 0;
    let reconnectTimer: number | undefined;
    const heartbeatTimers = new Set<number>();

    function clearHeartbeat(timer: number | undefined) {
      if (timer === undefined) return;
      window.clearInterval(timer);
      heartbeatTimers.delete(timer);
    }

    function connect() {
      if (cancelled) return;
      dispatch({ type: "SET_SYNC_STATUS", payload: "idle" });
      dispatch({ type: "SET_CONNECTION_PROBLEM", payload: null });
      const socket = new WebSocket(apiWsUrl(`/api/jam/rooms/${roomId}/ws`));
      let socketHeartbeatTimer: number | undefined;
      socketRef.current = socket;

      socket.onopen = () => {
        if (cancelled || socketRef.current !== socket) {
          socket.close();
          return;
        }
        retries = 0;
        dispatch({ type: "WEBSOCKET_OPEN" });
        const sendClockPing = () => {
          if (socket.readyState !== WebSocket.OPEN) return;
          socket.send(
            JSON.stringify({
              type: "ping",
              client_sent_at_ms: Date.now(),
            }),
          );
        };
        sendClockPing();
        socketHeartbeatTimer = window.setInterval(() => {
          sendClockPing();
        }, 10_000);
        heartbeatTimers.add(socketHeartbeatTimer);
      };

      socket.onmessage = (event) => {
        if (cancelled || socketRef.current !== socket) return;
        handleJamWebSocketMessage(event.data, {
          dispatch,
          navigate,
          userId: connectedUserId,
          playerActionsRef,
          roomNameRef,
          authoritativeQueueRef,
          awaitingInitialClockRef,
          serverClockOffsetMsRef,
          hasServerClockOffsetRef,
          roomRevisionRef,
          seenEventIdsRef,
          syncSeek,
        });
      };

      socket.onclose = (event) => {
        clearHeartbeat(socketHeartbeatTimer);
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        dispatch({
          type: "WEBSOCKET_CLOSED",
          payload: { code: event.code, message: jamCloseMessage(event.code) },
        });

        if (event.code === 4409) {
          dispatch({
            type: "SET_ROOM",
            payload: (prev: JamRoom | null) =>
              prev ? { ...prev, status: "ended" } : prev,
          });
          dispatch({ type: "SET_CONNECTION_PROBLEM", payload: null });
          return;
        }
        if (cancelled) return;

        if (!shouldReconnectJamClose(event.code)) {
          toast.error(jamCloseMessage(event.code));
          return;
        }

        const delay = Math.min(1000 * Math.pow(2, retries), 30_000);
        retries++;
        console.debug(
          `[jam] WebSocket closed, reconnecting in ${delay}ms (attempt ${retries})`,
        );
        reconnectTimer = window.setTimeout(connect, delay);
      };

      socket.onerror = () => {
        // onclose will fire after this — reconnect logic lives there
      };
    }

    // The effect owns the WebSocket lifecycle; connect dispatches its initial
    // lifecycle state as part of establishing that external subscription.
    // react-doctor-disable-next-line no-pass-live-state-to-parent
    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      for (const timer of heartbeatTimers) {
        window.clearInterval(timer);
      }
      heartbeatTimers.clear();
      pendingSyncTrackRef.current = null;
      awaitingInitialClockRef.current = false;
      authoritativeQueueRef.current = [];
      roomRevisionRef.current = 0;
      if (jamRateCorrectionRef.current) {
        playerActionsRef.current.setPlaybackRate?.(1);
        jamRateCorrectionRef.current = false;
      }
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        try {
          // Tell the room before closing. This avoids waiting for the server
          // to infer a disconnect from the TCP connection.
          socket.send(JSON.stringify({ type: "leave" }));
        } catch {
          // The close path is best-effort; server-side disconnect/TTL cleanup
          // remains the fallback for an already broken socket.
        }
      }
      socket?.close();
      socketRef.current = null;
    };
    // Retry timers and socket-local cancellation state intentionally live
    // inside this effect and are not stable render dependencies.
    // react-doctor-disable-next-line exhaustive-deps
  }, [
    roomId,
    userId,
    dispatch,
    navigate,
    syncSeek,
    playerActionsRef,
    roomNameRef,
  ]);

  return { sendEvent, socketRef, seenEventIdsRef };
}
