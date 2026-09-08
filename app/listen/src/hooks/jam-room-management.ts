import type { NavigateFunction } from "react-router";
import type { TFunction } from "i18next";
import { toast } from "sonner";

import type { AuthUser } from "@/contexts/auth-context";
import { api } from "@/lib/api";
import type { JamInvite, JamQueueMode, JamRoom } from "@/pages/jam-reducer";
import { formatRoomTagsInput, parseRoomTags } from "@/pages/jam-session-utils";

type RoomUpdateField = "visibility" | "permanent" | "metadata" | "queue_mode";
type SyncStatus = "idle" | "synced" | "drifting";
type ValueSetter<T> = (value: T) => void;
type RoomSetter = ValueSetter<
  JamRoom | null | ((prev: JamRoom | null) => JamRoom | null)
>;

export interface JamRoomManagementContext {
  t: TFunction;
  navigate: NavigateFunction;
  roomId: string | undefined;
  user: AuthUser | null;
  room: JamRoom | null;
  isHost: boolean;
  roomName: string;
  roomDescription: string;
  roomTagsInput: string;
  roomVisibility: "public" | "private";
  roomPermanent: boolean;
  roomQueueMode: JamQueueMode;
  roomAutoDjVoting: boolean;
  roomGenreFilters: string[];
  metadataDescription: string;
  metadataTagsInput: string;
  deleteTargetRoom: JamRoom | null;
  refetchRooms: () => void;
  setRoom: RoomSetter;
  setCreating: ValueSetter<boolean>;
  setJoiningRoomId: ValueSetter<string | null>;
  setUpdatingRoomField: ValueSetter<RoomUpdateField | null>;
  setMetadataDescription: ValueSetter<string>;
  setMetadataTagsInput: ValueSetter<string>;
  setMetadataModalOpen: ValueSetter<boolean>;
  setCreatingInvite: ValueSetter<boolean>;
  setInviteData: ValueSetter<JamInvite | null>;
  setInviteModalOpen: ValueSetter<boolean>;
  setEndingRoom: ValueSetter<boolean>;
  setSyncStatus: ValueSetter<SyncStatus>;
  setDeleteTargetRoom: ValueSetter<JamRoom | null>;
  setDeletingRoomId: ValueSetter<string | null>;
}

export function createJamRoomManagement({
  t,
  navigate,
  roomId,
  user,
  room,
  isHost,
  roomName,
  roomDescription,
  roomTagsInput,
  roomVisibility,
  roomPermanent,
  roomQueueMode,
  roomAutoDjVoting,
  roomGenreFilters,
  metadataDescription,
  metadataTagsInput,
  deleteTargetRoom,
  refetchRooms,
  setRoom,
  setCreating,
  setJoiningRoomId,
  setUpdatingRoomField,
  setMetadataDescription,
  setMetadataTagsInput,
  setMetadataModalOpen,
  setCreatingInvite,
  setInviteData,
  setInviteModalOpen,
  setEndingRoom,
  setSyncStatus,
  setDeleteTargetRoom,
  setDeletingRoomId,
}: JamRoomManagementContext) {
  async function handleCreateRoom() {
    const name = roomName.trim();
    if (!name) {
      toast.error(t("jam.toasts.roomNameRequired"));
      return;
    }
    setCreating(true);
    try {
      const created = await api<JamRoom>("/api/jam/rooms", "POST", {
        name,
        visibility: roomVisibility,
        is_permanent: roomPermanent,
        description: roomDescription.trim() || null,
        tags: parseRoomTags(roomTagsInput),
        queue_mode: roomQueueMode,
        auto_dj_voting: roomAutoDjVoting,
        genre_filters: roomGenreFilters,
      });
      navigate(`/jam/rooms/${created.id}`);
    } catch {
      toast.error(t("jam.toasts.createRoomFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinRoom(targetRoom: JamRoom) {
    if (
      targetRoom.is_member ??
      targetRoom.members.some((member) => member.user_id === user?.id)
    ) {
      navigate(`/jam/rooms/${targetRoom.id}`);
      return;
    }
    setJoiningRoomId(targetRoom.id);
    try {
      const joined = await api<{ room: JamRoom }>(
        `/api/jam/rooms/${targetRoom.id}/join`,
        "POST",
        {},
      );
      refetchRooms();
      navigate(`/jam/rooms/${joined.room.id}`);
    } catch {
      toast.error(t("jam.toasts.joinRoomFailed"));
    } finally {
      setJoiningRoomId(null);
    }
  }

  async function updateRoomSettings(
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
    field: "visibility" | "permanent" | "metadata" | "queue_mode",
  ) {
    if (!room || !isHost) return false;
    const previousRoom = room;
    setUpdatingRoomField(field);
    setRoom((current) => (current ? { ...current, ...patch } : current));
    try {
      const updated = await api<JamRoom>(
        `/api/jam/rooms/${room.id}`,
        "PATCH",
        patch,
      );
      setRoom((current) =>
        current ? { ...current, ...updated, ...patch } : updated,
      );
      toast.success(t("jam.toasts.roomSettingsUpdated"));
      return true;
    } catch {
      setRoom(previousRoom);
      toast.error(t("jam.toasts.roomSettingsUpdateFailed"));
      return false;
    } finally {
      setUpdatingRoomField(null);
    }
  }

  function openMetadataModal() {
    if (!room) return;
    setMetadataDescription(room.description || "");
    setMetadataTagsInput(formatRoomTagsInput(room.tags));
    setMetadataModalOpen(true);
  }

  async function saveRoomMetadata() {
    const updated = await updateRoomSettings(
      {
        description: metadataDescription.trim() || null,
        tags: parseRoomTags(metadataTagsInput),
      },
      "metadata",
    );
    if (updated) setMetadataModalOpen(false);
  }

  async function handleCreateInvite() {
    if (!room) return;
    setCreatingInvite(true);
    try {
      const invite = await api<JamInvite>(
        `/api/jam/rooms/${room.id}/invites`,
        "POST",
        {},
      );
      setInviteData(invite);
      setInviteModalOpen(true);
    } catch {
      toast.error(t("jam.toasts.createInviteFailed"));
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleEndRoom() {
    if (!room || !isHost) return;
    setEndingRoom(true);
    try {
      const updated = await api<JamRoom>(
        `/api/jam/rooms/${room.id}/end`,
        "POST",
        {},
      );
      setRoom(updated);
      setSyncStatus("idle");
      toast.success(t("jam.toasts.roomEnded"));
    } catch {
      toast.error(t("jam.toasts.roomEndFailed"));
    } finally {
      setEndingRoom(false);
    }
  }

  function requestDeleteRoom(targetRoom: JamRoom) {
    if (targetRoom.host_user_id !== user?.id) return;
    setDeleteTargetRoom(targetRoom);
  }

  async function confirmDeleteRoom() {
    const targetRoom = deleteTargetRoom;
    if (!targetRoom || targetRoom.host_user_id !== user?.id) return;
    setDeletingRoomId(targetRoom.id);
    try {
      await api<{ ok: boolean; room_id: string }>(
        `/api/jam/rooms/${targetRoom.id}`,
        "DELETE",
      );
      toast.success(t("jam.toasts.roomDeleted"));
      refetchRooms();
      setDeleteTargetRoom(null);
      if (roomId === targetRoom.id) navigate("/jam", { replace: true });
    } catch {
      toast.error(t("jam.toasts.roomDeleteFailed"));
    } finally {
      setDeletingRoomId(null);
    }
  }

  async function copyInviteLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("jam.toasts.inviteLinkCopied"));
    } catch {
      toast.error(t("jam.toasts.inviteLinkCopyFailed"));
    }
  }

  return {
    handleCreateRoom,
    handleJoinRoom,
    updateRoomSettings,
    openMetadataModal,
    saveRoomMetadata,
    handleCreateInvite,
    handleEndRoom,
    requestDeleteRoom,
    confirmDeleteRoom,
    copyInviteLink,
  };
}
