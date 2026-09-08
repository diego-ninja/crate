import { useMemo } from "react";
import { toast } from "sonner";

import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { api } from "@/lib/api";
import { toPlayableTrack } from "@/lib/playable-track";
import { toTrackReferencePayload } from "@/lib/track-reference";
import type { TrackRowData } from "@/components/cards/TrackRow";
import type { AlbumData, AlbumTrack } from "@/pages/album-types";

export function useAlbumPlaylistActions({
  artistName,
  clearTrackSelection,
  closeAlbumMenu,
  data,
  displayName,
  globalAlbumUid,
  handleCloseSelectionMenu,
  playableAlbumTracks,
  selectedAlbumTracks,
  setPlaylistPickerOpen,
  setSelectionPlaylistPickerOpen,
  t,
}: {
  artistName: string;
  clearTrackSelection: () => void;
  closeAlbumMenu: () => void;
  data: AlbumData | null;
  displayName: string;
  globalAlbumUid: string | null;
  handleCloseSelectionMenu: () => void;
  playableAlbumTracks: AlbumTrack[];
  selectedAlbumTracks: AlbumTrack[];
  setPlaylistPickerOpen: (value: boolean) => void;
  setSelectionPlaylistPickerOpen: (value: boolean) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { openCreatePlaylist } = usePlaylistComposer();
  const { addToQueue, playNext } = usePlayerActions();
  const { isLiked, likeTrack } = useLikedTracks();

  const playlistTracksPayload = useMemo(
    () =>
      playableAlbumTracks.map((track) => ({
        ...toTrackReferencePayload({
          id: track.id,
          globalTrackUid:
            track.globalTrackUid ?? track.global_track_uid ?? track.global_uid,
          entity_uid: track.entity_uid,
          path: track.path,
          title: track.tags.title || track.filename,
          artist: artistName,
          album: displayName,
          duration: track.length_sec,
          library_track_id: typeof track.id === "number" ? track.id : undefined,
        }),
      })),
    [artistName, displayName, playableAlbumTracks],
  );
  const selectedPlaylistTracksPayload = useMemo(
    () =>
      selectedAlbumTracks.map((track) => ({
        ...toTrackReferencePayload({
          id: track.id,
          globalTrackUid:
            track.globalTrackUid ?? track.global_track_uid ?? track.global_uid,
          entity_uid: track.entity_uid,
          path: track.path,
          title: track.tags.title || track.filename,
          artist: artistName,
          album: displayName,
          duration: track.length_sec,
          library_track_id: typeof track.id === "number" ? track.id : undefined,
        }),
      })),
    [artistName, displayName, selectedAlbumTracks],
  );
  const selectedPlayerTracks = useMemo(
    () =>
      data
        ? selectedAlbumTracks.map((track) =>
            toPlayableTrack({
              id: track.id,
              globalTrackUid:
                track.globalTrackUid ??
                track.global_track_uid ??
                track.global_uid,
              entity_uid: track.entity_uid,
              title: track.tags.title || track.filename,
              artist: artistName,
              global_artist_uid: data.global_artist_uid,
              artist_entity_uid: data.artist_entity_uid,
              album: displayName,
              global_album_uid: globalAlbumUid,
              album_entity_uid: data.entity_uid,
              duration: track.length_sec,
              path: track.path,
              library_track_id:
                typeof track.id === "number" ? track.id : undefined,
              bpm: track.bpm,
              audio_key: track.audio_key,
              audio_scale: track.audio_scale,
              energy: track.energy,
              danceability: track.danceability,
              valence: track.valence,
              bliss_vector: track.bliss_vector,
            }),
          )
        : [],
    [artistName, data, displayName, globalAlbumUid, selectedAlbumTracks],
  );

  async function handleAddToPlaylist(playlistId: number) {
    try {
      await api(`/api/playlists/${playlistId}/tracks`, "POST", {
        tracks: playlistTracksPayload,
      });
      toast.success(t("album.toasts.addedToPlaylist"));
      closeAlbumMenu();
      setPlaylistPickerOpen(false);
    } catch {
      toast.error(t("album.toasts.addToPlaylistFailed"));
    }
  }

  async function handleAddSelectedToPlaylist(playlistId: number) {
    if (!selectedPlaylistTracksPayload.length) return;
    try {
      await api(`/api/playlists/${playlistId}/tracks`, "POST", {
        tracks: selectedPlaylistTracksPayload,
      });
      toast.success(
        t("album.toasts.selectedAddedToPlaylist", {
          count: selectedPlaylistTracksPayload.length,
        }),
      );
      clearTrackSelection();
      setSelectionPlaylistPickerOpen(false);
      handleCloseSelectionMenu();
    } catch {
      toast.error(t("album.toasts.addSelectedFailed"));
    }
  }

  function handlePlaySelectedNext() {
    if (!selectedPlayerTracks.length) return;
    [...selectedPlayerTracks].reverse().forEach((track) => playNext(track));
    toast.success(
      t("album.toasts.selectedQueuedNext", {
        count: selectedPlayerTracks.length,
      }),
    );
    handleCloseSelectionMenu();
  }

  function handleAddSelectedToQueue() {
    if (!selectedPlayerTracks.length) return;
    selectedPlayerTracks.forEach((track) => addToQueue(track));
    toast.success(
      t("album.toasts.selectedAddedToQueue", {
        count: selectedPlayerTracks.length,
      }),
    );
    handleCloseSelectionMenu();
  }

  async function handleAddSelectedToCollection() {
    const missing = selectedAlbumTracks.filter(
      (track) =>
        !isLiked(
          typeof track.id === "number" ? track.id : null,
          track.entity_uid,
          track.path,
          track.global_track_uid,
        ),
    );
    if (!missing.length) {
      toast.info(t("album.toasts.selectedAlreadyCollection"));
      handleCloseSelectionMenu();
      return;
    }

    try {
      await Promise.all(
        missing.map((track) =>
          likeTrack(
            typeof track.id === "number" ? track.id : null,
            track.entity_uid ?? null,
            track.path,
            track.global_track_uid ?? null,
          ),
        ),
      );
      toast.success(
        t("album.toasts.selectedAddedCollection", { count: missing.length }),
      );
      handleCloseSelectionMenu();
    } catch {
      toast.error(t("album.toasts.updateCollectionFailed"));
    }
  }

  async function handleAddTrackToPlaylist(
    playlistId: number,
    track: TrackRowData,
  ) {
    try {
      await api(`/api/playlists/${playlistId}/tracks`, "POST", {
        tracks: [
          toTrackReferencePayload({
            ...track,
            album: track.album || displayName,
            duration: track.duration || 0,
          }),
        ],
      });
      toast.success(
        t("album.toasts.trackAddedToPlaylist", { title: track.title }),
      );
    } catch {
      toast.error(t("album.toasts.addTrackToPlaylistFailed"));
    }
  }

  function handleCreatePlaylistFromAlbum() {
    if (!data) return;
    openCreatePlaylist({
      name: displayName,
      tracks: playableAlbumTracks.map((track) =>
        toPlayableTrack({
          id: track.id,
          globalTrackUid:
            track.globalTrackUid ?? track.global_track_uid ?? track.global_uid,
          global_artist_uid: data.global_artist_uid,
          global_album_uid: globalAlbumUid,
          entity_uid: track.entity_uid,
          title: track.tags.title || track.filename,
          artist: artistName,
          artist_entity_uid: data.artist_entity_uid,
          album: displayName,
          album_entity_uid: data.entity_uid,
          duration: track.length_sec,
          path: track.path,
          library_track_id: typeof track.id === "number" ? track.id : undefined,
          bpm: track.bpm,
          audio_key: track.audio_key,
          audio_scale: track.audio_scale,
          energy: track.energy,
          danceability: track.danceability,
          valence: track.valence,
          bliss_vector: track.bliss_vector,
        }),
      ),
    });
    closeAlbumMenu();
    setPlaylistPickerOpen(false);
  }

  function handleCreatePlaylistFromTrack(track: TrackRowData) {
    openCreatePlaylist({
      tracks: [
        toPlayableTrack({
          ...track,
          album: track.album || displayName,
          library_track_id:
            track.library_track_id ??
            (typeof track.id === "number" ? track.id : undefined),
        }),
      ],
    });
  }

  function handleCreatePlaylistFromSelection() {
    if (!selectedPlayerTracks.length) return;
    openCreatePlaylist({
      name: `${displayName} selection`,
      tracks: selectedPlayerTracks,
    });
    clearTrackSelection();
    setSelectionPlaylistPickerOpen(false);
    handleCloseSelectionMenu();
  }

  return {
    handleAddSelectedToCollection,
    handleAddSelectedToPlaylist,
    handleAddSelectedToQueue,
    handleAddToPlaylist,
    handleAddTrackToPlaylist,
    handleCreatePlaylistFromAlbum,
    handleCreatePlaylistFromSelection,
    handleCreatePlaylistFromTrack,
    handlePlaySelectedNext,
  };
}
