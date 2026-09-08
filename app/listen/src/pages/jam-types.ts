import type { Track } from "@/contexts/PlayerContext";

export type JamVisibility = "public" | "private";
export type JamQueueMode = "manual" | "auto" | "auto_dj";

export interface JamMember {
  room_id: string;
  user_id: number;
  role: "host" | "collab";
  joined_at: string;
  last_seen_at: string;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
}

export interface JamEvent {
  id: number;
  room_id: string;
  user_id: number | null;
  event_type: string;
  payload_json?: Record<string, unknown> | null;
  created_at: string;
  username?: string | null;
  display_name?: string | null;
  avatar?: string | null;
}

export interface JamRoomsResponse {
  rooms: JamRoom[];
}

export interface JamQueueItem {
  id: string;
  track: Track;
  added_by?: number | null;
  source?: string;
  status?: "queued" | "playing" | string;
  position?: number;
  vote_count: number;
  voted_by_me: boolean;
  created_at?: string | null;
}

export interface JamTrackRequest {
  id: string;
  track: Track;
  requested_by?: number | null;
  status: "pending" | "approved" | "rejected" | string;
  resolved_by?: number | null;
  queue_item_id?: string | null;
  created_at?: string | null;
  resolved_at?: string | null;
  requester_name?: string | null;
  requester_username?: string | null;
}

export interface SearchData {
  tracks: SearchTrack[];
}

export interface JamRoom {
  id: string;
  host_user_id: number;
  name: string;
  status: string;
  visibility: JamVisibility;
  is_permanent: boolean;
  queue_mode?: JamQueueMode;
  auto_dj_voting?: boolean;
  genre_filters?: string[];
  description?: string | null;
  tags?: string[];
  current_track_payload?: Record<string, unknown> | null;
  created_at: string;
  ended_at?: string | null;
  member_count?: number | null;
  is_member?: boolean | null;
  last_event_at?: string | null;
  members: JamMember[];
  events: JamEvent[];
  queue?: JamQueueItem[];
  requests?: JamTrackRequest[];
  auto_dj_suggestions?: Record<string, unknown>[];
}

export interface JamInvite {
  token: string;
  join_url: string;
  qr_value: string;
  expires_at?: string | null;
}

export interface SearchTrack {
  id?: number;
  entity_uid?: string;
  global_uid?: string;
  global_track_uid?: string;
  globalTrackUid?: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_entity_uid?: string;
  global_album_uid?: string;
  globalAlbumUid?: string;
  album_slug?: string;
  path?: string;
}

export interface JamSessionState {
  roomSearch: string;
  room: JamRoom | null;
  sharedQueue: Track[];
  queueItems: JamQueueItem[];
  pendingRequests: JamTrackRequest[];
  roomName: string;
  roomDescription: string;
  roomTagsInput: string;
  roomVisibility: JamVisibility;
  roomPermanent: boolean;
  creating: boolean;
  joiningRoomId: string | null;
  inviteInput: string;
  inviteData: JamInvite | null;
  creatingInvite: boolean;
  inviteModalOpen: boolean;
  metadataModalOpen: boolean;
  metadataDescription: string;
  metadataTagsInput: string;
  endingRoom: boolean;
  deletingRoomId: string | null;
  deleteTargetRoom: JamRoom | null;
  updatingRoomField:
    | "visibility"
    | "permanent"
    | "metadata"
    | "queue_mode"
    | null;
  queueSearch: string;
  queueSearchResults: SearchTrack[];
  queueSearchLoading: boolean;
  syncStatus: "idle" | "synced" | "drifting";
  isConnected: boolean;
  connectionProblem: string | null;
}

export type JamSessionAction =
  | { type: "SET_ROOM_SEARCH"; payload: string }
  | {
      type: "SET_ROOM";
      payload: JamRoom | null | ((prev: JamRoom | null) => JamRoom | null);
    }
  | { type: "SET_SHARED_QUEUE"; payload: Track[] }
  | { type: "SET_ROOM_NAME"; payload: string }
  | { type: "SET_ROOM_DESCRIPTION"; payload: string }
  | { type: "SET_ROOM_TAGS_INPUT"; payload: string }
  | { type: "SET_ROOM_VISIBILITY"; payload: JamVisibility }
  | { type: "SET_ROOM_PERMANENT"; payload: boolean }
  | { type: "SET_CREATING"; payload: boolean }
  | { type: "SET_JOINING_ROOM_ID"; payload: string | null }
  | { type: "SET_INVITE_INPUT"; payload: string }
  | { type: "SET_INVITE_DATA"; payload: JamInvite | null }
  | { type: "SET_CREATING_INVITE"; payload: boolean }
  | { type: "SET_INVITE_MODAL_OPEN"; payload: boolean }
  | { type: "SET_METADATA_MODAL_OPEN"; payload: boolean }
  | { type: "SET_METADATA_DESCRIPTION"; payload: string }
  | { type: "SET_METADATA_TAGS_INPUT"; payload: string }
  | { type: "SET_ENDING_ROOM"; payload: boolean }
  | { type: "SET_DELETING_ROOM_ID"; payload: string | null }
  | { type: "SET_DELETE_TARGET_ROOM"; payload: JamRoom | null }
  | {
      type: "SET_UPDATING_ROOM_FIELD";
      payload: "visibility" | "permanent" | "metadata" | "queue_mode" | null;
    }
  | { type: "SET_QUEUE_SEARCH"; payload: string }
  | { type: "SET_QUEUE_SEARCH_RESULTS"; payload: SearchTrack[] }
  | { type: "SET_QUEUE_SEARCH_LOADING"; payload: boolean }
  | { type: "SET_SYNC_STATUS"; payload: "idle" | "synced" | "drifting" }
  | { type: "SET_IS_CONNECTED"; payload: boolean }
  | { type: "SET_CONNECTION_PROBLEM"; payload: string | null }
  | { type: "APPLY_ROOM_DATA"; payload: JamRoom }
  | { type: "QUEUE_SNAPSHOT"; payload: JamQueueItem[] }
  | { type: "REQUESTS_SNAPSHOT"; payload: JamTrackRequest[] }
  | {
      type: "QUEUE_VOTE";
      payload: { queueItemId: string; voted: boolean; voteCount: number };
    }
  | { type: "QUEUE_ADD"; payload: Track }
  | { type: "QUEUE_REMOVE"; payload: number }
  | { type: "QUEUE_REMOVE_ITEM"; payload: string }
  | { type: "QUEUE_REORDER"; payload: { fromIndex: number; toIndex: number } }
  | { type: "UPDATE_ROOM_MEMBERS"; payload: JamMember[] }
  | { type: "ROOM_ENDED"; payload: JamRoom }
  | { type: "ROOM_DELETED" }
  | { type: "WEBSOCKET_OPEN" }
  | { type: "WEBSOCKET_CLOSED"; payload: { code: number; message: string } }
  | { type: "SEND_EVENT_FAIL"; payload: string }
  | { type: "RESET_STATE" };
