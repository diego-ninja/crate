import type { RefObject, MouseEvent } from "react";

import type { ContextMenuEntry } from "@/components/actions/ItemActionMenu";
import type { AlbumData } from "@/pages/album-types";
import type { OfflineItemState } from "@/lib/offline";
import type { UseContextMenuControllerReturn } from "@crate/ui/domain/actions";

export const SECONDARY_ACTION_CLASS =
  "flex min-h-14 min-w-[56px] shrink-0 touch-manipulation flex-col items-center justify-center gap-1 px-1.5 py-1 text-[11px] font-medium text-text-primary/62 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-hover disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:drop-shadow-none";

export interface AlbumActionState {
  isPreRelease: boolean;
  canPersistAlbum: boolean;
  canSaveAlbum: boolean;
  offlineSupported: boolean;
  offlineState: OfflineItemState;
  offlineBusy: boolean;
  offlineButtonLabel: string;
  offlineStatusDetail: string | null;
  saved: boolean;
  remoteOnly: boolean;
  isDesktop: boolean;
  playerTracksAvailable: boolean;
}

export interface AlbumActionHandlers {
  onAlbumRadio: () => void;
  onToggleOffline: () => void;
  onToggleSaved: () => void;
  onShare: () => void;
  onPlay: () => void;
  onShuffle: () => void;
  onCloseAlbumMenu: () => void;
  onToggleAlbumMenu: (event: MouseEvent<HTMLButtonElement>) => void;
}

export interface AlbumActionMenu {
  controller: UseContextMenuControllerReturn<HTMLButtonElement>;
  items: ContextMenuEntry[];
  primaryRef: RefObject<HTMLDivElement | null>;
}

export interface AlbumActionData {
  data: AlbumData;
  coverUrl: string;
  displayName: string;
  globalAlbumUid: string | null;
}
