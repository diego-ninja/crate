import { useDeferredValue } from "react";

import { useApi } from "@/hooks/use-api";
import { useJamLobbyData } from "@/hooks/use-jam-lobby-data";
import type {
  JamQueueMode,
  JamRoom,
  JamRoomsResponse,
} from "@/pages/jam-reducer";

export function useJamSessionRoomQueries({
  roomId,
  roomSearch,
  roomQueueMode,
  roomGenreFilters,
  roomGenreFiltersInput,
  userId,
}: {
  roomId?: string;
  roomSearch: string;
  roomQueueMode: JamQueueMode;
  roomGenreFilters: string[];
  roomGenreFiltersInput: string;
  userId?: number;
}) {
  const deferredRoomSearch = useDeferredValue(roomSearch);
  const roomsUrl = !roomId
    ? `/api/jam/rooms${
        deferredRoomSearch.trim()
          ? `?q=${encodeURIComponent(deferredRoomSearch.trim())}`
          : ""
      }`
    : null;
  const { data, loading, error } = useApi<JamRoom>(
    roomId ? `/api/jam/rooms/${roomId}` : null,
  );
  const {
    data: roomsData,
    loading: roomsLoading,
    refetch: refetchRooms,
  } = useApi<JamRoomsResponse>(roomsUrl, "GET", undefined, {
    safetyNetMs: 5_000,
  });
  const {
    taxonomyLoading,
    genreSuggestions,
    selectedGenreItems,
    memberRooms,
    publicRooms,
  } = useJamLobbyData({
    roomId,
    roomQueueMode,
    roomGenreFilters,
    roomGenreFiltersInput,
    visibleRooms: roomsData?.rooms ?? [],
    userId,
  });

  return {
    data,
    loading,
    error,
    roomsData,
    roomsLoading,
    refetchRooms,
    taxonomyLoading,
    genreSuggestions,
    selectedGenreItems,
    memberRooms,
    publicRooms,
  };
}
