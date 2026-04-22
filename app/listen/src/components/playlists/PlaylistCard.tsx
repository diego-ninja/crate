import { useState } from "react";
import { Heart, Loader2, Play } from "lucide-react";

import { ItemActionMenu, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import { OfflineBadge } from "@/components/offline/OfflineBadge";
import { useOffline } from "@/contexts/OfflineContext";
import { PlaylistArtwork, type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import { ActionIconButton } from "@crate-ui/primitives/ActionIconButton";
import { getOfflineStateLabel, isOfflineBusy } from "@/lib/offline";
import { cn } from "@/lib/utils";

interface PlaylistCardProps {
  playlistId?: number;
  name: string;
  isSmart?: boolean;
  description?: string;
  tracks?: PlaylistArtworkTrack[];
  coverDataUrl?: string | null;
  meta: string;
  badge?: string;
  systemPlaylist?: boolean;
  crateManaged?: boolean;
  isFollowed?: boolean;
  href?: string;
  layout?: "rail" | "grid";
  onClick: () => void;
  onPlay?: () => Promise<void> | void;
  onShuffle?: () => Promise<void> | void;
  onStartRadio?: () => Promise<void> | void;
  onToggleFollow?: () => Promise<void> | void;
}

export function PlaylistCard({
  playlistId,
  name,
  isSmart = false,
  description,
  tracks,
  coverDataUrl,
  meta,
  badge,
  systemPlaylist = false,
  crateManaged = false,
  isFollowed = false,
  href,
  layout = "rail",
  onClick,
  onPlay,
  onShuffle,
  onStartRadio,
  onToggleFollow,
}: PlaylistCardProps) {
  const [playing, setPlaying] = useState(false);
  const [togglingFollow, setTogglingFollow] = useState(false);
  const { getPlaylistState, getPlaylistRecord } = useOffline();
  const offlineState = getPlaylistState(playlistId);
  const offlineRecord = getPlaylistRecord(playlistId);
  const offlineMeta =
    offlineState === "ready"
      ? offlineRecord?.trackCount
        ? `${offlineRecord.trackCount} offline`
        : getOfflineStateLabel(offlineState)
      : isOfflineBusy(offlineState) && offlineRecord?.trackCount
        ? `${Math.min(offlineRecord.readyTrackCount || 0, offlineRecord.trackCount)}/${offlineRecord.trackCount} offline`
        : getOfflineStateLabel(offlineState);
  const actions = usePlaylistActionEntries({
    playlistId,
    name,
    isSmart,
    href,
    canFollow: systemPlaylist && Boolean(onToggleFollow),
    isFollowed,
    onToggleFollow,
    onPlay,
    onShuffle,
    onStartRadio,
  });
  const actionMenu = useItemActionMenu(actions);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        actionMenu.handleKeyboardTrigger(event);
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      {...actionMenu.longPressHandlers}
      className={cn(
        "group cursor-pointer rounded-xl p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-xl",
        layout === "grid" ? "w-full min-w-0" : "w-[160px] flex-shrink-0",
        offlineState === "ready"
          ? "bg-cyan-400/[0.04]"
          : isOfflineBusy(offlineState)
            ? "bg-primary/[0.05]"
            : offlineState === "error"
              ? "bg-amber-400/[0.05]"
              : "hover:bg-white/5",
      )}
    >
      <div className="relative mb-2 overflow-hidden rounded-lg bg-white/5">
        <PlaylistArtwork
          name={name}
          coverDataUrl={coverDataUrl}
          tracks={tracks}
          showCrateMark={crateManaged}
          className="aspect-square rounded-lg transition-transform group-hover:scale-[1.02]"
        />
        {systemPlaylist && onToggleFollow ? (
          <ActionIconButton
            variant="card"
            active={isFollowed}
            className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100"
            onClick={async (event) => {
              event.stopPropagation();
              setTogglingFollow(true);
              try {
                await onToggleFollow();
              } finally {
                setTogglingFollow(false);
              }
            }}
          >
            {togglingFollow ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Heart size={16} className={isFollowed ? "fill-current" : ""} />
            )}
          </ActionIconButton>
        ) : null}
        {onPlay ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
            <button
              className="flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-primary opacity-0 shadow-lg transition-all group-hover:translate-y-0 group-hover:opacity-100"
              onClick={async (event) => {
                event.stopPropagation();
                setPlaying(true);
                try {
                  await onPlay();
                } finally {
                  setPlaying(false);
                }
              }}
            >
              {playing ? (
                <Loader2 size={18} className="animate-spin text-primary-foreground" />
              ) : (
                <Play size={18} fill="#0a0a0f" className="ml-0.5 text-primary-foreground" />
              )}
            </button>
          </div>
        ) : null}
        {badge && !crateManaged ? (
          <div className="absolute left-2 top-2 rounded-full border border-primary/20 bg-[var(--gradient-bg-85)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary backdrop-blur-md">
            {badge}
          </div>
        ) : null}
        <OfflineBadge
          state={offlineState}
          compact
          className={badge && !crateManaged ? "absolute left-2 top-8" : "absolute left-2 top-2"}
        />
      </div>
      <div className="truncate text-sm font-medium text-foreground">{name}</div>
      <div className="truncate text-xs text-muted-foreground">
        {description || meta}
        {offlineMeta ? (
          <span
            className={cn(
              "ml-1.5",
              offlineState === "ready"
                ? "text-cyan-300/90"
                : isOfflineBusy(offlineState)
                  ? "text-primary"
                  : offlineState === "error"
                    ? "text-amber-300/90"
                    : undefined,
            )}
          >
            · {offlineMeta}
          </span>
        ) : null}
      </div>
      <ItemActionMenu
        actions={actions}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}
