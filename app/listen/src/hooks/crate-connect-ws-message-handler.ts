import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import {
  applyCrateConnectPreference,
  type ConnectMessage,
  type ConnectPlayerState,
} from "@/lib/crate-connect";
import {
  getListenAppPlatform,
  getListenDeviceCapabilities,
  getListenDeviceId,
  getListenDeviceLabel,
  getListenDeviceType,
} from "@/lib/listen-device";

import {
  isRemoteCommandType,
  normalizeInstances,
  serverTimeOffsetMs,
  type BecameInactivePayload,
  type ConnectedPlaybackInstance,
  type RemoteCommandType,
  type TransferCommittedPayload,
  type TransferFailedPayload,
  type TransferIncomingPayload,
} from "./crate-connect-ws-model";

export interface CrateConnectWsCallbacks {
  onBecameInactive?: (payload: BecameInactivePayload) => void;
  onPlayerState?: (state: ConnectPlayerState | null) => void;
  onRemoteCommand?: (type: RemoteCommandType, payload: ConnectMessage) => void;
  onTransferCommitted?: (payload: TransferCommittedPayload) => void;
  onTransferFailed?: (payload: TransferFailedPayload) => void;
  onTransferIncoming?: (
    payload: TransferIncomingPayload,
  ) => boolean | Promise<boolean>;
}

interface CrateConnectWsMessageHandlerOptions {
  message: ConnectMessage;
  callbacksRef: MutableRefObject<CrateConnectWsCallbacks | undefined>;
  playerStateRef: MutableRefObject<ConnectPlayerState | null>;
  playbackInstanceId: string;
  sendMessage: (message: ConnectMessage) => boolean;
  setActiveInstanceId: (instanceId: string | null) => void;
  setConnectedInstances: (instances: ConnectedPlaybackInstance[]) => void;
  setLastError: (error: string | null) => void;
  setPlayerState: Dispatch<SetStateAction<ConnectPlayerState | null>>;
  setServerClockOffsetMs: (offsetMs: number) => void;
  setStatus: (status: "connected" | "error") => void;
}

export async function handleCrateConnectWsMessage({
  message,
  callbacksRef,
  playerStateRef,
  playbackInstanceId,
  sendMessage,
  setActiveInstanceId,
  setConnectedInstances,
  setLastError,
  setPlayerState,
  setServerClockOffsetMs,
  setStatus,
}: CrateConnectWsMessageHandlerOptions): Promise<void> {
  if (message.type === "hello") {
    setServerClockOffsetMs(serverTimeOffsetMs(message));
    sendMessage({
      type: "hello",
      payload: {
        app_platform: getListenAppPlatform(),
        capabilities: getListenDeviceCapabilities(),
        device_id: getListenDeviceId(),
        device_label: getListenDeviceLabel(),
        device_type: getListenDeviceType(),
        playback_instance_id: playbackInstanceId,
      },
    });
    setStatus("connected");
    return;
  }

  if (
    message.type === "player_state" ||
    message.type === "player_state_update"
  ) {
    const nextState = (message.payload ?? null) as ConnectPlayerState | null;
    playerStateRef.current = nextState;
    setPlayerState(nextState);
    setActiveInstanceId(nextState?.active_instance_id ?? null);
    callbacksRef.current?.onPlayerState?.(nextState);
    return;
  }

  if (message.type === "connected_instances") {
    const snapshot = normalizeInstances(message.payload);
    setConnectedInstances(snapshot.instances);
    if (
      Object.prototype.hasOwnProperty.call(
        message.payload ?? {},
        "active_instance_id",
      )
    ) {
      setActiveInstanceId(snapshot.active_instance_id ?? null);
    }
    return;
  }

  if (message.type === "connect_preferences") {
    applyCrateConnectPreference(Boolean(message.payload?.enabled));
    return;
  }

  if (message.type === "became_inactive") {
    const payload = (message.payload ?? {}) as BecameInactivePayload;
    if (typeof payload.active_instance_id === "string") {
      setActiveInstanceId(payload.active_instance_id);
    }
    callbacksRef.current?.onBecameInactive?.(payload);
    return;
  }

  if (message.type === "transfer_incoming") {
    const payload = (message.payload ?? {}) as TransferIncomingPayload;
    const accepted =
      (await callbacksRef.current?.onTransferIncoming?.(payload)) ?? true;
    const incomingVersion =
      typeof message.version === "number"
        ? message.version
        : typeof payload.state?.version === "number"
          ? payload.state.version
          : typeof playerStateRef.current?.version === "number"
            ? playerStateRef.current.version
            : null;
    sendMessage({
      type: accepted ? "transfer_ready" : "transfer_cancel",
      payload: {
        transfer_id: payload.transfer_id,
        ...(accepted ? {} : { reason: "target-rejected" }),
      },
      version: incomingVersion,
    });
    return;
  }

  if (message.type === "transfer_committed") {
    const payload = (message.payload ?? {}) as TransferCommittedPayload;
    if (typeof payload.active_instance_id === "string") {
      setActiveInstanceId(payload.active_instance_id);
    }
    callbacksRef.current?.onTransferCommitted?.(payload);
    return;
  }

  if (message.type === "transfer_failed") {
    callbacksRef.current?.onTransferFailed?.(
      (message.payload ?? {}) as TransferFailedPayload,
    );
    return;
  }

  if (isRemoteCommandType(message.type)) {
    callbacksRef.current?.onRemoteCommand?.(message.type, message);
    return;
  }

  if (message.type === "error") {
    const errorMessage =
      typeof message.payload?.message === "string"
        ? message.payload.message
        : "Crate Connect error";
    setLastError(errorMessage);
    setStatus("error");
  }
}
