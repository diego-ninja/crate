import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Heart, Loader2, Play, Shuffle, Sparkles, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { ItemActionMenu, ItemActionMenuButton, type ItemActionMenuEntry, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import { OfflineBadge } from "@/components/offline/OfflineBadge";
import { useOffline } from "@/contexts/OfflineContext";
import { api } from "@/lib/api";
import { PlaylistArtwork, type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { getOfflineStateLabel, isOfflineBusy } from "@/lib/offline";
import { cn, shuffleArray } from "@/lib/utils";
import { albumCoverApiUrl } from "@/lib/library-routes";

interface PlaylistTrackResponse {
  track_id?: number;
  track_path: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_slug?: string;
  duration: number;
}

interface PlaylistDetailResponse {
  tracks: PlaylistTrackResponse[];
}

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


function toPlayerTracks(tracks: PlaylistTrackResponse[]): Track[] {
  return tracks.map((track) => ({
    id: track.track_path,
    title: track.title || "Unknown",
    artist: track.artist || "",
    artistId: track.artist_id,
    artistSlug: track.artist_slug,
    album: track.album,
    albumId: track.album_id,
    albumSlug: track.album_slug,
    albumCover:
      track.artist && track.album
        ? albumCoverApiUrl({ albumId: track.album_id, albumSlug: track.album_slug, artistName: track.artist, albumName: track.album })
        : undefined,
    path: track.track_path,
    libraryTrackId: track.track_id,
  }));
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
  const { playAll } = usePlayerActions();
  const { getPlaylistState, getPlaylistRecord } = useOffline();
  const [playingMode, setPlayingMode] = useState<"play" | "shuffle" | null>(null);
  const [togglingFollow, setTogglingFollow] = useState(false);
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

  const loadAndPlay = useCallback(async (mode: "play" | "shuffle") => {
    setPlayingMode(mode);
    try {
      const response = await api<PlaylistDetailResponse>(detailEndpoint);
      const tracks = toPlayerTracks(response.tracks || []);
      if (tracks.length === 0) {
        toast.message("This playlist has no playable tracks yet");
        return;
      }
      const queue = mode === "shuffle" ? shuffleArray(tracks) : tracks;
      playAll(queue, 0, {
        type: "playlist",
        name,
        radio: playlistId != null ? { seedType: "playlist", seedId: playlistId } : undefined,
      });
    } catch {
      toast.error("Failed to load playlist");
    } finally {
      setPlayingMode(null);
    }
  }, [detailEndpoint, name, playAll, playlistId]);

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

  async function handleToggleFollow(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!followState) return;
    setTogglingFollow(true);
    try {
      await followState.onToggle();
    } finally {
      setTogglingFollow(false);
    }
  }

  const badgeLabel =
    crateManaged
      ? null
      :
    badge === "smart" ? "Smart" : badge === "curated" ? "Curated" : null;

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
          ? "bg-cyan-400/[0.04] hover:bg-cyan-400/[0.08] focus-visible:bg-cyan-400/[0.08]"
          : isOfflineBusy(offlineState)
            ? "bg-primary/[0.05] hover:bg-primary/[0.09] focus-visible:bg-primary/[0.09]"
            : offlineState === "error"
              ? "bg-amber-400/[0.05] hover:bg-amber-400/[0.09] focus-visible:bg-amber-400/[0.09]"
              : "hover:bg-white/5 focus-visible:bg-white/5",
      )}
    >
      <PlaylistArtwork
        name={name}
        coverDataUrl={coverDataUrl}
        tracks={artworkTracks}
        showCrateMark={crateManaged}
        className="h-12 w-12 flex-shrink-0 rounded-md"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          {badgeLabel ? (
            <span className="inline-flex items-center rounded-md border border-primary/30 px-1.5 py-0 text-[10px] font-medium text-primary">
              <Sparkles size={10} className="mr-0.5" />
              {badgeLabel}
            </span>
          ) : null}
          <OfflineBadge state={offlineState} compact />
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {trackCount} track{trackCount !== 1 ? "s" : ""}
          {meta ? ` · ${meta}` : ""}
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
        {description ? <div className="mt-1 truncate text-[11px] text-white/40">{description}</div> : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <ActionIconButton
          onClick={(event) => {
            event.stopPropagation();
            void loadAndPlay("play");
          }}
          title="Play"
        >
          {playingMode === "play" ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
        </ActionIconButton>
        <ActionIconButton
          onClick={(event) => {
            event.stopPropagation();
            void loadAndPlay("shuffle");
          }}
          title="Shuffle"
        >
          {playingMode === "shuffle" ? <Loader2 size={15} className="animate-spin" /> : <Shuffle size={15} />}
        </ActionIconButton>
        {followState ? (
          <ActionIconButton
            onClick={handleToggleFollow}
            active={followState.isFollowed}
            title={followState.isFollowed ? "Following" : "Follow"}
          >
            {togglingFollow ? <Loader2 size={15} className="animate-spin" /> : <Heart size={15} className={followState.isFollowed ? "fill-current" : ""} />}
          </ActionIconButton>
        ) : null}
        {extraActions?.map((action) => {
          const Icon = action.icon;

          return (
            <ActionIconButton
              key={action.key}
              onClick={async (event) => {
                event.stopPropagation();
                await action.onClick();
              }}
              tone={action.tone}
              title={action.title}
            >
              {action.loading ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
            </ActionIconButton>
          );
        })}
        <ItemActionMenuButton
          buttonRef={actionMenu.triggerRef}
          hasActions={actionMenu.hasActions}
          onClick={actionMenu.openFromTrigger}
          className="opacity-80 transition-opacity hover:opacity-100"
        />
      </div>
      <ItemActionMenu
        actions={menuActions}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}
