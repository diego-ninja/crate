import { api, apiSseUrl, apiUrl } from "@/lib/api";
import { getListenDeviceId } from "@/lib/listen-device";
import type { RemotePlaybackState } from "@/lib/remote-playback-state";

export { connectPlayerStateToRemotePlaybackState } from "@/lib/crate-connect-state";
export type { ConnectPlayerState } from "@/lib/crate-connect-state";

export const CONNECT_SESSION_EVENT = "crate:connect-session-updated";
export const CONNECT_ENABLED_EVENT = "crate:connect-enabled-changed";

export function isCrateConnectFeatureFlagEnabled(
  value: string | undefined,
): boolean {
  return value !== "false";
}

export const CRATE_CONNECT_FEATURE_ENABLED = isCrateConnectFeatureFlagEnabled(
  import.meta.env.VITE_CRATE_CONNECT_FEATURE_ENABLED,
);
export const CRATE_CONNECT_V2_TRANSPORT_ENABLED = true;
let connectEnabled = false;
let connectPreferencesLoaded = false;
let connectPreferencesRequest: Promise<ConnectPreferencesResponse> | null =
  null;

export type CrateConnectCommandType =
  | "play"
  | "pause"
  | "resume"
  | "seek"
  | "next"
  | "previous"
  | "set_queue"
  | "append_tracks"
  | "set_volume"
  | "set_repeat"
  | "set_shuffle"
  | "transfer_in"
  | "transfer_out";

export interface CrateConnectCommand {
  command_id: string;
  type: CrateConnectCommandType;
  source_device_id?: string | null;
  target_device_id?: string | null;
  playback_session_id?: string | null;
  command_seq?: number | null;
  created_at?: string | null;
  payload?: {
    state?: RemotePlaybackState;
    start_playing?: boolean;
    position_ms?: number;
    positionMs?: number;
    volume?: number;
    [key: string]: unknown;
  };
}

export interface ConnectDevice {
  device_id: string;
  device_label?: string | null;
  device_type?: string | null;
  app_platform?: string | null;
  active: boolean;
  capabilities?: {
    can_play?: boolean;
    can_receive_commands?: boolean;
    can_set_volume?: boolean;
  } | null;
}

export interface ConnectDeviceListResponse {
  devices: ConnectDevice[];
}

export interface ActiveConnectSession {
  user_id: number;
  playback_session_id: string;
  active_device_id?: string | null;
  status: "playing" | "paused" | "stopped" | string;
  command_seq: number;
  state_revision?: string | null;
  updated_at?: string | null;
  expires_at?: string | null;
}

export interface ActiveConnectSessionResponse {
  session: ActiveConnectSession | null;
  state?: RemotePlaybackState | null;
}

export interface ActiveConnectSnapshot {
  session: ActiveConnectSession | null;
  state: RemotePlaybackState | null;
}

export interface ConnectPreferencesResponse {
  enabled: boolean;
}

export interface ConnectWsTicketResponse {
  ticket: string;
  expires_at: string;
  ws_url: string;
}

export type ConnectMessage = {
  type: string;
  payload?: Record<string, unknown> | null;
  version?: number | null;
  timestamp?: string | null;
};

export function generatePlaybackInstanceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `playback-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

export async function fetchConnectWsTicket(
  deviceId = getListenDeviceId(),
): Promise<ConnectWsTicketResponse> {
  return api<ConnectWsTicketResponse>("/api/me/connect/ws-ticket", "POST", {
    device_id: deviceId,
  });
}

export function connectWebSocketUrl(ticketOrPath: string): string {
  const path = /^(https?|wss?):\/\//i.test(ticketOrPath)
    ? ticketOrPath
    : ticketOrPath.startsWith("/api/")
      ? ticketOrPath
      : `/api/me/connect/ws?ticket=${encodeURIComponent(ticketOrPath)}`;
  const absolute = /^(https?|wss?):\/\//i.test(path) ? path : apiUrl(path);
  return absolute.replace(/^http/i, "ws");
}

export function emitConnectSessionChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CONNECT_SESSION_EVENT));
}

function emitConnectEnabledChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(CONNECT_ENABLED_EVENT, {
      detail: { enabled: connectEnabled },
    }),
  );
}

export function isCrateConnectEnabled(): boolean {
  return CRATE_CONNECT_FEATURE_ENABLED && connectEnabled;
}

function applyCrateConnectEnabled(enabled: boolean): void {
  const nextEnabled = CRATE_CONNECT_FEATURE_ENABLED && enabled;
  if (connectEnabled === nextEnabled) return;
  connectEnabled = nextEnabled;
  emitConnectEnabledChanged();
}

export function applyCrateConnectPreference(enabled: boolean): void {
  connectPreferencesLoaded = true;
  applyCrateConnectEnabled(enabled);
}

export function resetCrateConnectPreferences(): void {
  connectPreferencesLoaded = false;
  connectPreferencesRequest = null;
  applyCrateConnectEnabled(false);
}

export async function fetchCrateConnectPreferences(): Promise<ConnectPreferencesResponse> {
  if (!CRATE_CONNECT_FEATURE_ENABLED) {
    connectPreferencesLoaded = true;
    applyCrateConnectEnabled(false);
    return { enabled: false };
  }
  if (connectPreferencesLoaded) return { enabled: connectEnabled };
  connectPreferencesRequest ??= api<ConnectPreferencesResponse>(
    "/api/me/connect/preferences",
  )
    .then((response) => {
      applyCrateConnectPreference(Boolean(response.enabled));
      return { enabled: connectEnabled };
    })
    .finally(() => {
      connectPreferencesRequest = null;
    });
  return connectPreferencesRequest;
}

export function refreshCrateConnectPreferences(): Promise<ConnectPreferencesResponse> {
  connectPreferencesLoaded = false;
  return fetchCrateConnectPreferences();
}

export async function setCrateConnectEnabled(
  enabled: boolean,
): Promise<ConnectPreferencesResponse> {
  if (!CRATE_CONNECT_FEATURE_ENABLED) {
    connectPreferencesLoaded = true;
    applyCrateConnectEnabled(false);
    return { enabled: false };
  }
  const response = await api<ConnectPreferencesResponse>(
    "/api/me/connect/preferences",
    "PUT",
    { enabled },
  );
  applyCrateConnectPreference(Boolean(response.enabled));
  return { enabled: connectEnabled };
}

export function connectCommandEventsUrl(
  deviceId = getListenDeviceId(),
): string {
  return apiSseUrl(
    `/api/me/connect/events?device_id=${encodeURIComponent(deviceId)}`,
  );
}

export async function acknowledgeConnectCommand(
  commandId: string,
  status: "success" | "error" | "ignored",
  error?: string,
): Promise<void> {
  await api(
    `/api/me/connect/commands/${encodeURIComponent(commandId)}/ack`,
    "POST",
    {
      device_id: getListenDeviceId(),
      status,
      error,
    },
  );
}

export function fetchConnectDevices(): Promise<ConnectDeviceListResponse> {
  return api<ConnectDeviceListResponse>("/api/me/devices");
}

export async function fetchActiveConnectSession(): Promise<ActiveConnectSession | null> {
  const response = await fetchActiveConnectSnapshot();
  return response.session;
}

export async function fetchPendingConnectCommands(
  deviceId = getListenDeviceId(),
): Promise<CrateConnectCommand[]> {
  const response = await api<{ commands?: CrateConnectCommand[] }>(
    `/api/me/connect/commands?device_id=${encodeURIComponent(deviceId)}`,
  );
  return Array.isArray(response.commands) ? response.commands : [];
}

export async function fetchActiveConnectSnapshot(): Promise<ActiveConnectSnapshot> {
  const response = await api<ActiveConnectSessionResponse>(
    "/api/me/connect/session",
  );
  return {
    session: response.session ?? null,
    state: response.state ?? null,
  };
}

export async function sendConnectCommand({
  type,
  targetDeviceId,
  playbackSessionId,
  payload,
}: {
  type: Exclude<CrateConnectCommandType, "transfer_in" | "transfer_out">;
  targetDeviceId?: string | null;
  playbackSessionId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<CrateConnectCommand> {
  const response = await api<{ command: CrateConnectCommand }>(
    "/api/me/connect/commands",
    "POST",
    {
      source_device_id: getListenDeviceId(),
      target_device_id: targetDeviceId,
      playback_session_id: playbackSessionId,
      type,
      payload: payload ?? {},
    },
  );
  emitConnectSessionChanged();
  return response.command;
}

export async function transferPlaybackToDevice(
  targetDeviceId: string,
  options: { sourceDeviceId?: string; startPlaying?: boolean } = {},
): Promise<void> {
  await api("/api/me/connect/transfer", "POST", {
    source_device_id: options.sourceDeviceId ?? getListenDeviceId(),
    target_device_id: targetDeviceId,
    start_playing: options.startPlaying ?? true,
  });
  emitConnectSessionChanged();
}
