import type { ComponentProps } from "react";

import { JamRoomView } from "@/components/jam/JamRoomView";

type JamRoomViewProps = ComponentProps<typeof JamRoomView>;
type JamRoomHeroProps = JamRoomViewProps["hero"];
type JamMembersProps = JamRoomViewProps["members"];
type JamQueueProps = JamRoomViewProps["queue"];
type JamActivityProps = JamRoomViewProps["activity"];
type JamModalsProps = JamRoomViewProps["modals"];

export type JamSessionRoomViewInput = Pick<JamRoomHeroProps, "t" | "room"> &
  Omit<JamRoomHeroProps, "t" | "room"> &
  Omit<JamMembersProps, "t" | "room"> &
  Omit<JamQueueProps, "t" | "room"> &
  Omit<JamActivityProps, "t" | "room"> &
  Omit<JamModalsProps, "t" | "room">;

export function buildJamRoomViewProps(
  input: JamSessionRoomViewInput,
): JamRoomViewProps {
  const { t, room } = input;

  return {
    hero: {
      t,
      room,
      queueMode: input.queueMode,
      isConnected: input.isConnected,
      connectionProblem: input.connectionProblem,
      roomIsActive: input.roomIsActive,
      isHost: input.isHost,
      currentTrackAlreadyQueued: input.currentTrackAlreadyQueued,
      queuePrimaryActionLabel: input.queuePrimaryActionLabel,
      shareCurrentTrack: input.shareCurrentTrack,
      handlePlayRoomQueue: input.handlePlayRoomQueue,
      queueItems: input.queueItems,
      roomActionsOpen: input.roomActionsOpen,
      setRoomActionsOpen: input.setRoomActionsOpen,
      roomNowPlaying: input.roomNowPlaying,
      currentTime: input.currentTime,
      duration: input.duration,
      isPlaying: input.isPlaying,
      toggleRoomPlayback: input.toggleRoomPlayback,
      handlePlayNext: input.handlePlayNext,
      syncStatus: input.syncStatus,
      syncPlaybackState: input.syncPlaybackState,
      updatingRoomField: input.updatingRoomField,
      updateRoomSettings: input.updateRoomSettings,
      openMetadataModal: input.openMetadataModal,
      handleCreateInvite: input.handleCreateInvite,
      creatingInvite: input.creatingInvite,
      handleEndRoom: input.handleEndRoom,
      endingRoom: input.endingRoom,
      requestDeleteRoom: input.requestDeleteRoom,
      deletingRoomId: input.deletingRoomId,
    },
    members: {
      t,
      room,
      pendingRequests: input.pendingRequests,
      canManageQueue: input.canManageQueue,
      handleResolveRequest: input.handleResolveRequest,
    },
    queue: {
      t,
      room,
      queueMode: input.queueMode,
      isHost: input.isHost,
      queueItems: input.queueItems,
      updatingRoomField: input.updatingRoomField,
      roomIsActive: input.roomIsActive,
      toggleQueueMode: input.toggleQueueMode,
      enableAutoDj: input.enableAutoDj,
      autoDjSuggestions: input.autoDjSuggestions,
      queueSearchInputRef: input.queueSearchInputRef,
      queueSearch: input.queueSearch,
      setQueueSearch: input.setQueueSearch,
      canEditQueue: input.canEditQueue,
      queueSearchLoading: input.queueSearchLoading,
      queueSearchResults: input.queueSearchResults,
      addSearchTrackToRoom: input.addSearchTrackToRoom,
      queueSensors: input.queueSensors,
      handleQueueDragEnd: input.handleQueueDragEnd,
      canManageQueue: input.canManageQueue,
      canAddToQueue: input.canAddToQueue,
      isConnected: input.isConnected,
      handleVote: input.handleVote,
      handleMoveInRoomQueue: input.handleMoveInRoomQueue,
      handleRemoveFromRoomQueue: input.handleRemoveFromRoomQueue,
      focusQueueSearch: input.focusQueueSearch,
      queuePrimaryActionLabel: input.queuePrimaryActionLabel,
    },
    activity: {
      t,
      room,
      user: input.user,
    },
    modals: {
      t,
      deleteRoomModal: input.deleteRoomModal,
      metadataModalOpen: input.metadataModalOpen,
      setMetadataModalOpen: input.setMetadataModalOpen,
      metadataDescription: input.metadataDescription,
      setMetadataDescription: input.setMetadataDescription,
      metadataTagsInput: input.metadataTagsInput,
      setMetadataTagsInput: input.setMetadataTagsInput,
      updatingRoomField: input.updatingRoomField,
      saveRoomMetadata: input.saveRoomMetadata,
      inviteLink: input.inviteLink,
      inviteModalOpen: input.inviteModalOpen,
      setInviteModalOpen: input.setInviteModalOpen,
      copyInviteLink: input.copyInviteLink,
    },
  };
}
