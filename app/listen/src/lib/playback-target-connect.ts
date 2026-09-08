import {
  fetchActiveConnectSession,
  fetchConnectDevices,
  transferPlaybackToDevice,
  type ConnectDevice,
} from "@/lib/crate-connect";
import { formatCrateDeviceName, getListenDeviceId } from "@/lib/listen-device";
import {
  capabilityFlag,
  connectInstanceName,
  isLegacyCrateConnectEnabled,
  isWsCrateConnectContext,
  visibleInstanceNames,
} from "./playback-target-provider-utils";
import type { PlaybackTargetProvider } from "./playback-target-types";

function connectDeviceName(device: ConnectDevice): string {
  return formatCrateDeviceName(device);
}

function connectDeviceUnavailableReason(device: ConnectDevice): string {
  if (device.capabilities?.can_play === false) {
    return "Playback is not available on this device.";
  }
  if (device.capabilities?.can_receive_commands !== true) {
    return "This device cannot receive transfer commands yet.";
  }
  return "Crate Connect transfer is unavailable.";
}

export const crateConnectTargetProvider: PlaybackTargetProvider = {
  id: "crate-connect",
  label: "Crate devices",
  getTargets: async (context) => {
    if (isWsCrateConnectContext(context)) {
      const { activeInstanceId, connectedInstances, playbackInstanceId } =
        context.connect;
      const instances = connectedInstances.filter(
        (instance) => instance.instance_id !== playbackInstanceId,
      );
      const names = visibleInstanceNames(instances);
      return instances.map((instance) => {
        const canPlay = capabilityFlag(instance.capabilities, "can_play", true);
        const active = activeInstanceId === instance.instance_id;
        return {
          id: `crate-instance:${instance.instance_id}`,
          providerId: "crate-connect",
          kind: "crate-device" as const,
          name:
            names.get(instance.instance_id) ?? connectInstanceName(instance),
          subtitle: active
            ? "Playing through Crate Connect"
            : "Connected Crate instance",
          active,
          available: canPlay,
          unavailableReason: canPlay
            ? undefined
            : "Playback is not available on this instance.",
          capabilities: {
            canPlay,
            canSeek: canPlay,
            canSetVolume: capabilityFlag(
              instance.capabilities,
              "can_set_volume",
              true,
            ),
          },
        };
      });
    }
    if (!isLegacyCrateConnectEnabled()) return [];
    const currentDeviceId = getListenDeviceId();
    const activeConnectDeviceId = context?.activeConnectDeviceId;
    const response = await fetchConnectDevices();
    return response.devices.reduce<
      import("./playback-target-types").PlaybackTarget[]
    >((targets, device) => {
      if (device.device_id === currentDeviceId) return targets;
      const available =
        device.capabilities?.can_play !== false &&
        device.capabilities?.can_receive_commands === true;
      const active = activeConnectDeviceId === device.device_id;
      targets.push({
        id: `crate:${device.device_id}`,
        providerId: "crate-connect",
        kind: "crate-device" as const,
        name: connectDeviceName(device),
        subtitle: active
          ? "Playing through Crate Connect"
          : device.active
            ? "Active Crate device"
            : "Recent Crate device",
        active,
        available,
        unavailableReason: available
          ? undefined
          : connectDeviceUnavailableReason(device),
        capabilities: {
          canPlay: device.capabilities?.can_play !== false,
          canSeek: available,
          canSetVolume: device.capabilities?.can_set_volume === true,
        },
      });
      return targets;
    }, []);
  },
  selectTarget: async (target, context) => {
    if (isWsCrateConnectContext(context)) {
      if (!target.available) {
        return {
          ok: false,
          message:
            target.unavailableReason ||
            "Crate Connect transfer is unavailable.",
        };
      }
      const targetInstanceId = target.id.replace(/^crate-instance:/, "");
      if (targetInstanceId === context.connect.activeInstanceId) {
        return { ok: true, message: `Already playing on ${target.name}.` };
      }
      const sent = context.connect.requestTransfer(targetInstanceId);
      return sent
        ? { ok: true, message: `Playing on ${target.name}.` }
        : { ok: false, message: "Crate Connect is still connecting." };
    }
    if (!isLegacyCrateConnectEnabled()) {
      return {
        ok: false,
        message: "Crate Connect is disabled in Settings.",
      };
    }
    if (!target.available) {
      return {
        ok: false,
        message:
          target.unavailableReason || "Crate Connect transfer is unavailable.",
      };
    }
    const targetDeviceId = target.id.replace(/^crate:/, "");
    const freshSession = await fetchActiveConnectSession().catch(() => null);
    const activeDeviceId =
      freshSession?.active_device_id || context?.activeConnectDeviceId;
    if (targetDeviceId === activeDeviceId) {
      return { ok: true, message: `Already playing on ${target.name}.` };
    }
    await context?.publishConnectState?.();
    await transferPlaybackToDevice(targetDeviceId, {
      sourceDeviceId: activeDeviceId || getListenDeviceId(),
      startPlaying: true,
    });
    return { ok: true, message: `Playing on ${target.name}.` };
  },
};
