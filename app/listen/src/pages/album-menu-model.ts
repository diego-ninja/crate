import type { TFunction } from "i18next";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowDownToLineBold,
  Heart,
  ListPlus,
  Loader2,
  Plus,
  Play,
  Share2,
  User,
} from "@crate/ui/icons";

import type { ContextMenuEntry } from "@/components/actions/ItemActionMenu";
import type { PlaylistOption } from "@/hooks/use-lazy-playlist-options";
import type { OfflineItemState } from "@/lib/offline";

interface AlbumMenuActions {
  playlistPickerOpen: boolean;
  canPersistAlbum: boolean;
  canSaveAlbum: boolean;
  saved: boolean;
  offlineSupported: boolean;
  offlineState: OfflineItemState;
  offlineButtonLabel: string;
  playlists: PlaylistOption[];
  onPlay: () => void;
  onPlayNext: () => void;
  onTogglePlaylistPicker: () => void;
  onCreatePlaylist: () => void;
  onAddToPlaylist: (playlistId: number) => void | Promise<void>;
  onToggleSaved: () => void | Promise<void>;
  onToggleOffline: () => void | Promise<void>;
  onGoToArtist: () => void;
  onShare: () => void | Promise<void>;
}

export function buildAlbumMenuItems(
  options: AlbumMenuActions,
  t: TFunction,
): ContextMenuEntry[] {
  return [
    {
      key: "play",
      label: t("album.actions.playNow"),
      icon: Play,
      onSelect: options.onPlay,
    },
    {
      key: "play-next",
      label: t("album.actions.playNext"),
      icon: ListPlus,
      onSelect: options.onPlayNext,
    },
    ...(options.canPersistAlbum
      ? [
          {
            type: "disclosure" as const,
            key: "playlist",
            label: t("playlist.actions.addToPlaylist"),
            icon: ListPlus,
            expanded: options.playlistPickerOpen,
            onToggle: options.onTogglePlaylistPicker,
            items: [
              {
                key: "playlist-create",
                label: t("playlist.actions.addNew"),
                onSelect: options.onCreatePlaylist,
              },
              ...options.playlists.map((playlist) => ({
                key: `playlist-${playlist.id}`,
                label: playlist.name,
                onSelect: () => options.onAddToPlaylist(playlist.id),
              })),
            ],
          },
        ]
      : []),
    ...(options.canSaveAlbum
      ? [
          {
            key: "save",
            label: options.saved
              ? t("album.actions.removeFromCollection")
              : t("album.actions.addToCollection"),
            icon: Heart,
            active: options.saved,
            onSelect: options.onToggleSaved,
          },
        ]
      : []),
    ...(options.canPersistAlbum
      ? [
          {
            key: "offline",
            label: options.offlineButtonLabel,
            icon:
              options.offlineState === "ready"
                ? ArrowDownToLineBold
                : options.offlineState === "queued" ||
                    options.offlineState === "downloading" ||
                    options.offlineState === "syncing"
                  ? Loader2
                  : options.offlineState === "error"
                    ? AlertCircle
                    : ArrowDownToLine,
            active: options.offlineState === "ready",
            disabled:
              !options.offlineSupported ||
              options.offlineState === "queued" ||
              options.offlineState === "downloading" ||
              options.offlineState === "syncing",
            onSelect: options.onToggleOffline,
          },
        ]
      : []),
    {
      key: "artist",
      label: t("album.actions.goToArtist"),
      icon: User,
      onSelect: options.onGoToArtist,
    },
    {
      key: "share",
      label: t("common.share"),
      icon: Share2,
      onSelect: options.onShare,
    },
  ];
}

interface AlbumSelectionMenuActions {
  selectedCount: number;
  selectionMenuPlaylistOpen: boolean;
  playlists: PlaylistOption[];
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onTogglePlaylist: () => void;
  onCreatePlaylist: () => void;
  onAddToPlaylist: (playlistId: number) => void | Promise<void>;
  onAddToCollection: () => void | Promise<void>;
}

export function buildAlbumSelectionMenuItems(
  options: AlbumSelectionMenuActions,
  t: TFunction,
): ContextMenuEntry[] {
  return [
    {
      type: "label",
      key: "selected-count",
      label: t("common.selectedCount", { count: options.selectedCount }),
    },
    {
      key: "play-next",
      label: t("album.actions.playNext"),
      icon: ListPlus,
      onSelect: options.onPlayNext,
    },
    {
      key: "queue",
      label: t("album.actions.addToQueue"),
      icon: Plus,
      onSelect: options.onAddToQueue,
    },
    {
      type: "disclosure",
      key: "playlist",
      label: t("playlist.actions.addToPlaylist"),
      icon: ListPlus,
      expanded: options.selectionMenuPlaylistOpen,
      onToggle: options.onTogglePlaylist,
      items: [
        {
          key: "playlist-create",
          label: t("playlist.actions.addNew"),
          onSelect: options.onCreatePlaylist,
        },
        ...options.playlists.map((playlist) => ({
          key: `playlist-${playlist.id}`,
          label: playlist.name,
          onSelect: () => options.onAddToPlaylist(playlist.id),
        })),
      ],
    },
    {
      type: "divider",
      key: "collection-divider",
    },
    {
      key: "collection",
      label: t("album.actions.addToMyCollection"),
      icon: Heart,
      onSelect: options.onAddToCollection,
    },
  ];
}
