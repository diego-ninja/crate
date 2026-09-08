import { type Dispatch, type SetStateAction } from "react";
import type { TFunction } from "i18next";

import type { Track } from "@/contexts/PlayerContext";
import type { JamQueueItem, JamQueueMode, JamRoom } from "@/pages/jam-reducer";

export type RoomUpdateField =
  | "visibility"
  | "permanent"
  | "metadata"
  | "queue_mode";

export type UpdateRoomSettings = (
  patch: Partial<
    Pick<
      JamRoom,
      | "name"
      | "visibility"
      | "is_permanent"
      | "description"
      | "tags"
      | "queue_mode"
      | "auto_dj_voting"
      | "genre_filters"
    >
  >,
  field: RoomUpdateField,
) => Promise<boolean>;

export interface JamRoomHeroProps {
  t: TFunction;
  room: JamRoom;
  queueMode: JamQueueMode;
  isConnected: boolean;
  connectionProblem: string | null;
  roomIsActive: boolean;
  isHost: boolean;
  currentTrackAlreadyQueued: boolean;
  queuePrimaryActionLabel: string;
  shareCurrentTrack: () => void;
  handlePlayRoomQueue: () => void;
  queueItems: JamQueueItem[];
  roomActionsOpen: boolean;
  setRoomActionsOpen: Dispatch<SetStateAction<boolean>>;
  roomNowPlaying: Track | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  toggleRoomPlayback: () => void;
  handlePlayNext: () => void;
  syncStatus: "idle" | "synced" | "drifting";
  syncPlaybackState: () => void;
  updatingRoomField: RoomUpdateField | null;
  updateRoomSettings: UpdateRoomSettings;
  openMetadataModal: () => void;
  handleCreateInvite: () => void | Promise<void>;
  creatingInvite: boolean;
  handleEndRoom: () => void | Promise<void>;
  endingRoom: boolean;
  requestDeleteRoom: (room: JamRoom) => void;
  deletingRoomId: string | null;
}
