import { useMemo, useRef, useState, type MouseEvent } from "react";

import type { UseContextMenuControllerReturn } from "@crate/ui/domain/actions";

import type { AlbumTrack } from "@/pages/album-types";

interface AlbumSelectionState {
  albumId?: number;
  selectedTrackIds: number[];
  selectionPlaylistPickerOpen: boolean;
  selectionMenuPlaylistOpen: boolean;
}

const EMPTY_SELECTION: AlbumSelectionState = {
  selectedTrackIds: [],
  selectionPlaylistPickerOpen: false,
  selectionMenuPlaylistOpen: false,
};

export function useAlbumSelection({
  albumId,
  isDesktop,
  playableAlbumTracks,
  ensurePlaylistOptionsLoaded,
  selectionMenuController,
}: {
  albumId?: number;
  isDesktop: boolean;
  playableAlbumTracks: AlbumTrack[];
  ensurePlaylistOptionsLoaded: () => void;
  selectionMenuController: UseContextMenuControllerReturn<HTMLButtonElement>;
}) {
  const [selectionState, setSelectionState] =
    useState<AlbumSelectionState>(EMPTY_SELECTION);
  const selectionBarRef = useRef<HTMLDivElement>(null);
  const selectionAnchorTrackIdRef = useRef<number | null>(null);
  const activeSelection =
    selectionState.albumId === albumId ? selectionState : EMPTY_SELECTION;
  const { selectedTrackIds } = activeSelection;
  const selectedTrackIdSet = useMemo(
    () => new Set(selectedTrackIds),
    [selectedTrackIds],
  );
  const selectedAlbumTracks = useMemo(
    () =>
      playableAlbumTracks.filter((track) =>
        typeof track.id === "number" ? selectedTrackIdSet.has(track.id) : false,
      ),
    [playableAlbumTracks, selectedTrackIdSet],
  );

  function updateSelection(
    update: (current: AlbumSelectionState) => AlbumSelectionState,
  ) {
    setSelectionState((current) =>
      update(
        current.albumId === albumId ? current : { ...EMPTY_SELECTION, albumId },
      ),
    );
  }

  const clearTrackSelection = () => {
    selectionAnchorTrackIdRef.current = null;
    updateSelection((current) => ({
      ...current,
      albumId,
      selectedTrackIds: [],
    }));
  };

  const handleTrackSelection = (
    trackId: number,
    event: MouseEvent<HTMLDivElement>,
  ) => {
    const orderedTrackIds = playableAlbumTracks
      .map((track) => track.id)
      .filter((id): id is number => typeof id === "number");
    const trackIndex = orderedTrackIds.indexOf(trackId);
    const anchorTrackId = selectionAnchorTrackIdRef.current;
    const anchorIndex =
      anchorTrackId == null ? -1 : orderedTrackIds.indexOf(anchorTrackId);
    const additive = event.metaKey || event.ctrlKey;
    const rangeSelection =
      event.shiftKey && anchorIndex >= 0 && trackIndex >= 0;

    updateSelection((current) => {
      const selectedIds = current.selectedTrackIds;
      if (rangeSelection) {
        const start = Math.min(anchorIndex, trackIndex);
        const end = Math.max(anchorIndex, trackIndex);
        const range = orderedTrackIds.slice(start, end + 1);
        return {
          ...current,
          selectedTrackIds: additive
            ? Array.from(new Set([...selectedIds, ...range]))
            : range,
        };
      }

      return {
        ...current,
        selectedTrackIds: additive
          ? selectedIds.includes(trackId)
            ? selectedIds.filter((id) => id !== trackId)
            : [...selectedIds, trackId]
          : [trackId],
      };
    });

    if (!rangeSelection) {
      selectionAnchorTrackIdRef.current = trackId;
    }
  };

  const openSelectionMenu = (trackId: number, x: number, y: number) => {
    if (!isDesktop) return false;
    if (!selectedTrackIdSet.has(trackId)) {
      selectionAnchorTrackIdRef.current = trackId;
      updateSelection((current) => ({
        ...current,
        selectedTrackIds: [trackId],
      }));
    }
    ensurePlaylistOptionsLoaded();
    updateSelection((current) => ({
      ...current,
      selectionPlaylistPickerOpen: false,
      selectionMenuPlaylistOpen: false,
    }));
    selectionMenuController.openAtPoint(x, y);
    return true;
  };

  const handleSelectionActionMenuOpen = (
    trackId: number,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    return openSelectionMenu(trackId, rect.right - 8, rect.bottom + 8);
  };

  const handleCloseSelectionMenu = () => {
    selectionMenuController.close();
    updateSelection((current) => ({
      ...current,
      selectionMenuPlaylistOpen: false,
    }));
  };

  const handleToggleSelectionPlaylistPicker = () => {
    ensurePlaylistOptionsLoaded();
    updateSelection((current) => ({
      ...current,
      selectionPlaylistPickerOpen: !current.selectionPlaylistPickerOpen,
    }));
  };

  const handleToggleSelectionMenuPlaylist = () => {
    ensurePlaylistOptionsLoaded();
    updateSelection((current) => ({
      ...current,
      selectionMenuPlaylistOpen: !current.selectionMenuPlaylistOpen,
    }));
  };

  const setSelectionPlaylistPickerOpen = (value: boolean) => {
    updateSelection((current) => ({
      ...current,
      selectionPlaylistPickerOpen: value,
    }));
  };

  return {
    clearTrackSelection,
    handleCloseSelectionMenu,
    handleSelectionActionMenuOpen,
    handleToggleSelectionMenuPlaylist,
    handleToggleSelectionPlaylistPicker,
    handleTrackSelection,
    selectedAlbumTracks,
    selectedTrackIdSet,
    selectedTrackIds,
    selectionBarRef,
    selectionMenuPlaylistOpen: activeSelection.selectionMenuPlaylistOpen,
    selectionPlaylistPickerOpen: activeSelection.selectionPlaylistPickerOpen,
    setSelectionPlaylistPickerOpen,
  };
}
