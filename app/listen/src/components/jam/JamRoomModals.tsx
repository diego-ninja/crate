import type { ReactNode } from "react";
import type { TFunction } from "i18next";

import {
  JamRoomInviteModal,
  JamRoomMetadataModal,
} from "./JamRoomModalSections";

export interface JamRoomModalsProps {
  t: TFunction;
  deleteRoomModal: ReactNode;
  metadataModalOpen: boolean;
  setMetadataModalOpen: (value: boolean) => void;
  metadataDescription: string;
  setMetadataDescription: (value: string) => void;
  metadataTagsInput: string;
  setMetadataTagsInput: (value: string) => void;
  updatingRoomField:
    | "visibility"
    | "permanent"
    | "metadata"
    | "queue_mode"
    | null;
  saveRoomMetadata: () => void | Promise<void>;
  inviteLink: string | null;
  inviteModalOpen: boolean;
  setInviteModalOpen: (value: boolean) => void;
  copyInviteLink: (link: string) => void | Promise<void>;
}

export function JamRoomModals(props: JamRoomModalsProps) {
  return (
    <>
      {props.deleteRoomModal}
      <JamRoomMetadataModal {...props} />
      <JamRoomInviteModal {...props} />
    </>
  );
}
