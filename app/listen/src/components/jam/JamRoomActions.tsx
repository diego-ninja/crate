import {
  Globe2,
  ListMusic,
  Lock,
  Pin,
  Power,
  Share2,
  Trash2,
} from "@crate/ui/icons";

import type { JamRoomHeroProps } from "./JamRoomHeroSections";
import { HeroActionButton } from "./JamHeroButtons";

type JamRoomActionsProps = Pick<
  JamRoomHeroProps,
  | "t"
  | "room"
  | "roomActionsOpen"
  | "isHost"
  | "updatingRoomField"
  | "roomIsActive"
  | "updateRoomSettings"
  | "openMetadataModal"
  | "handleCreateInvite"
  | "creatingInvite"
  | "handleEndRoom"
  | "endingRoom"
  | "requestDeleteRoom"
  | "deletingRoomId"
>;

export function JamRoomActions(props: JamRoomActionsProps) {
  const {
    t,
    room,
    roomActionsOpen,
    isHost,
    updatingRoomField,
    roomIsActive,
    updateRoomSettings,
    openMetadataModal,
    handleCreateInvite,
    creatingInvite,
    handleEndRoom,
    endingRoom,
    requestDeleteRoom,
    deletingRoomId,
  } = props;

  return (
    <>
      {roomActionsOpen && isHost ? (
        <div className="jam-room-actions-panel flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium text-text-primary">
              {t("jam.room.actions.editProfile")}
            </div>
            <div className="mt-0.5 text-xs text-text-muted">
              {t("jam.room.members")} · {room.members.length}
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            <HeroActionButton
              label={
                room.visibility === "public"
                  ? t("jam.room.actions.makeInviteOnly")
                  : t("jam.room.actions.makePublic")
              }
              onClick={() =>
                void updateRoomSettings(
                  {
                    visibility:
                      room.visibility === "public" ? "private" : "public",
                  },
                  "visibility",
                )
              }
              disabled={updatingRoomField !== null || !roomIsActive}
              loading={updatingRoomField === "visibility"}
            >
              {room.visibility === "public" ? (
                <Lock size={16} />
              ) : (
                <Globe2 size={16} />
              )}
            </HeroActionButton>
            <HeroActionButton
              label={
                room.is_permanent
                  ? t("jam.room.actions.unpinPermanent")
                  : t("jam.room.actions.makePermanent")
              }
              onClick={() =>
                void updateRoomSettings(
                  { is_permanent: !room.is_permanent },
                  "permanent",
                )
              }
              disabled={updatingRoomField !== null || !roomIsActive}
              loading={updatingRoomField === "permanent"}
            >
              <Pin size={16} />
            </HeroActionButton>
            <HeroActionButton
              label={t("jam.room.actions.editProfile")}
              onClick={openMetadataModal}
              disabled={updatingRoomField !== null}
              loading={updatingRoomField === "metadata"}
            >
              <ListMusic size={16} />
            </HeroActionButton>
            <HeroActionButton
              label={t("jam.room.actions.invitePeople")}
              onClick={handleCreateInvite}
              disabled={!roomIsActive}
              loading={creatingInvite}
            >
              <Share2 size={16} />
            </HeroActionButton>
            <HeroActionButton
              label={t("jam.room.actions.endRoom")}
              onClick={handleEndRoom}
              disabled={!roomIsActive}
              loading={endingRoom}
              className="jam-danger-control"
            >
              <Power size={16} />
            </HeroActionButton>
            <HeroActionButton
              label={t("jam.delete.title")}
              onClick={() => requestDeleteRoom(room)}
              disabled={deletingRoomId === room.id}
              loading={deletingRoomId === room.id}
              className="jam-danger-control"
            >
              <Trash2 size={16} />
            </HeroActionButton>
          </div>
        </div>
      ) : null}
    </>
  );
}
