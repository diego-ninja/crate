import { useMemo } from "react";

import { ItemActionMenu, ItemActionMenuButton, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { trackToMenuData } from "@/components/actions/shared";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import type { Track } from "@/contexts/PlayerContext";

interface PlayerTrackMenuProps {
  currentTrack: Track;
  duration?: number;
  onOverlayChange?: (open: boolean) => void;
  onAddToCollection?: () => Promise<void>;
  className?: string;
}

export function PlayerTrackMenu({ currentTrack, className }: PlayerTrackMenuProps) {
  const menuTrack = useMemo(() => trackToMenuData(currentTrack), [currentTrack]);
  const actions = useTrackActionEntries({
    track: menuTrack,
    albumCover: currentTrack.albumCover,
  });
  const actionMenu = useItemActionMenu(actions);

  return (
    <>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        className={className ?? "shrink-0 h-8 w-8"}
      />
      <ItemActionMenu
        actions={actions}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </>
  );
}
