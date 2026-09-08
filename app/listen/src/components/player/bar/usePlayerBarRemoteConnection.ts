import { useMemo } from "react";
import type { PlayerConnectValue } from "@/contexts/player-context";
import { usePlayerBarConnectSession } from "@/components/player/bar/usePlayerBarConnectSession";
import { usePlayerBarRemoteProjection } from "@/components/player/bar/usePlayerBarRemoteProjection";
import { useCrateConnectEnabled } from "@/hooks/use-crate-connect-enabled";
import { CRATE_CONNECT_V2_TRANSPORT_ENABLED } from "@/lib/crate-connect";
import { getListenDeviceId } from "@/lib/listen-device";

type UsePlayerBarRemoteConnectionOptions = {
  isPlaying: boolean;
  displayedTime: number;
  displayedDuration: number;
  volume: number;
  connect: PlayerConnectValue;
};

export function usePlayerBarRemoteConnection({
  isPlaying,
  displayedTime,
  displayedDuration,
  volume,
  connect,
}: UsePlayerBarRemoteConnectionOptions) {
  const connectEnabled = useCrateConnectEnabled();
  const legacyConnectEnabled =
    connectEnabled && !CRATE_CONNECT_V2_TRANSPORT_ENABLED;
  const currentConnectDeviceId = useMemo(() => getListenDeviceId(), []);
  const session = usePlayerBarConnectSession({ legacyConnectEnabled });

  const projection = usePlayerBarRemoteProjection({
    isPlaying,
    displayedTime,
    displayedDuration,
    volume,
    connect,
    currentConnectDeviceId,
    legacyConnectEnabled,
    ...session,
  });

  return {
    ...projection,
    updateActiveConnectStatus: session.updateActiveConnectStatus,
  };
}
