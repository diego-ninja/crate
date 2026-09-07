import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Sparkles, type LucideIcon } from "@crate/ui/icons";

import {
  ItemActionMenu,
  ItemActionMenuButton,
  type ItemActionMenuEntry,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import { useOffline } from "@/contexts/OfflineContext";
import {
  PlaylistArtwork,
  type PlaylistArtworkTrack,
} from "@/components/playlists/PlaylistArtwork";
import { PlaylistListRowActions } from "@/components/playlists/PlaylistListRowActions";
import { PlaylistListRowInfo } from "@/components/playlists/PlaylistListRowInfo";
import {
  getPlaylistBadgeLabel,
  getPlaylistOfflinePresentation,
} from "@/components/playlists/playlist-list-row-model";
import { usePlaylistListRowPlayback } from "@/components/playlists/use-playlist-list-row-playback";
import { isOfflineBusy } from "@/lib/offline";
import { cn } from "@/lib/utils";

interface PlaylistListRowProps {
  playlistId?: number;
  name: string;
  isSmart?: boolean;
  description?: string;
  coverDataUrl?: string | null;
  artworkTracks?: PlaylistArtworkTrack[];
  trackCount: number;
  meta?: string;
  href: string;
  detailEndpoint: string;
  badge?: "smart" | "curated" | "personal";
  crateManaged?: boolean;
  followState?: {
    isFollowed: boolean;
    onToggle: () => Promise<void>;
  };
  extraActions?: Array<{
    key: string;
    icon: LucideIcon;
    title: string;
    onClick: () => void | Promise<void>;
    loading?: boolean;
    tone?: "default" | "danger" | "primary";
  }>;
}

export function PlaylistListRow({
  playlistId,
  name,
  isSmart = false,
  description,
  coverDataUrl,
  artworkTracks,
  trackCount,
  meta,
  href,
  detailEndpoint,
  badge,
  crateManaged = false,
  followState,
  extraActions,
}: PlaylistListRowProps) {
  const navigate = useNavigate();
  const { getPlaylistState, getPlaylistRecord } = useOffline();
  const [togglingFollow, setTogglingFollow] = useState(false);
  const offlineState = getPlaylistState(playlistId);
  const offlineRecord = getPlaylistRecord(playlistId);
  const { loadAndPlay, playingMode } = usePlaylistListRowPlayback({
    detailEndpoint,
    name,
    playlistId,
  });
  const { meta: offlineMeta } = getPlaylistOfflinePresentation(
    offlineState,
    offlineRecord,
  );

  const baseActions = usePlaylistActionEntries({
    playlistId,
    name,
    isSmart,
    href,
    canFollow: Boolean(followState),
    isFollowed: followState?.isFollowed,
    onToggleFollow: followState?.onToggle,
    onPlay: () => loadAndPlay("play"),
    onShuffle: () => loadAndPlay("shuffle"),
  });
  const menuActions = useMemo<ItemActionMenuEntry[]>(() => {
    if (!extraActions?.length) return baseActions;
    return [
      ...baseActions,
      { type: "divider", key: "divider-extra-actions" },
      ...extraActions.map((item) => ({
        key: `extra-${item.key}`,
        label: item.title,
        icon: item.icon,
        danger: item.tone === "danger",
        onSelect: item.onClick,
      })),
    ];
  }, [baseActions, extraActions]);
  const actionMenu = useItemActionMenu(menuActions);

  async function handleToggleFollow(
    event: React.MouseEvent<HTMLButtonElement>,
  ) {
    event.stopPropagation();
    if (!followState) return;
    setTogglingFollow(true);
    try {
      await followState.onToggle();
    } finally {
      setTogglingFollow(false);
    }
  }

  const badgeLabel = getPlaylistBadgeLabel(crateManaged, badge);

  return (
    <div
      role="button"
      tabIndex={0}
      onContextMenu={actionMenu.handleContextMenu}
      onClick={() => navigate(href)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate(href);
        }
      }}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        offlineState === "ready"
          ? "bg-accent-action/[0.04] hover:bg-accent-action/[0.08] focus-visible:bg-accent-action/[0.08]"
          : isOfflineBusy(offlineState)
            ? "bg-accent-action/[0.05] hover:bg-accent-action/[0.09] focus-visible:bg-accent-action/[0.09]"
            : offlineState === "error"
              ? "bg-state-warning/[0.05] hover:bg-state-warning/[0.09] focus-visible:bg-state-warning/[0.09]"
              : "hover:bg-text-primary/5 focus-visible:bg-text-primary/5",
      )}
    >
      <PlaylistArtwork
        name={name}
        coverDataUrl={coverDataUrl}
        tracks={artworkTracks}
        showCrateMark={crateManaged}
        className=" size-12 shrink-0 rounded-md"
      />

      <PlaylistListRowInfo
        badgeLabel={badgeLabel}
        description={description}
        meta={meta}
        name={name}
        offlineMeta={offlineMeta}
        offlineState={offlineState}
        trackCount={trackCount}
      />
      <PlaylistListRowActions
        extraActions={extraActions}
        followState={followState}
        onToggleFollow={handleToggleFollow}
        onPlay={(event) => {
          event.stopPropagation();
          void loadAndPlay("play");
        }}
        onShuffle={(event) => {
          event.stopPropagation();
          void loadAndPlay("shuffle");
        }}
        playingMode={playingMode}
        togglingFollow={togglingFollow}
      />
      <div className="flex shrink-0 items-center gap-1">
        <ItemActionMenuButton
          buttonRef={actionMenu.triggerRef}
          hasActions={actionMenu.hasActions}
          onClick={actionMenu.openFromTrigger}
          className="opacity-80 transition-opacity hover:opacity-100"
        />
      </div>
      <ItemActionMenu
        actions={menuActions}
        header={{
          type: "media",
          title: name,
          subtitle: `${trackCount} track${trackCount !== 1 ? "s" : ""}${
            meta ? ` · ${meta}` : ""
          }`,
          detail: description,
          imageShape: "square",
          fallbackIcon: Sparkles,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}
