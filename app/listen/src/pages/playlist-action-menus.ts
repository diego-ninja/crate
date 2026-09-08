import type { TFunction } from "i18next";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowDownToLineBold,
  Loader2,
  Pencil,
  Play,
  Radio,
  RefreshCw,
  Share2,
  Shuffle,
  Trash2,
  Users,
  type CrateIcon,
} from "@crate/ui/icons";
import type { ContextMenuEntry } from "@crate/ui/domain/actions";

import type { Track } from "@/contexts/PlayerContext";
import type { OfflineItemState } from "@/lib/offline";
import type { PlaylistOfflinePresentation } from "@/pages/playlist-page-model";
import type { PlaylistData } from "@/pages/playlist-types";
import type { PlaylistHeroSecondaryAction } from "@/components/playlists/PlaylistHeroSection";

export interface PlaylistActionMenuInput {
  data: PlaylistData | undefined;
  offlinePresentation: PlaylistOfflinePresentation;
  offlineState: OfflineItemState;
  offlineSupported: boolean;
  playerTracks: Track[];
  offlineIcon: CrateIcon;
  handlePlay: () => void;
  handleShuffle: () => void;
  handlePlaylistRadio: () => void | Promise<void>;
  handleRegenerate: () => void | Promise<void>;
  handleShare: () => void;
  handleToggleOffline: () => void | Promise<void>;
  setDeleteOpen: (value: boolean) => void;
  setEditorOpen: (value: boolean) => void;
  setMembersOpen: (value: boolean) => void;
  t: TFunction;
}

export function buildPlaylistSecondaryActions({
  data,
  offlinePresentation,
  offlineState,
  offlineSupported,
  playerTracks,
  offlineIcon,
  handlePlaylistRadio,
  handleShare,
  handleToggleOffline,
  setEditorOpen,
  setMembersOpen,
  t,
}: PlaylistActionMenuInput): PlaylistHeroSecondaryAction[] {
  if (!data) return [];

  return [
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
      disabled: !offlineSupported || data.is_smart || offlinePresentation.busy,
      title: offlinePresentation.buttonLabel,
      onClick: () => void handleToggleOffline(),
    },
    ...(data.is_collaborative
      ? [
          {
            key: "collaborators",
            label: t("playlist.actions.collabs"),
            ariaLabel: t("playlist.actions.collaborators"),
            icon: Users,
            onClick: () => setMembersOpen(true),
          } satisfies PlaylistHeroSecondaryAction,
        ]
      : []),
    {
      key: "edit",
      label: t("common.edit"),
      ariaLabel: t("common.edit"),
      icon: Pencil,
      onClick: () => setEditorOpen(true),
    },
    {
      key: "share",
      label: t("common.share"),
      ariaLabel: t("common.share"),
      icon: Share2,
      onClick: handleShare,
    },
  ];
}

export function buildPlaylistMenuItems({
  data,
  offlinePresentation,
  offlineState,
  offlineSupported,
  playerTracks,
  offlineIcon,
  handlePlay,
  handleShuffle,
  handlePlaylistRadio,
  handleRegenerate,
  handleShare,
  handleToggleOffline,
  setDeleteOpen,
  setEditorOpen,
  setMembersOpen,
  t,
}: PlaylistActionMenuInput): ContextMenuEntry[] {
  if (!data) return [];

  return [
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
    { type: "divider", key: "playlist-state-divider" },
    {
      key: "offline",
      label: offlinePresentation.buttonLabel,
      icon: offlineIcon,
      active: offlineState === "ready",
      disabled: !offlineSupported || data.is_smart || offlinePresentation.busy,
      onSelect: handleToggleOffline,
    },
    ...(data.is_collaborative
      ? [
          {
            key: "collaborators",
            label: t("playlist.actions.collaborators"),
            icon: Users,
            onSelect: () => setMembersOpen(true),
          } satisfies ContextMenuEntry,
        ]
      : []),
    {
      key: "edit",
      label: t("playlist.actions.editPlaylist"),
      icon: Pencil,
      onSelect: () => setEditorOpen(true),
    },
    ...(data.is_smart
      ? [
          {
            key: "regenerate",
            label: t("playlist.actions.regenerate"),
            icon: RefreshCw,
            onSelect: handleRegenerate,
          } satisfies ContextMenuEntry,
        ]
      : []),
    {
      key: "share",
      label: t("playlist.actions.sharePlaylist"),
      icon: Share2,
      onSelect: handleShare,
    },
    { type: "divider", key: "playlist-danger-divider" },
    {
      key: "delete",
      label: t("playlist.actions.deletePlaylist"),
      icon: Trash2,
      danger: true,
      onSelect: () => setDeleteOpen(true),
    },
  ];
}

export function getPlaylistOfflineIcon(
  offlineState: OfflineItemState,
  offlinePresentation: PlaylistOfflinePresentation,
): CrateIcon {
  return offlineState === "ready"
    ? ArrowDownToLineBold
    : offlinePresentation.busy
      ? Loader2
      : offlineState === "error"
        ? AlertCircle
        : ArrowDownToLine;
}
