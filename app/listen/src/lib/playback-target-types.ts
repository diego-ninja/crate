import type { Track } from "@/contexts/player-types";
import type { ActiveConnectSession } from "@/lib/crate-connect";

export type PlaybackTargetKind =
  | "airplay"
  | "crate-device"
  | "google-cast"
  | "local"
  | "system-route";

export interface PlaybackTargetCapabilities {
  canPlay: boolean;
  canSeek: boolean;
  canSetVolume: boolean;
  canShowSystemPicker?: boolean;
}

export interface PlaybackTarget {
  id: string;
  providerId: string;
  kind: PlaybackTargetKind;
  name: string;
  subtitle?: string;
  active: boolean;
  available: boolean;
  unavailableReason?: string;
  capabilities: PlaybackTargetCapabilities;
}

export interface PlaybackTargetSelectionResult {
  ok: boolean;
  message?: string;
}

export interface PlaybackTargetContext {
  currentTrack?: Track | null;
  currentTime?: number;
  currentIndex?: number;
  queue?: Track[];
  volume?: number;
  activeConnectDeviceId?: string | null;
  activeConnectSession?: ActiveConnectSession | null;
  connect?: PlaybackTargetConnectContext | null;
  pause?: () => void | Promise<void>;
  publishConnectState?: (options?: { claimActive?: boolean }) => Promise<void>;
}

export interface PlaybackTargetConnectInstance {
  instance_id: string;
  device_id?: string | null;
  device_label?: string | null;
  device_type?: string | null;
  app_platform?: string | null;
  connected_at?: string | null;
  capabilities?: Record<string, unknown> | null;
}

export interface PlaybackTargetConnectContext {
  activeInstanceId: string | null;
  connectedInstances: PlaybackTargetConnectInstance[];
  playbackInstanceId: string | null;
  requestTransfer: (targetInstanceId: string) => boolean;
  transport: "legacy" | "ws" | null;
}

export interface PlaybackTargetProvider {
  id: string;
  label: string;
  getTargets: (
    context?: PlaybackTargetContext,
  ) => PlaybackTarget[] | Promise<PlaybackTarget[]>;
  selectTarget: (
    target: PlaybackTarget,
    context?: PlaybackTargetContext,
  ) => PlaybackTargetSelectionResult | Promise<PlaybackTargetSelectionResult>;
}

export interface PlaybackTargetGroup {
  providerId: string;
  label: string;
  targets: PlaybackTarget[];
  error?: string;
}
