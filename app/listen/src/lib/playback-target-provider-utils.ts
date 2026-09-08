import {
  CRATE_CONNECT_V2_TRANSPORT_ENABLED,
  isCrateConnectEnabled,
} from "@/lib/crate-connect";
import { formatCrateDeviceName } from "@/lib/listen-device";
import type {
  PlaybackTargetConnectInstance,
  PlaybackTargetContext,
} from "./playback-target-types";

export function isLegacyCrateConnectEnabled(): boolean {
  return isCrateConnectEnabled() && !CRATE_CONNECT_V2_TRANSPORT_ENABLED;
}

export function isWsCrateConnectContext(
  context?: PlaybackTargetContext,
): context is PlaybackTargetContext & {
  connect: NonNullable<PlaybackTargetContext["connect"]>;
} {
  return context?.connect?.transport === "ws";
}

export function capabilityFlag(
  capabilities: Record<string, unknown> | null | undefined,
  key: string,
  fallback: boolean,
): boolean {
  const value = capabilities?.[key];
  return typeof value === "boolean" ? value : fallback;
}

export function connectInstanceName(
  instance: PlaybackTargetConnectInstance,
): string {
  return formatCrateDeviceName(instance);
}

export function visibleInstanceNames(
  instances: PlaybackTargetConnectInstance[],
): Map<string, string> {
  const totals = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const instance of instances) {
    const name = connectInstanceName(instance);
    totals.set(name, (totals.get(name) ?? 0) + 1);
  }
  const names = new Map<string, string>();
  for (const instance of instances) {
    const name = connectInstanceName(instance);
    const total = totals.get(name) ?? 1;
    const index = (seen.get(name) ?? 0) + 1;
    seen.set(name, index);
    names.set(instance.instance_id, total > 1 ? `${name} (${index})` : name);
  }
  return names;
}
