import type { ConnectMessage, ConnectPlayerState } from "@/lib/crate-connect";

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 30_000;

export interface ConnectedPlaybackInstance {
  instance_id: string;
  device_id?: string | null;
  device_label?: string | null;
  device_type?: string | null;
  app_platform?: string | null;
  connected_at?: string | null;
  capabilities?: Record<string, unknown> | null;
}

export interface ConnectedPlaybackInstancesSnapshot {
  instances: ConnectedPlaybackInstance[];
  active_instance_id?: string | null;
}

export interface TransferIncomingPayload {
  transfer_id?: string;
  source_instance_id?: string;
  state?: ConnectPlayerState | null;
}

export interface TransferCommittedPayload {
  active_instance_id?: string | null;
  active_device_label?: string | null;
}

export interface TransferFailedPayload {
  transfer_id?: string | null;
  reason?: string | null;
}

export interface BecameInactivePayload {
  active_instance_id?: string | null;
  active_device_label?: string | null;
}

export type RemoteCommandType =
  | "seek"
  | "next_track"
  | "previous_track"
  | "pause"
  | "resume"
  | "volume";

export function parseMessage(data: unknown): ConnectMessage | null {
  try {
    if (typeof data === "string") return JSON.parse(data) as ConnectMessage;
    if (data instanceof Blob) return null;
    return data as ConnectMessage;
  } catch {
    return null;
  }
}

export function serverTimeOffsetMs(message: ConnectMessage): number {
  const serverTime = message.payload?.server_time;
  if (typeof serverTime !== "string") return 0;
  const parsed = Date.parse(serverTime);
  return Number.isFinite(parsed) ? parsed - Date.now() : 0;
}

export function normalizeInstances(
  payload: Record<string, unknown> | null | undefined,
): ConnectedPlaybackInstancesSnapshot {
  const rawInstances = Array.isArray(payload?.instances)
    ? payload?.instances
    : [];
  return {
    active_instance_id:
      typeof payload?.active_instance_id === "string"
        ? payload.active_instance_id
        : null,
    instances: rawInstances
      .filter(
        (entry): entry is ConnectedPlaybackInstance =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as ConnectedPlaybackInstance).instance_id === "string",
      )
      .map((entry) => ({ ...entry })),
  };
}

export function isRemoteCommandType(type: string): type is RemoteCommandType {
  return (
    type === "seek" ||
    type === "next_track" ||
    type === "previous_track" ||
    type === "pause" ||
    type === "resume" ||
    type === "volume"
  );
}

export function nextReconnectDelay(attempt: number): number {
  return Math.min(
    RECONNECT_MAX_DELAY_MS,
    RECONNECT_BASE_DELAY_MS * 2 ** Math.max(0, attempt),
  );
}
