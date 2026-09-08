import {
  deriveLegacyQueueItems,
  normalizeQueueItems,
  normalizeTrackRequests,
  reorderTracks,
  sortQueueItemsForVotes,
} from "./jam-queue-model";
import type { JamSessionAction, JamSessionState } from "./jam-types";

export type * from "./jam-types";
export {
  deriveLegacyQueueItems,
  deriveSharedQueue,
  payloadToTrack,
  reorderTracks,
} from "./jam-queue-model";

export const initialJamSessionState: JamSessionState = {
  roomSearch: "",
  room: null,
  sharedQueue: [],
  queueItems: [],
  pendingRequests: [],
  roomName: "",
  roomDescription: "",
  roomTagsInput: "",
  roomVisibility: "private",
  roomPermanent: false,
  creating: false,
  joiningRoomId: null,
  inviteInput: "",
  inviteData: null,
  creatingInvite: false,
  inviteModalOpen: false,
  metadataModalOpen: false,
  metadataDescription: "",
  metadataTagsInput: "",
  endingRoom: false,
  deletingRoomId: null,
  deleteTargetRoom: null,
  updatingRoomField: null,
  queueSearch: "",
  queueSearchResults: [],
  queueSearchLoading: false,
  syncStatus: "idle",
  isConnected: false,
  connectionProblem: null,
};

export function jamSessionReducer(
  state: JamSessionState,
  action: JamSessionAction,
): JamSessionState {
  switch (action.type) {
    case "SET_ROOM_SEARCH":
      return { ...state, roomSearch: action.payload };
    case "SET_ROOM": {
      const nextRoom =
        typeof action.payload === "function"
          ? action.payload(state.room)
          : action.payload;
      return { ...state, room: nextRoom };
    }
    case "SET_SHARED_QUEUE":
      return { ...state, sharedQueue: action.payload };
    case "SET_ROOM_NAME":
      return { ...state, roomName: action.payload };
    case "SET_ROOM_DESCRIPTION":
      return { ...state, roomDescription: action.payload };
    case "SET_ROOM_TAGS_INPUT":
      return { ...state, roomTagsInput: action.payload };
    case "SET_ROOM_VISIBILITY":
      return { ...state, roomVisibility: action.payload };
    case "SET_ROOM_PERMANENT":
      return { ...state, roomPermanent: action.payload };
    case "SET_CREATING":
      return { ...state, creating: action.payload };
    case "SET_JOINING_ROOM_ID":
      return { ...state, joiningRoomId: action.payload };
    case "SET_INVITE_INPUT":
      return { ...state, inviteInput: action.payload };
    case "SET_INVITE_DATA":
      return { ...state, inviteData: action.payload };
    case "SET_CREATING_INVITE":
      return { ...state, creatingInvite: action.payload };
    case "SET_INVITE_MODAL_OPEN":
      return { ...state, inviteModalOpen: action.payload };
    case "SET_METADATA_MODAL_OPEN":
      return { ...state, metadataModalOpen: action.payload };
    case "SET_METADATA_DESCRIPTION":
      return { ...state, metadataDescription: action.payload };
    case "SET_METADATA_TAGS_INPUT":
      return { ...state, metadataTagsInput: action.payload };
    case "SET_ENDING_ROOM":
      return { ...state, endingRoom: action.payload };
    case "SET_DELETING_ROOM_ID":
      return { ...state, deletingRoomId: action.payload };
    case "SET_DELETE_TARGET_ROOM":
      return { ...state, deleteTargetRoom: action.payload };
    case "SET_UPDATING_ROOM_FIELD":
      return { ...state, updatingRoomField: action.payload };
    case "SET_QUEUE_SEARCH":
      return { ...state, queueSearch: action.payload };
    case "SET_QUEUE_SEARCH_RESULTS":
      return { ...state, queueSearchResults: action.payload };
    case "SET_QUEUE_SEARCH_LOADING":
      return { ...state, queueSearchLoading: action.payload };
    case "SET_SYNC_STATUS":
      return { ...state, syncStatus: action.payload };
    case "SET_IS_CONNECTED":
      return { ...state, isConnected: action.payload };
    case "SET_CONNECTION_PROBLEM":
      return { ...state, connectionProblem: action.payload };
    case "APPLY_ROOM_DATA": {
      const room = action.payload;
      const queueItems = room.queue
        ? normalizeQueueItems(room.queue)
        : deriveLegacyQueueItems(room.events || []);
      const requests = normalizeTrackRequests(room.requests || []);
      return {
        ...state,
        room,
        queueItems,
        pendingRequests: requests.filter(
          (request) => request.status === "pending",
        ),
        sharedQueue: queueItems.map((item) => item.track),
      };
    }
    case "QUEUE_SNAPSHOT": {
      const currentVotes = new Map(
        state.queueItems.map((item) => [item.id, item.voted_by_me]),
      );
      const queueItems = normalizeQueueItems(action.payload).map((item) => ({
        ...item,
        voted_by_me: currentVotes.get(item.id) ?? item.voted_by_me,
      }));
      return {
        ...state,
        queueItems,
        sharedQueue: queueItems.map((item) => item.track),
      };
    }
    case "REQUESTS_SNAPSHOT": {
      const requests = normalizeTrackRequests(action.payload);
      return {
        ...state,
        pendingRequests: requests.filter(
          (request) => request.status === "pending",
        ),
      };
    }
    case "QUEUE_VOTE": {
      const queueItems = sortQueueItemsForVotes(
        state.queueItems.map((item) =>
          item.id === action.payload.queueItemId
            ? {
                ...item,
                voted_by_me: action.payload.voted,
                vote_count: action.payload.voteCount,
              }
            : item,
        ),
      );
      return {
        ...state,
        queueItems,
        sharedQueue: queueItems.map((item) => item.track),
      };
    }
    case "QUEUE_ADD":
      return {
        ...state,
        sharedQueue: [...state.sharedQueue, action.payload],
        queueItems: [
          ...state.queueItems,
          {
            id: `legacy-${state.queueItems.length}`,
            track: action.payload,
            vote_count: 0,
            voted_by_me: false,
          },
        ],
      };
    case "QUEUE_REMOVE":
      return {
        ...state,
        sharedQueue: state.sharedQueue.filter(
          (_, index) => index !== action.payload,
        ),
        queueItems: state.queueItems.filter(
          (_, index) => index !== action.payload,
        ),
      };
    case "QUEUE_REMOVE_ITEM": {
      const queueItems = state.queueItems.filter(
        (item) => item.id !== action.payload,
      );
      return {
        ...state,
        queueItems,
        sharedQueue: queueItems.map((item) => item.track),
      };
    }
    case "QUEUE_REORDER":
      return {
        ...state,
        sharedQueue: reorderTracks(
          state.sharedQueue,
          action.payload.fromIndex,
          action.payload.toIndex,
        ),
        queueItems: reorderTracks(
          state.queueItems,
          action.payload.fromIndex,
          action.payload.toIndex,
        ),
      };
    case "UPDATE_ROOM_MEMBERS":
      return {
        ...state,
        room: state.room
          ? { ...state.room, members: action.payload }
          : state.room,
      };
    case "ROOM_ENDED":
      return {
        ...state,
        room: action.payload,
        syncStatus: "idle",
        connectionProblem: null,
      };
    case "ROOM_DELETED":
      return {
        ...state,
        syncStatus: "idle",
        connectionProblem: null,
      };
    case "WEBSOCKET_OPEN":
      return { ...state, isConnected: true, connectionProblem: null };
    case "WEBSOCKET_CLOSED": {
      const { code, message } = action.payload;
      if (code === 4409) {
        return {
          ...state,
          room: state.room ? { ...state.room, status: "ended" } : state.room,
          isConnected: false,
          syncStatus: "idle",
          connectionProblem: null,
        };
      }
      return {
        ...state,
        isConnected: false,
        syncStatus: "idle",
        connectionProblem: message,
      };
    }
    case "SEND_EVENT_FAIL":
      return {
        ...state,
        isConnected: false,
        connectionProblem: action.payload,
      };
    case "RESET_STATE":
      return initialJamSessionState;
    default:
      return state;
  }
}
