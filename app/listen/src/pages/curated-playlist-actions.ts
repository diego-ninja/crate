import type { TFunction } from "i18next";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowDownToLineBold,
  Heart,
  HeartBold,
  Loader2,
  Play,
  Radio,
  Share2,
  Shuffle,
  type CrateIcon,
} from "@crate/ui/icons";
import type { ContextMenuEntry } from "@crate/ui/domain/actions";
import { toast } from "sonner";

import type { TrackRowData } from "@/components/cards/TrackRow";
import type { PlaylistHeroSecondaryAction } from "@/components/playlists/PlaylistHeroSection";
import type { useOffline } from "@/contexts/OfflineContext";
import type { Track } from "@/contexts/PlayerContext";
import type { PlayerActionsValue } from "@/contexts/player-context";
import type { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { api, resolveMaybeApiAssetUrl } from "@/lib/api";
import type { OfflineItemState } from "@/lib/offline";
import { toPlayableTrack } from "@/lib/playable-track";
import {
  hasTrackReference,
  toTrackReferencePayload,
} from "@/lib/track-reference";
import { fetchPlaylistRadio } from "@/lib/radio";
import { publicShareUrl } from "@/lib/share-url";
import { openShareSheet } from "@/lib/social-share";
import { shuffleArray } from "@/lib/utils";
import type { CuratedOfflinePresentation } from "@/pages/curated-playlist-model";
import type { CuratedPlaylistData } from "@/pages/curated-playlist-types";

type OpenCreatePlaylist = ReturnType<
  typeof usePlaylistComposer
>["openCreatePlaylist"];

interface CuratedPlaylistActionInput {
  data: CuratedPlaylistData | undefined;
  id: string | undefined;
  offlinePresentation: CuratedOfflinePresentation;
  offlineState: OfflineItemState;
  offlineSupported: boolean;
  openCreatePlaylist: OpenCreatePlaylist;
  playerTracks: Track[];
  playAll: PlayerActionsValue["playAll"];
  refetch: () => void;
  setTogglingFollow: (value: boolean) => void;
  t: TFunction;
  togglePlaylistOffline: ReturnType<typeof useOffline>["togglePlaylistOffline"];
  togglingFollow: boolean;
}

export interface CuratedPlaylistActions {
  handleAddTrackToPlaylist: (
    playlistId: number,
    track: TrackRowData,
  ) => Promise<void>;
  handleCreatePlaylistFromTrack: (track: TrackRowData) => void;
  handlePlay: () => void;
  handlePlayTrack: (trackEntryId: number) => void;
  handlePlaylistRadio: () => Promise<void>;
  handleShare: () => void;
  handleShuffle: () => void;
  handleToggleFollow: () => Promise<void>;
  handleToggleOffline: () => Promise<void>;
  offlineIcon: CrateIcon;
  playlistMenuItems: ContextMenuEntry[];
  secondaryActions: PlaylistHeroSecondaryAction[];
}

export function buildCuratedPlaylistActions({
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
}: CuratedPlaylistActionInput): CuratedPlaylistActions {
  function handlePlay() {
    if (!playerTracks.length) return;
    playAll(playerTracks, 0, {
      type: "playlist",
      name: data?.name || "Playlist",
      href: data ? `/curation/playlists/${data.id}` : undefined,
      radio: data ? { seedType: "playlist", seedId: data.id } : undefined,
    });
  }

  function handlePlayTrack(trackEntryId: number) {
    if (!data || !playerTracks.length) return;
    const startIndex = data.tracks.findIndex(
      (track) => track.id === trackEntryId,
    );
    if (startIndex < 0) return;
    playAll(playerTracks, startIndex, {
      type: "playlist",
      name: data.name || "Playlist",
      href: `/curation/playlists/${data.id}`,
      radio: { seedType: "playlist", seedId: data.id },
    });
  }

  function handleShuffle() {
    if (!playerTracks.length) return;
    playAll(shuffleArray(playerTracks), 0, {
      type: "playlist",
      name: data?.name || "Playlist",
      href: data ? `/curation/playlists/${data.id}` : undefined,
      radio: data ? { seedType: "playlist", seedId: data.id } : undefined,
    });
  }

  async function handlePlaylistRadio() {
    if (!data) return;
    try {
      const radio = await fetchPlaylistRadio({
        playlistId: data.id,
        playlistName: data.name,
      });
      if (!radio.tracks.length) {
        toast.info(t("playlist.toasts.radioUnavailable"));
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error(t("playlist.toasts.radioFailed"));
    }
  }

  function handleShare() {
    if (!data) return;
    openShareSheet({
      kind: "playlist",
      title: data.name,
      subtitle: data.description,
      imageUrl: resolveMaybeApiAssetUrl(data.cover_data_url),
      url: publicShareUrl(`/curation/playlist/${data.id}`),
    });
  }

  async function handleAddTrackToPlaylist(
    playlistId: number,
    track: TrackRowData,
  ) {
    if (!hasTrackReference(track)) return;
    try {
      await api(`/api/playlists/${playlistId}/tracks`, "POST", {
        tracks: [
          toTrackReferencePayload({
            ...track,
            album: track.album || "",
            duration: track.duration || 0,
          }),
        ],
      });
      toast.success(t("playlist.toasts.trackAdded"));
    } catch {
      toast.error(t("playlist.toasts.trackAddFailed"));
    }
  }

  function handleCreatePlaylistFromTrack(track: TrackRowData) {
    openCreatePlaylist({
      tracks: hasTrackReference(track) ? [toPlayableTrack(track)] : [],
    });
  }

  async function handleToggleFollow() {
    if (!id || !data) return;
    setTogglingFollow(true);
    try {
      if (data.is_followed) {
        await api(`/api/curation/playlists/${id}/follow`, "DELETE");
        toast.success(t("playlist.toasts.removedLibrary"));
      } else {
        await api(`/api/curation/playlists/${id}/follow`, "POST");
        toast.success(t("playlist.toasts.addedLibrary"));
      }
      refetch();
    } catch {
      toast.error(t("playlist.toasts.updateFailed"));
    } finally {
      setTogglingFollow(false);
    }
  }

  async function handleToggleOffline() {
    if (!data) return;
    try {
      const result = await togglePlaylistOffline({
        playlistId: data.id,
        title: data.name,
        isSmart: data.is_smart,
      });
      toast.success(
        result === "removed"
          ? t("playlist.toasts.offlineRemoved")
          : t("playlist.toasts.availableOffline"),
      );
    } catch (offlineError) {
      toast.error(
        (offlineError as Error).message ||
          t("playlist.toasts.offlineUpdateFailed"),
      );
    }
  }

  const offlineIcon: CrateIcon =
    offlineState === "ready"
      ? ArrowDownToLineBold
      : offlinePresentation.busy
        ? Loader2
        : offlineState === "error"
          ? AlertCircle
          : ArrowDownToLine;
  const secondaryActions: PlaylistHeroSecondaryAction[] = data
    ? [
        {
          key: "radio",
          label: "Radio",
          ariaLabel: t("playlist.actions.radio"),
          icon: Radio,
          disabled: playerTracks.length === 0,
          onClick: () => void handlePlaylistRadio(),
        },
        {
          key: "offline",
          label: t("common.offline"),
          ariaLabel:
            offlineState === "ready"
              ? t("playlist.offline.removeCopy")
              : t("playlist.offline.makeAvailable"),
          icon: offlineIcon,
          iconClassName: offlinePresentation.busy ? "animate-spin" : undefined,
          className:
            offlineState === "ready"
              ? "text-text-accent drop-shadow-accent-action"
              : offlinePresentation.busy
                ? "text-accent-action"
                : offlineState === "error"
                  ? "text-state-warning-text/90"
                  : undefined,
          disabled:
            !offlineSupported || data.is_smart || offlinePresentation.busy,
          title: offlinePresentation.buttonLabel,
          onClick: () => void handleToggleOffline(),
        },
        {
          key: "follow",
          label: data.is_followed ? t("common.following") : t("common.follow"),
          ariaLabel: data.is_followed
            ? t("playlist.actions.removeFromLibrary")
            : t("common.follow"),
          icon: togglingFollow ? Loader2 : data.is_followed ? HeartBold : Heart,
          iconClassName: togglingFollow ? "animate-spin" : undefined,
          active: data.is_followed,
          pulseIcon: data.is_followed,
          disabled: togglingFollow,
          onClick: () => void handleToggleFollow(),
        },
        {
          key: "share",
          label: t("common.share"),
          ariaLabel: t("common.share"),
          icon: Share2,
          onClick: handleShare,
        },
      ]
    : [];
  const playlistMenuItems: ContextMenuEntry[] = data
    ? [
        {
          key: "play",
          label: t("playlist.actions.playPlaylist"),
          icon: Play,
          disabled: playerTracks.length === 0,
          onSelect: handlePlay,
        },
        {
          key: "shuffle",
          label: t("playlist.actions.shufflePlaylist"),
          icon: Shuffle,
          disabled: playerTracks.length === 0,
          onSelect: handleShuffle,
        },
        {
          key: "radio",
          label: t("playlist.actions.startRadio"),
          icon: Radio,
          disabled: playerTracks.length === 0,
          onSelect: handlePlaylistRadio,
        },
        { type: "divider", key: "curated-playlist-library-divider" },
        {
          key: "follow",
          label: data.is_followed
            ? t("playlist.actions.removeFromLibrary")
            : t("playlist.actions.addToLibrary"),
          icon: data.is_followed ? HeartBold : Heart,
          active: data.is_followed,
          disabled: togglingFollow,
          onSelect: handleToggleFollow,
        },
        {
          key: "offline",
          label: offlinePresentation.buttonLabel,
          icon: offlineIcon,
          active: offlineState === "ready",
          disabled:
            !offlineSupported || data.is_smart || offlinePresentation.busy,
          onSelect: handleToggleOffline,
        },
        { type: "divider", key: "curated-playlist-share-divider" },
        {
          key: "share",
          label: t("playlist.actions.sharePlaylist"),
          icon: Share2,
          onSelect: handleShare,
        },
      ]
    : [];

  return {
    handleAddTrackToPlaylist,
    handleCreatePlaylistFromTrack,
    handlePlay,
    handlePlayTrack,
    handlePlaylistRadio,
    handleShare,
    handleShuffle,
    handleToggleFollow,
    handleToggleOffline,
    offlineIcon,
    playlistMenuItems,
    secondaryActions,
  };
}
