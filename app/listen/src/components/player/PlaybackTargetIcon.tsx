import {
  Airplay,
  Cast,
  CRATE_ICON_SIZE,
  MonitorSpeaker,
  RadioTower,
} from "@crate/ui/icons";

import type { PlaybackTarget } from "@/lib/playback-targets";

export function PlaybackTargetIcon({ target }: { target: PlaybackTarget }) {
  if (target.kind === "google-cast") return <Cast size={CRATE_ICON_SIZE.md} />;
  if (target.kind === "airplay") return <Airplay size={CRATE_ICON_SIZE.md} />;
  if (target.kind === "crate-device") {
    return <RadioTower size={CRATE_ICON_SIZE.md} />;
  }
  return <MonitorSpeaker size={CRATE_ICON_SIZE.md} />;
}
