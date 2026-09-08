import { arrayMove } from "@dnd-kit/sortable";

export interface PlaylistComposerTrack {
  entityUid?: string;
  globalTrackUid?: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  path?: string | null;
  libraryTrackId?: number;
  playlistEntryId?: number;
  playlistPosition?: number;
}

export interface SearchTrackResult {
  id?: number | string;
  entity_uid?: string;
  global_track_uid?: string;
  globalTrackUid?: string;
  global_uid?: string;
  title: string;
  artist: string;
  album: string;
  path?: string | null;
  duration: number;
}

export function getTrackKey(track: PlaylistComposerTrack): string {
  if (track.globalTrackUid) return `global:${track.globalTrackUid}`;
  if (track.entityUid) return `entity:${track.entityUid}`;
  if (track.libraryTrackId != null) return `id:${track.libraryTrackId}`;
  if (track.path) return `path:${track.path}`;
  return `${track.artist}:${track.album}:${track.title}`;
}

function searchTrackGlobalUid(track: SearchTrackResult): string | undefined {
  return track.globalTrackUid ?? track.global_track_uid ?? track.global_uid;
}

export function searchTrackKey(track: SearchTrackResult): string {
  const globalUid = searchTrackGlobalUid(track);
  if (globalUid) return `global:${globalUid}`;
  if (track.entity_uid) return `entity:${track.entity_uid}`;
  if (typeof track.id === "number") return `id:${track.id}`;
  if (track.path) return `path:${track.path}`;
  return `${track.artist}:${track.album}:${track.title}`;
}

export function toComposerTrack(
  track: SearchTrackResult,
): PlaylistComposerTrack {
  return {
    globalTrackUid: searchTrackGlobalUid(track),
    entityUid: track.entity_uid,
    libraryTrackId: typeof track.id === "number" ? track.id : undefined,
    path: track.path,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
  };
}

export type PlaylistComposerState = {
  name: string;
  description: string;
  coverDataUrl: string | null;
  visibility: "public" | "private";
  isCollaborative: boolean;
  tracks: PlaylistComposerTrack[];
  search: string;
  searching: boolean;
  results: SearchTrackResult[];
  titleEditing: boolean;
  descriptionEditing: boolean;
};

export type PlaylistComposerAction =
  | {
      type: "reset";
      initialName: string;
      initialDescription: string;
      initialCoverDataUrl: string | null;
      initialVisibility: "public" | "private";
      initialCollaborative: boolean;
      initialTracks: PlaylistComposerTrack[];
    }
  | { type: "set-name"; value: string }
  | { type: "set-description"; value: string }
  | { type: "set-cover"; value: string | null }
  | { type: "set-visibility"; value: "public" | "private" }
  | { type: "toggle-collaborative" }
  | { type: "set-tracks"; value: PlaylistComposerTrack[] }
  | { type: "move-track"; activeId: string; overId: string }
  | { type: "add-track"; value: PlaylistComposerTrack }
  | { type: "remove-track"; key: string }
  | { type: "set-search"; value: string }
  | { type: "set-searching"; value: boolean }
  | { type: "set-results"; value: SearchTrackResult[] }
  | { type: "set-title-editing"; value: boolean }
  | { type: "set-description-editing"; value: boolean };

export const initialPlaylistComposerState: PlaylistComposerState = {
  name: "",
  description: "",
  coverDataUrl: null,
  visibility: "private",
  isCollaborative: false,
  tracks: [],
  search: "",
  searching: false,
  results: [],
  titleEditing: false,
  descriptionEditing: false,
};

export function playlistComposerReducer(
  state: PlaylistComposerState,
  action: PlaylistComposerAction,
): PlaylistComposerState {
  switch (action.type) {
    case "reset":
      return {
        ...initialPlaylistComposerState,
        name: action.initialName,
        description: action.initialDescription,
        coverDataUrl: action.initialCoverDataUrl,
        visibility: action.initialVisibility,
        isCollaborative: action.initialCollaborative,
        tracks: action.initialTracks,
      };
    case "set-name":
      return { ...state, name: action.value };
    case "set-description":
      return { ...state, description: action.value };
    case "set-cover":
      return { ...state, coverDataUrl: action.value };
    case "set-visibility":
      return { ...state, visibility: action.value };
    case "toggle-collaborative":
      return { ...state, isCollaborative: !state.isCollaborative };
    case "set-tracks":
      return { ...state, tracks: action.value };
    case "move-track": {
      const oldIndex = state.tracks.findIndex(
        (track) => getTrackKey(track) === action.activeId,
      );
      const newIndex = state.tracks.findIndex(
        (track) => getTrackKey(track) === action.overId,
      );
      return oldIndex < 0 || newIndex < 0
        ? state
        : { ...state, tracks: arrayMove(state.tracks, oldIndex, newIndex) };
    }
    case "add-track":
      return {
        ...state,
        tracks: mergeUniqueTracks([...state.tracks, action.value]),
      };
    case "remove-track":
      return {
        ...state,
        tracks: state.tracks.filter(
          (track) => getTrackKey(track) !== action.key,
        ),
      };
    case "set-search":
      return { ...state, search: action.value };
    case "set-searching":
      return { ...state, searching: action.value };
    case "set-results":
      return { ...state, results: action.value };
    case "set-title-editing":
      return { ...state, titleEditing: action.value };
    case "set-description-editing":
      return { ...state, descriptionEditing: action.value };
  }
}

export function mergeUniqueTracks(
  tracks: PlaylistComposerTrack[],
): PlaylistComposerTrack[] {
  const seen = new Set<string>();
  const result: PlaylistComposerTrack[] = [];
  for (const track of tracks) {
    const key = getTrackKey(track);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(track);
  }
  return result;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
