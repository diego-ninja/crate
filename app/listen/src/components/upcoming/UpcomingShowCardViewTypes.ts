import type { MouseEvent as ReactMouseEvent, RefObject } from "react";

import type { UpcomingItem } from "./upcoming-model";

export interface ActionMenuSlot {
  triggerRef: RefObject<HTMLButtonElement | null>;
  hasActions: boolean;
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

export interface CollapsedViewProps {
  item: UpcomingItem;
  attending: boolean;
  savingAttendance: boolean;
  actionMenu: ActionMenuSlot;
  onToggleAttendance: () => void;
}

export interface ExpandedViewProps {
  item: UpcomingItem;
  attending: boolean;
  savingAttendance: boolean;
  playingSetlist: boolean;
  onToggleAttendance: () => void;
  onPlaySetlist: () => void;
  onClose: () => void;
  showClose?: boolean;
}
