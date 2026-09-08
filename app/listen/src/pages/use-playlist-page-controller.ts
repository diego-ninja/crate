import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";

import { filterPlaylistTracks } from "@/components/playlists/PlaylistTrackFilterBar";
import type { PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import { useAuth } from "@/contexts/AuthContext";
import { useOffline } from "@/contexts/OfflineContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { useApi } from "@/hooks/use-api";
import { useLazyPlaylistOptions } from "@/hooks/use-lazy-playlist-options";
import { isOfflineBusy } from "@/lib/offline";
import {
  buildPlaylistEditableTracks,
  buildPlaylistMetaItems,
  buildPlaylistOfflinePresentation,
  buildPlaylistPlayerTracks,
} from "@/pages/playlist-page-model";
import {
  buildPlaylistActions,
  type PlaylistActions,
} from "@/pages/playlist-actions";
import type {
  PlaylistData,
  PlaylistInvite,
  PlaylistMember,
} from "@/pages/playlist-types";

export interface PlaylistPageController extends PlaylistActions {
  data: PlaylistData | undefined;
  deleteOpen: boolean;
  deleting: boolean;
  destinationPlaylistOptions: { id: number; name: string }[];
  editableTracks: ReturnType<typeof buildPlaylistEditableTracks>;
  editorOpen: boolean;
  error: unknown;
  filterQuery: string;
  filteredTracks: PlaylistData["tracks"];
  inviteData: PlaylistInvite | null;
  inviteLink: string | null;
  isOwner: boolean;
  loading: boolean;
  members: PlaylistMember[];
  membersOpen: boolean;
  offlineButtonLabel: string;
  offlineBusy: boolean;
  offlineState: ReturnType<ReturnType<typeof useOffline>["getPlaylistState"]>;
  offlineStatusDetail: string | null;
  offlineSupported: boolean;
  playlistArtworkTracks: PlaylistArtworkTrack[] | PlaylistData["tracks"];
  playlistMenuItems: PlaylistActions["playlistMenuItems"];
  playlistMetaItems: Array<string | null | undefined | false>;
  playlistOptions: { id: number; name: string }[];
  playerTracks: ReturnType<typeof buildPlaylistPlayerTracks>;
  refetch: () => void;
  removingMemberId: number | null;
  saving: boolean;
  secondaryActions: PlaylistActions["secondaryActions"];
  setDeleteOpen: (value: boolean) => void;
  setEditorOpen: (value: boolean) => void;
  setFilterQuery: (value: string) => void;
  setMembersOpen: (value: boolean) => void;
  t: ReturnType<typeof useTranslation>["t"];
  creatingInvite: boolean;
  ensurePlaylistOptionsLoaded: () => void;
}

export function usePlaylistPageController(): PlaylistPageController {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useApi<PlaylistData>(
    id ? `/api/playlists/${id}` : null,
    "GET",
    undefined,
    { safetyNetMs: 120_000 },
  );
  const resolvedData = data ?? undefined;
  const { playlistOptions, ensurePlaylistOptionsLoaded } =
    useLazyPlaylistOptions();
  const { playAll } = usePlayerActions();
  const { openCreatePlaylist } = usePlaylistComposer();
  const {
    supported: offlineSupported,
    getPlaylistState,
    getPlaylistRecord,
    togglePlaylistOffline,
  } = useOffline();
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteData, setInviteData] = useState<PlaylistInvite | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<number | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const deferredFilterQuery = useDeferredValue(filterQuery);
  const playerTracks = useMemo(
    () => buildPlaylistPlayerTracks(resolvedData),
    [resolvedData],
  );
  const editableTracks = useMemo(
    () => buildPlaylistEditableTracks(resolvedData, t),
    [resolvedData, t],
  );
  const filteredTracks = useMemo(
    () => filterPlaylistTracks(resolvedData?.tracks ?? [], deferredFilterQuery),
    [resolvedData?.tracks, deferredFilterQuery],
  );
  const destinationPlaylistOptions = useMemo(
    () =>
      playlistOptions.filter((playlist) => playlist.id !== resolvedData?.id),
    [playlistOptions, resolvedData?.id],
  );
  const members = resolvedData?.members ?? [];
  const isOwner = Boolean(
    user &&
      members.some(
        (member) => member.user_id === user.id && member.role === "owner",
      ),
  );
  const inviteLink = inviteData
    ? `${window.location.origin}${inviteData.join_url}`
    : null;
  const offlineState = getPlaylistState(resolvedData?.id);
  const offlineRecord = getPlaylistRecord(resolvedData?.id);
  const offlinePresentation = buildPlaylistOfflinePresentation(
    resolvedData,
    offlineState,
    offlineRecord,
    t,
  );
  const actions = buildPlaylistActions({
    data: resolvedData,
    editableTracks,
    id,
    offlinePresentation,
    offlineState,
    offlineSupported,
    openCreatePlaylist,
    navigate,
    onInviteCreated: setInviteData,
    playerTracks,
    playAll,
    refetch,
    setCreatingInvite,
    setDeleteOpen,
    setDeleting,
    setEditorOpen,
    setMembersOpen,
    setRemovingMemberId,
    setSaving,
    t,
    togglePlaylistOffline,
    inviteData,
  });

  return {
    ...actions,
    data: resolvedData,
    deleteOpen,
    deleting,
    destinationPlaylistOptions,
    editableTracks,
    editorOpen,
    error,
    filterQuery,
    filteredTracks,
    inviteData,
    inviteLink,
    isOwner,
    loading,
    members,
    membersOpen,
    offlineButtonLabel: offlinePresentation.buttonLabel,
    offlineBusy: isOfflineBusy(offlineState),
    offlineState,
    offlineStatusDetail: offlinePresentation.statusDetail,
    offlineSupported,
    playlistArtworkTracks:
      resolvedData?.artwork_tracks ?? resolvedData?.tracks ?? [],
    playlistMenuItems: actions.playlistMenuItems,
    playlistMetaItems: resolvedData
      ? buildPlaylistMetaItems(resolvedData, t)
      : [],
    playlistOptions,
    playerTracks,
    refetch,
    removingMemberId,
    saving,
    secondaryActions: actions.secondaryActions,
    setDeleteOpen,
    setEditorOpen,
    setFilterQuery,
    setMembersOpen,
    t,
    creatingInvite,
    ensurePlaylistOptionsLoaded,
  };
}
