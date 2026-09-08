import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useTranslation } from "react-i18next";
import {
  usePlayerActions,
  usePlayerProgress,
  usePlayerState,
} from "@/contexts/PlayerContext";
import { useAuth } from "@/contexts/AuthContext";
import { useJamLobbyFormState } from "@/hooks/use-jam-lobby-form-state";
import { useJamSessionPlayerRefs } from "@/hooks/use-jam-session-player-refs";
import { useJamSessionRoomQueries } from "@/hooks/use-jam-session-room-queries";
import { JamDeleteRoomModal } from "@/components/jam/JamDeleteRoomModal";
import { createJamRoomManagement } from "@/hooks/jam-room-management";
import { deriveJamRoomViewModel } from "@/hooks/jam-room-view-model";
import { useJamRoomActions } from "@/hooks/use-jam-room-actions";
import { useJamPlaybackEffects } from "@/hooks/use-jam-playback-effects";
import { useJamSessionLifecycle } from "@/hooks/use-jam-session-lifecycle";
import { useJamSessionState } from "@/hooks/use-jam-session-state";
import { useJamWebSocket } from "@/hooks/use-jam-websocket";
import { buildJamRoomViewProps } from "@/hooks/jam-session-view-props";
import type { JamRoom } from "@/pages/jam-reducer";

export function useJamSessionController() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { roomId } = useParams<{ roomId: string }>();
  const { user } = useAuth();
  const {
    roomQueueMode,
    setRoomQueueMode,
    roomGenreFiltersInput,
    setRoomGenreFiltersInput,
    roomGenreFilters,
    genreSuggestionIndex,
    setGenreSuggestionIndex,
    roomAutoDjVoting,
    setRoomAutoDjVoting,
    selectGenre,
    removeGenre,
  } = useJamLobbyFormState();
  const [roomActionsOpen, setRoomActionsOpen] = useState(false);
  const queueSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const { currentTime, duration } = usePlayerProgress();
  const { isPlaying } = usePlayerState();
  const {
    currentTrack,
    play,
    playAll,
    pause,
    resume,
    seek,
    setPlaybackRate,
    enterJamSession,
    leaveJamSession,
    syncJamQueue,
    playSource,
  } = usePlayerActions();
  const {
    state,
    dispatch,
    setRoomSearch,
    setRoom,
    setRoomName,
    setRoomDescription,
    setRoomTagsInput,
    setRoomVisibility,
    setRoomPermanent,
    setCreating,
    setJoiningRoomId,
    setInviteInput,
    setInviteData,
    setCreatingInvite,
    setInviteModalOpen,
    setMetadataModalOpen,
    setMetadataDescription,
    setMetadataTagsInput,
    setEndingRoom,
    setDeletingRoomId,
    setDeleteTargetRoom,
    setUpdatingRoomField,
    setQueueSearch,
    setQueueSearchResults,
    setSyncStatus,
  } = useJamSessionState();

  const {
    roomSearch,
    room,
    roomName,
    roomDescription,
    roomTagsInput,
    roomVisibility,
    roomPermanent,
    creating,
    joiningRoomId,
    inviteInput,
    inviteData,
    creatingInvite,
    inviteModalOpen,
    metadataModalOpen,
    metadataDescription,
    metadataTagsInput,
    endingRoom,
    deletingRoomId,
    deleteTargetRoom,
    updatingRoomField,
    queueSearch,
    queueSearchResults,
    queueSearchLoading,
    queueItems,
    pendingRequests,
    syncStatus,
    isConnected,
    connectionProblem,
  } = state;

  const {
    data,
    loading,
    error,
    loading: roomsLoading,
    refetchRooms,
    taxonomyLoading,
    genreSuggestions,
    selectedGenreItems,
    memberRooms,
    publicRooms,
  } = useJamSessionRoomQueries({
    roomId,
    roomQueueMode,
    roomGenreFilters,
    roomGenreFiltersInput,
    roomSearch,
    userId: user?.id,
  });

  const roomNameRef = useRef<string>("Jam session");
  const queueSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setGenreSuggestionIndex((current) =>
      genreSuggestions.length
        ? Math.min(current, genreSuggestions.length - 1)
        : 0,
    );
  }, [genreSuggestions, setGenreSuggestionIndex]);

  const {
    isHost,
    roomIsActive,
    queueMode,
    canManageQueue,
    canAddToQueue,
    canSuggestTrack,
    canEditQueue,
    roomCurrentTrack,
    roomNowPlaying,
    currentTrackAlreadyQueued,
    autoDjSuggestions,
    queuePrimaryActionLabel,
  } = deriveJamRoomViewModel({
    room,
    user,
    currentTrack,
    queueItems,
    t,
  });

  const jamPlayerActions = useMemo(
    () => ({
      play,
      playAll,
      pause,
      resume,
      seek,
      setPlaybackRate,
      syncJamQueue,
      currentTrack,
      isPlaying,
      playSource,
    }),
    [
      currentTrack,
      isPlaying,
      pause,
      play,
      playAll,
      playSource,
      resume,
      seek,
      setPlaybackRate,
      syncJamQueue,
    ],
  );
  const { playerActionsRef, currentTimeRef } = useJamSessionPlayerRefs({
    actions: jamPlayerActions,
    currentTime,
  });

  useJamSessionLifecycle({
    roomId,
    room,
    data,
    isConnected,
    roomIsActive: Boolean(roomIsActive),
    queueItems,
    queueSearch,
    canEditQueue: Boolean(canEditQueue),
    roomNameRef,
    playerActionsRef,
    dispatch,
    enterJamSession,
    leaveJamSession,
  });

  const { sendEvent } = useJamWebSocket({
    roomId,
    userId: user?.id,
    dispatch,
    playerActionsRef,
    currentTimeRef,
    roomNameRef,
  });

  useJamPlaybackEffects({
    roomId,
    roomIsActive: Boolean(roomIsActive),
    isConnected,
    isHost,
    isPlaying,
    currentTrack,
    roomCurrentTrack,
    queueItems,
    currentTime,
    duration,
    playerActionsRef,
    currentTimeRef,
    sendEvent,
    setSyncStatus,
  });

  const {
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
  } = createJamRoomManagement({
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
  });

  const {
    shareCurrentTrack,
    addSearchTrackToRoom,
    syncPlaybackState,
    handlePlayRoomQueue,
    toggleRoomPlayback,
    focusQueueSearch,
    handlePlayNext,
    handleRemoveFromRoomQueue,
    handleMoveInRoomQueue,
    handleQueueDragEnd,
    handleVote,
    handleResolveRequest,
    toggleQueueMode,
    enableAutoDj,
  } = useJamRoomActions({
    t,
    currentTrack,
    roomCurrentTrack,
    currentTime,
    isPlaying,
    isHost,
    roomIsActive,
    isConnected,
    canSuggestTrack,
    canAddToQueue,
    currentTrackAlreadyQueued,
    queueItems,
    room,
    queueMode,
    canManageQueue,
    queueSearchInputRef,
    sendEvent,
    dispatch,
    setQueueSearch,
    setQueueSearchResults,
    setSyncStatus,
    resume,
    pause,
    updateRoomSettings,
  });

  const deleteRoomModal = (
    <JamDeleteRoomModal
      t={t}
      deleteTargetRoom={deleteTargetRoom}
      deletingRoomId={deletingRoomId}
      setDeleteTargetRoom={setDeleteTargetRoom}
      confirmDeleteRoom={confirmDeleteRoom}
    />
  );

  const lobbyViewProps = {
    roomName,
    setRoomName,
    roomDescription,
    setRoomDescription,
    roomTagsInput,
    setRoomTagsInput,
    roomQueueMode,
    onRoomQueueModeChange: setRoomQueueMode,
    roomGenreFiltersInput,
    setRoomGenreFiltersInput,
    genreSuggestionIndex,
    setGenreSuggestionIndex,
    selectedGenreItems,
    removeGenre,
    genreSuggestions,
    taxonomyLoading,
    selectGenre,
    roomAutoDjVoting,
    setRoomAutoDjVoting,
    roomVisibility,
    setRoomVisibility,
    roomPermanent,
    setRoomPermanent,
    creating,
    onCreateRoom: () => void handleCreateRoom(),
    inviteInput,
    setInviteInput,
    roomsLoading,
    roomSearch,
    setRoomSearch,
    memberRooms,
    publicRooms,
    user,
    joiningRoomId,
    deletingRoomId,
    onJoinRoom: (target: JamRoom) => void handleJoinRoom(target),
    onDeleteRoom: requestDeleteRoom,
    deleteRoomModal,
  };

  const roomViewProps = buildJamRoomViewProps({
    t,
    room: room as JamRoom,
    queueMode,
    isConnected,
    connectionProblem,
    roomIsActive: Boolean(roomIsActive),
    isHost,
    currentTrackAlreadyQueued,
    queuePrimaryActionLabel,
    shareCurrentTrack,
    handlePlayRoomQueue,
    queueItems,
    roomActionsOpen,
    setRoomActionsOpen,
    roomNowPlaying: roomNowPlaying ?? null,
    currentTime,
    duration,
    isPlaying,
    toggleRoomPlayback,
    handlePlayNext,
    syncStatus,
    syncPlaybackState,
    updatingRoomField,
    updateRoomSettings,
    openMetadataModal,
    handleCreateInvite,
    creatingInvite,
    handleEndRoom,
    endingRoom,
    requestDeleteRoom,
    deletingRoomId,
    pendingRequests,
    handleResolveRequest,
    toggleQueueMode,
    enableAutoDj,
    autoDjSuggestions,
    queueSearchInputRef,
    queueSearch,
    setQueueSearch,
    canEditQueue: Boolean(canEditQueue),
    queueSearchLoading,
    queueSearchResults,
    addSearchTrackToRoom,
    queueSensors,
    handleQueueDragEnd,
    canManageQueue: Boolean(canManageQueue),
    canAddToQueue: Boolean(canAddToQueue),
    handleVote,
    handleMoveInRoomQueue,
    handleRemoveFromRoomQueue,
    focusQueueSearch,
    user,
    deleteRoomModal,
    metadataModalOpen,
    setMetadataModalOpen,
    metadataDescription,
    setMetadataDescription,
    metadataTagsInput,
    setMetadataTagsInput,
    saveRoomMetadata,
    inviteLink: inviteData
      ? `${window.location.origin}${inviteData.join_url}`
      : null,
    inviteModalOpen,
    setInviteModalOpen,
    copyInviteLink,
  });

  return {
    t,
    roomId,
    loading,
    error,
    room,
    lobbyViewProps,
    roomViewProps,
  };
}
