import { type ComponentProps, type RefObject } from "react";
import { type DndContext, type DragEndEvent } from "@dnd-kit/core";
import type { TFunction } from "i18next";

import type { Track } from "@/contexts/PlayerContext";
import type {
  JamQueueItem,
  JamQueueMode,
  JamRoom,
  SearchTrack,
} from "@/pages/jam-reducer";

export interface JamQueuePanelProps {
  t: TFunction;
  room: JamRoom;
  queueMode: JamQueueMode;
  isHost: boolean;
  queueItems: JamQueueItem[];
  updatingRoomField:
    | "visibility"
    | "permanent"
    | "metadata"
    | "queue_mode"
    | null;
  roomIsActive: boolean;
  toggleQueueMode: () => void;
  enableAutoDj: () => void;
  autoDjSuggestions: Track[];
  queueSearchInputRef: RefObject<HTMLInputElement | null>;
  queueSearch: string;
  setQueueSearch: (value: string) => void;
  canEditQueue: boolean;
  queueSearchLoading: boolean;
  queueSearchResults: SearchTrack[];
  addSearchTrackToRoom: (track: SearchTrack) => void;
  queueSensors: ComponentProps<typeof DndContext>["sensors"];
  handleQueueDragEnd: (event: DragEndEvent) => void;
  canManageQueue: boolean;
  canAddToQueue: boolean;
  isConnected: boolean;
  handleVote: (item: JamQueueItem) => void;
  handleMoveInRoomQueue: (
    queueItemId: string,
    fromIndex: number,
    toIndex: number,
  ) => void;
  handleRemoveFromRoomQueue: (queueItemId: string) => void;
  focusQueueSearch: () => void;
  queuePrimaryActionLabel: string;
}
