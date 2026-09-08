import { PlayerBarCompactActionButtons } from "@/components/player/bar/PlayerBarCompactActionButtons";
import { PlayerBarDesktopActionButtons } from "@/components/player/bar/PlayerBarDesktopActionButtons";
import type { PlayerBarActionButtonsProps } from "@/components/player/bar/player-bar-action-types";

export function PlayerBarActionButtons(props: PlayerBarActionButtonsProps) {
  return (
    <>
      <PlayerBarDesktopActionButtons {...props} />
      <PlayerBarCompactActionButtons {...props} />
    </>
  );
}
