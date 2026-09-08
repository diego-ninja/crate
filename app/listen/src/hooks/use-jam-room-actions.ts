import { type Dispatch, type RefObject } from "react";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import type { DragEndEvent } from "@dnd-kit/core";

import type { Track } from "@/contexts/PlayerContext";
import type {
  JamQueueItem,
  JamQueueMode,
  JamRoom,
  JamSessionAction,
  SearchTrack,
} from "@/pages/jam-reducer";
import { tracksMatch as playerTracksMatch } from "@/contexts/player-session";
import { searchTrackToTrack, trackToPayload } from "@/pages/jam-session-utils";

type SendJamEvent = (payload: Record<string, unknown>) => boolean;
type UpdateRoomSettings = (
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
) => Promise<boolean>;

export function useJamRoomActions({
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
}: {
  t: TFunction;
  currentTrack: Track | undefined;
  roomCurrentTrack: Track | null;
  currentTime: number;
  isPlaying: boolean;
  isHost: boolean;
  roomIsActive: boolean | undefined;
  isConnected: boolean;
  canSuggestTrack: boolean | undefined;
  canAddToQueue: boolean | undefined;
  currentTrackAlreadyQueued: boolean;
  queueItems: JamQueueItem[];
  room: JamRoom | null;
  queueMode: JamQueueMode;
  canManageQueue: boolean | undefined;
  queueSearchInputRef: RefObject<HTMLInputElement | null>;
  sendEvent: SendJamEvent;
  dispatch: Dispatch<JamSessionAction>;
  setQueueSearch: (value: string) => void;
  setQueueSearchResults: (value: SearchTrack[]) => void;
  setSyncStatus: (value: "idle" | "synced" | "drifting") => void;
  resume: () => void;
  pause: () => void;
  updateRoomSettings: UpdateRoomSettings;
}) {
  function shareCurrentTrack() {
    if (!canSuggestTrack) {
      toast.error(t("jam.toasts.queuePermissionDenied"));
      return;
    }
    if (!currentTrack) {
      toast.info(t("jam.toasts.playSomethingFirst"));
      return;
    }
    if (currentTrackAlreadyQueued) {
      toast.info(t("jam.toasts.trackAlreadyInQueue"));
      return;
    }
    const sent = sendEvent({
      type: canAddToQueue ? "queue_add" : "track_request",
      track: trackToPayload(currentTrack),
      source: "current_track",
    });
    if (sent) {
      toast.success(
        t(
          canAddToQueue
            ? "jam.toasts.sharedTrack"
            : "jam.toasts.requestedTrack",
          { title: currentTrack.title },
        ),
      );
    }
  }

  function addSearchTrackToRoom(track: SearchTrack) {
    if (!canSuggestTrack) {
      toast.error(t("jam.toasts.queuePermissionDenied"));
      return;
    }
    const playable = searchTrackToTrack(track);
    if (queueItems.some((item) => playerTracksMatch(item.track, playable))) {
      toast.info(t("jam.toasts.trackAlreadyInQueue"));
      return;
    }
    const sent = sendEvent({
      type: canAddToQueue ? "queue_add" : "track_request",
      track: trackToPayload(playable),
      source: "search",
    });
    if (sent) {
      toast.success(
        t(
          canAddToQueue ? "jam.toasts.addedTrack" : "jam.toasts.requestedTrack",
          { title: playable.title },
        ),
      );
      setQueueSearch("");
      setQueueSearchResults([]);
    }
  }

  function syncPlaybackState() {
    const activeTrack = roomCurrentTrack || currentTrack;
    if (!activeTrack) {
      toast.info(t("jam.toasts.noCurrentTrackToSync"));
      return;
    }
    if (
      sendEvent({
        type: "sync",
        scope: "room",
        track: trackToPayload(activeTrack),
        position: Math.max(0, currentTime),
        playing: isPlaying,
      })
    ) {
      setSyncStatus(isPlaying ? "synced" : "idle");
      toast.success(
        isPlaying
          ? t("jam.toasts.syncedPlayback")
          : t("jam.toasts.syncedPause"),
      );
    }
  }

  function handlePlayRoomQueue() {
    if (!isHost || !isConnected) return;
    const tracks = queueItems.map((item) => item.track);
    if (tracks.length === 0) {
      toast.info(t("jam.toasts.roomQueueEmpty"));
      return;
    }
    if (sendEvent({ type: "queue_play" })) {
      toast.success(t("jam.toasts.roomQueueLoaded"));
    }
  }

  function toggleRoomPlayback() {
    if (!isHost || !roomIsActive || !isConnected) return;
    const activeTrack = roomCurrentTrack || currentTrack;
    if (!activeTrack) {
      handlePlayRoomQueue();
      return;
    }

    const playing = !isPlaying;
    if (
      !sendEvent({
        type: playing ? "play" : "pause",
        track: trackToPayload(activeTrack),
        position: currentTime,
        playing,
      })
    ) {
      return;
    }
    if (playing) resume();
    else pause();
    setSyncStatus(playing ? "synced" : "idle");
  }

  function focusQueueSearch() {
    const input = queueSearchInputRef.current;
    if (!input) return;
    input.focus();
    input.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }

  function handlePlayNext() {
    if (!isHost || !isConnected || queueItems.length === 0) return;
    sendEvent({ type: "play_next" });
  }

  function handleRemoveFromRoomQueue(queueItemId: string) {
    if (!canManageQueue) {
      toast.error(t("jam.toasts.queuePermissionDenied"));
      return;
    }
    if (queueItemId.startsWith("legacy-")) {
      if (
        !sendEvent({
          type: "queue_remove",
          index: Number(queueItemId.replace("legacy-", "")),
        })
      ) {
        return;
      }
      dispatch({
        type: "QUEUE_REMOVE",
        payload: Number(queueItemId.replace("legacy-", "")),
      });
      return;
    }
    if (!sendEvent({ type: "queue_remove", queue_item_id: queueItemId })) {
      return;
    }
    dispatch({ type: "QUEUE_REMOVE_ITEM", payload: queueItemId });
  }

  function handleMoveInRoomQueue(
    queueItemId: string,
    fromIndex: number,
    toIndex: number,
  ) {
    if (!canManageQueue) {
      toast.error(t("jam.toasts.queuePermissionDenied"));
      return;
    }
    if (toIndex < 0 || toIndex >= queueItems.length) return;
    if (queueItemId.startsWith("legacy-")) {
      sendEvent({ type: "queue_reorder", fromIndex, toIndex });
      return;
    }
    sendEvent({ type: "queue_reorder", queue_item_id: queueItemId, toIndex });
  }

  function handleQueueDragEnd({ active, over }: DragEndEvent) {
    if (!canManageQueue || !over || active.id === over.id) return;
    const fromIndex = queueItems.findIndex(
      (item) => item.id === String(active.id),
    );
    const toIndex = queueItems.findIndex((item) => item.id === String(over.id));
    if (fromIndex < 0 || toIndex < 0) return;
    handleMoveInRoomQueue(String(active.id), fromIndex, toIndex);
  }

  function handleVote(queueItem: JamQueueItem) {
    if (
      !["auto", "auto_dj"].includes(queueMode) ||
      room?.auto_dj_voting === false ||
      !isConnected ||
      queueItem.voted_by_me
    ) {
      return;
    }
    dispatch({
      type: "QUEUE_VOTE",
      payload: {
        queueItemId: queueItem.id,
        voted: true,
        voteCount: queueItem.vote_count + 1,
      },
    });
    if (!sendEvent({ type: "queue_vote", queue_item_id: queueItem.id })) {
      dispatch({
        type: "QUEUE_VOTE",
        payload: {
          queueItemId: queueItem.id,
          voted: false,
          voteCount: queueItem.vote_count,
        },
      });
    }
  }

  function handleResolveRequest(requestId: string, approve: boolean) {
    if (!canManageQueue) return;
    sendEvent({
      type: approve ? "request_approve" : "request_reject",
      request_id: requestId,
    });
  }

  function toggleQueueMode() {
    if (!room || !isHost) return;
    void updateRoomSettings(
      { queue_mode: queueMode === "manual" ? "auto" : "manual" },
      "queue_mode",
    );
  }

  function enableAutoDj() {
    if (!room || !isHost) return;
    void updateRoomSettings(
      { queue_mode: "auto_dj", is_permanent: true },
      "queue_mode",
    );
  }

  return {
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
  };
}
