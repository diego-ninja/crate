import { useDeferredValue, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";

import { filterPlaylistTracks } from "@/components/playlists/PlaylistTrackFilterBar";
import { useOffline } from "@/contexts/OfflineContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { useApi } from "@/hooks/use-api";
import { useLazyPlaylistOptions } from "@/hooks/use-lazy-playlist-options";
import { isOfflineBusy } from "@/lib/offline";
import {
  buildCuratedOfflinePresentation,
  buildCuratedPlayerTracks,
  buildCuratedPlaylistMetaItems,
} from "@/pages/curated-playlist-model";
import {
  buildCuratedPlaylistActions,
  type CuratedPlaylistActions,
} from "@/pages/curated-playlist-actions";
import type {
  CuratedPlaylistData,
  CuratedPlaylistTrack,
} from "@/pages/curated-playlist-types";

export interface CuratedPlaylistPageController extends CuratedPlaylistActions {
  data: CuratedPlaylistData | undefined;
  error: unknown;
  filterQuery: string;
  filteredTracks: CuratedPlaylistTrack[];
  loading: boolean;
  offlineButtonLabel: string;
  offlineStatusDetail: string | null;
  offlineState: ReturnType<ReturnType<typeof useOffline>["getPlaylistState"]>;
  offlineSupported: boolean;
  offlineBusy: boolean;
  playlistMetaItems: Array<string | null | undefined | false>;
  playlistOptions: { id: number; name: string }[];
  playerTracks: ReturnType<typeof buildCuratedPlayerTracks>;
  refetch: () => void;
  setFilterQuery: (value: string) => void;
  t: TFunction;
  togglingFollow: boolean;
  ensurePlaylistOptionsLoaded: () => void;
}

export function useCuratedPlaylistPageController(): CuratedPlaylistPageController {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { playAll } = usePlayerActions();
  const { openCreatePlaylist } = usePlaylistComposer();
  const {
    supported: offlineSupported,
    getPlaylistState,
    getPlaylistRecord,
    togglePlaylistOffline,
  } = useOffline();
  const {
    data: responseData,
    loading,
    error,
    refetch,
  } = useApi<CuratedPlaylistData>(
    id ? `/api/curation/playlists/${id}` : null,
    "GET",
    undefined,
    { safetyNetMs: 120_000 },
  );
  const data = responseData ?? undefined;
  const { playlistOptions, ensurePlaylistOptionsLoaded } =
    useLazyPlaylistOptions();
  const [togglingFollow, setTogglingFollow] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const deferredFilterQuery = useDeferredValue(filterQuery);
  const playerTracks = useMemo(() => buildCuratedPlayerTracks(data), [data]);
  const filteredTracks = useMemo(
    () => filterPlaylistTracks(data?.tracks ?? [], deferredFilterQuery),
    [data?.tracks, deferredFilterQuery],
  );
  const offlineState = getPlaylistState(data?.id);
  const offlineRecord = getPlaylistRecord(data?.id);
  const offlinePresentation = buildCuratedOfflinePresentation(
    data,
    offlineState,
    offlineRecord,
    t,
  );
  const actions = buildCuratedPlaylistActions({
    data,
    id,
    offlinePresentation,
    offlineState,
    offlineSupported,
    openCreatePlaylist,
    playerTracks,
    playAll,
    refetch,
    setTogglingFollow,
    t,
    togglePlaylistOffline,
    togglingFollow,
  });

  return {
    ...actions,
    data,
    error,
    filterQuery,
    filteredTracks,
    loading,
    offlineButtonLabel: offlinePresentation.buttonLabel,
    offlineStatusDetail: offlinePresentation.statusDetail,
    offlineState,
    offlineSupported,
    offlineBusy: isOfflineBusy(offlineState),
    playlistMetaItems: data ? buildCuratedPlaylistMetaItems(data, t) : [],
    playlistOptions,
    playerTracks,
    refetch,
    setFilterQuery,
    t,
    togglingFollow,
    ensurePlaylistOptionsLoaded,
  };
}
