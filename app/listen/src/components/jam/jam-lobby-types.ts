import type { Dispatch, SetStateAction } from "react";

import type { AuthUser } from "@/contexts/auth-context";
import type { JamQueueMode, JamRoom, JamVisibility } from "@/pages/jam-reducer";

export type SelectedGenre = { name: string; slug: string };

export type GenreTaxonomyNode = {
  slug: string;
  name: string;
  alias_names?: string[];
};

export type JamRoomCreatePanelProps = {
  roomName: string;
  setRoomName: (value: string) => void;
  roomDescription: string;
  setRoomDescription: (value: string) => void;
  roomTagsInput: string;
  setRoomTagsInput: (value: string) => void;
  roomQueueMode: JamQueueMode;
  onRoomQueueModeChange: (value: JamQueueMode) => void;
  roomGenreFiltersInput: string;
  setRoomGenreFiltersInput: (value: string) => void;
  genreSuggestionIndex: number;
  setGenreSuggestionIndex: Dispatch<SetStateAction<number>>;
  selectedGenreItems: SelectedGenre[];
  removeGenre: (slug: string) => void;
  genreSuggestions: GenreTaxonomyNode[];
  taxonomyLoading: boolean;
  selectGenre: (node: GenreTaxonomyNode) => void;
  roomAutoDjVoting: boolean;
  setRoomAutoDjVoting: (value: boolean) => void;
  roomVisibility: JamVisibility;
  setRoomVisibility: (value: JamVisibility) => void;
  roomPermanent: boolean;
  setRoomPermanent: (value: boolean) => void;
  creating: boolean;
  onCreateRoom: () => void;
};

export type JamOpenRoomsPanelProps = {
  roomsLoading: boolean;
  roomSearch: string;
  setRoomSearch: (value: string) => void;
  memberRooms: JamRoom[];
  publicRooms: JamRoom[];
  user: AuthUser | null;
  joiningRoomId: string | null;
  deletingRoomId: string | null;
  onJoinRoom: (room: JamRoom) => void;
  onDeleteRoom: (room: JamRoom) => void;
};
