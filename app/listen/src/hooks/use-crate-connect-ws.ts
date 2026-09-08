import { useCallback, useEffect, useRef, useState } from "react";

import {
  CONNECT_ENABLED_EVENT,
  CRATE_CONNECT_FEATURE_ENABLED,
  connectWebSocketUrl,
  fetchConnectWsTicket,
  generatePlaybackInstanceId,
  type ConnectMessage,
  type ConnectPlayerState,
} from "@/lib/crate-connect";
import type { PlaybackStatePayload } from "@/lib/remote-playback-state";
import {
  HEARTBEAT_INTERVAL_MS,
  nextReconnectDelay,
  parseMessage,
  type ConnectedPlaybackInstance,
} from "./crate-connect-ws-model";
import {
  handleCrateConnectWsMessage,
  type CrateConnectWsCallbacks,
} from "./crate-connect-ws-message-handler";

export type {
  ConnectedPlaybackInstance,
  ConnectedPlaybackInstancesSnapshot,
} from "./crate-connect-ws-model";

export type CrateConnectWsStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

interface UseCrateConnectWsOptions {
  authUserId?: number | null;
  enabled: boolean;
  callbacks?: CrateConnectWsCallbacks;
}

interface UseCrateConnectWsResult {
  activeInstanceId: string | null;
  claimActive: (positionMs?: number) => boolean;
  connected: boolean;
  connectedInstances: ConnectedPlaybackInstance[];
  lastError: string | null;
  playbackInstanceId: string;
  playerState: ConnectPlayerState | null;
  requestTransfer: (targetInstanceId: string) => boolean;
  serverClockOffsetMs: number;
  sendMessage: (message: ConnectMessage) => boolean;
  sendPosition: (positionMs: number) => boolean;
  sendSnapshot: (snapshot: PlaybackStatePayload) => boolean;
  sendStatus: (
    status: "playing" | "paused" | "stopped" | "buffering",
  ) => boolean;
  sendVolume: (volume: number) => boolean;
  status: CrateConnectWsStatus;
}

export function useCrateConnectWs({
  authUserId,
  enabled,
  callbacks,
}: UseCrateConnectWsOptions): UseCrateConnectWsResult {
  const callbacksRef = useRef<CrateConnectWsCallbacks | undefined>(callbacks);
  const [playbackInstanceId] = useState(generatePlaybackInstanceId);
  const playbackInstanceIdRef = useRef(playbackInstanceId);
  const reconnectAttemptRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const playerStateRef = useRef<ConnectPlayerState | null>(null);
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [connectedInstances, setConnectedInstances] = useState<
    ConnectedPlaybackInstance[]
  >([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [playerState, setPlayerState] = useState<ConnectPlayerState | null>(
    null,
  );
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [status, setStatus] = useState<CrateConnectWsStatus>(() =>
    CRATE_CONNECT_FEATURE_ENABLED && enabled && authUserId
      ? "disconnected"
      : "disabled",
  );

  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    playerStateRef.current = playerState;
  }, [playerState]);

  const sendMessage = useCallback((message: ConnectMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const sendVersionedMessage = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      const currentState = playerStateRef.current;
      return sendMessage({
        type,
        payload,
        version:
          typeof currentState?.version === "number"
            ? currentState.version
            : null,
      });
    },
    [sendMessage],
  );

  const claimActive = useCallback(
    (positionMs = playerStateRef.current?.position_ms ?? 0) =>
      sendVersionedMessage("claim_active", {
        position_ms: Math.max(0, Math.round(positionMs)),
      }),
    [sendVersionedMessage],
  );

  const requestTransfer = useCallback(
    (targetInstanceId: string) =>
      sendVersionedMessage("transfer_request", {
        target_instance_id: targetInstanceId,
      }),
    [sendVersionedMessage],
  );

  const sendPosition = useCallback(
    (positionMs: number) =>
      sendVersionedMessage("update_position", {
        position_ms: Math.max(0, Math.round(positionMs)),
      }),
    [sendVersionedMessage],
  );

  const sendStatus = useCallback(
    (nextStatus: "playing" | "paused" | "stopped" | "buffering") =>
      sendVersionedMessage("update_status", { status: nextStatus }),
    [sendVersionedMessage],
  );

  const sendSnapshot = useCallback(
    (snapshot: PlaybackStatePayload) =>
      sendVersionedMessage(
        "update_snapshot",
        snapshot as unknown as Record<string, unknown>,
      ),
    [sendVersionedMessage],
  );

  const sendVolume = useCallback(
    (volume: number) =>
      sendVersionedMessage("update_volume", {
        volume: Math.max(0, Math.min(1, volume)),
      }),
    [sendVersionedMessage],
  );

  useEffect(() => {
    const shouldConnect =
      CRATE_CONNECT_FEATURE_ENABLED && enabled && Boolean(authUserId);
    let cancelled = false;
    let heartbeatTimer: number | undefined;
    let reconnectTimer: number | undefined;

    function clearTimers() {
      if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      heartbeatTimer = undefined;
      reconnectTimer = undefined;
    }

    function closeSocket() {
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.close();
      }
    }

    function scheduleReconnect() {
      if (cancelled || !shouldConnect) return;
      const delay = nextReconnectDelay(reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    }

    async function connect() {
      if (cancelled || !shouldConnect) return;
      setStatus("connecting");
      setLastError(null);
      try {
        const ticket = await fetchConnectWsTicket();
        if (cancelled || !shouldConnect) return;
        const socket = new WebSocket(connectWebSocketUrl(ticket.ws_url));
        socketRef.current = socket;

        socket.onopen = () => {
          reconnectAttemptRef.current = 0;
          heartbeatTimer = window.setInterval(() => {
            sendMessage({ type: "heartbeat", payload: {} });
          }, HEARTBEAT_INTERVAL_MS);
        };

        socket.onmessage = (event) => {
          if (cancelled || socketRef.current !== socket) return;
          const message = parseMessage(event.data);
          if (!message?.type) return;

          void handleCrateConnectWsMessage({
            message,
            callbacksRef,
            playerStateRef,
            playbackInstanceId: playbackInstanceIdRef.current,
            sendMessage,
            setActiveInstanceId,
            setConnectedInstances,
            setLastError,
            setPlayerState,
            setServerClockOffsetMs,
            setStatus: (nextStatus) => setStatus(nextStatus),
          });
        };

        socket.onerror = () => {
          if (cancelled || socketRef.current !== socket) return;
          setLastError("Crate Connect socket error");
          setStatus("error");
        };

        socket.onclose = () => {
          if (socketRef.current === socket) socketRef.current = null;
          clearTimers();
          if (cancelled || !shouldConnect) return;
          setStatus("disconnected");
          scheduleReconnect();
        };
      } catch (error) {
        if (cancelled || !shouldConnect) return;
        setLastError(error instanceof Error ? error.message : String(error));
        setStatus("error");
        scheduleReconnect();
      }
    }

    if (!shouldConnect) {
      setStatus("disabled");
      setActiveInstanceId(null);
      setConnectedInstances([]);
      setLastError(null);
      setPlayerState(null);
      closeSocket();
      clearTimers();
      return;
    }

    void connect();
    window.addEventListener(CONNECT_ENABLED_EVENT, closeSocket);
    return () => {
      cancelled = true;
      window.removeEventListener(CONNECT_ENABLED_EVENT, closeSocket);
      clearTimers();
      closeSocket();
    };
  }, [authUserId, enabled, sendMessage]);

  return {
    activeInstanceId,
    claimActive,
    connected: status === "connected",
    connectedInstances,
    lastError,
    playbackInstanceId: playbackInstanceIdRef.current,
    playerState,
    requestTransfer,
    serverClockOffsetMs,
    sendMessage,
    sendPosition,
    sendSnapshot,
    sendStatus,
    sendVolume,
    status,
  };
}
