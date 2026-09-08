import { CRATE_ICON_SIZE, ListMusic, Maximize2 } from "@crate/ui/icons";

import { PlayerBarActionIconButton } from "@/components/player/bar/PlayerBarActionIconButton";
import type { PlayerBarActionButtonsProps } from "@/components/player/bar/player-bar-action-types";

type PlayerBarCompactActionButtonsProps = Pick<
  PlayerBarActionButtonsProps,
  | "t"
  | "visibility"
  | "onToggleQueue"
  | "onPrepareQueue"
  | "onToggleExtendedPlayer"
  | "onPrepareExtendedPlayer"
>;

export function PlayerBarCompactActionButtons({
  t,
  visibility,
  onToggleQueue,
  onPrepareQueue,
  onToggleExtendedPlayer,
  onPrepareExtendedPlayer,
}: PlayerBarCompactActionButtonsProps) {
  const { extendedOpen, showQueue, isRemoteConnectActive } = visibility;

  return (
    <div className="hidden items-center gap-1 md:flex lg:hidden">
      {!extendedOpen && (
        <PlayerBarActionIconButton
          onClick={onToggleQueue}
          onPrepare={onPrepareQueue}
          label={t("player.queue")}
          active={showQueue}
        >
          <ListMusic size={CRATE_ICON_SIZE.md} />
        </PlayerBarActionIconButton>
      )}
      {!isRemoteConnectActive && (
        <PlayerBarActionIconButton
          onClick={onToggleExtendedPlayer}
          onPrepare={onPrepareExtendedPlayer}
          label={t("player.expand")}
          active={extendedOpen}
        >
          <Maximize2 size={CRATE_ICON_SIZE.md} />
        </PlayerBarActionIconButton>
      )}
    </div>
  );
}
