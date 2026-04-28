import type { PlaySource } from "@/contexts/player-types";

export function getPlaySourceLabel(playSource: PlaySource | null): string | null {
  if (!playSource) return null;
  if (playSource.radio?.seedType === "discovery") return "Discovery Radio";
  const name = playSource.name?.trim();
  return name || null;
}
