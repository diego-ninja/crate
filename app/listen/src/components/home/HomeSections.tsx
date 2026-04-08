import type { ReactNode } from "react";
import { ArrowRight, Clock3, Loader2, Play } from "lucide-react";

import { ItemActionMenu, ItemActionMenuButton, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import { PlaylistArtwork, type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import { TrackCoverThumb } from "@/components/cards/TrackCoverThumb";
import type { Track } from "@/contexts/PlayerContext";

import type { HomeUpcomingItem } from "./home-model";

export function getHomeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function getHomeDateString(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actionLabel && onAction ? (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {actionLabel}
          <ArrowRight size={15} />
        </button>
      ) : null}
    </div>
  );
}

export function SectionRail({ children }: { children: ReactNode }) {
  return (
    <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}

export function SectionLoading() {
  return (
    <div className="flex items-center justify-center py-10">
      <Loader2 size={20} className="animate-spin text-primary" />
    </div>
  );
}

export function UpcomingPreviewRow({
  item,
  onClick,
}: {
  item: HomeUpcomingItem;
  onClick: () => void;
}) {
  const dateLabel = item.date
    ? new Date(`${item.date}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "Soon";

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-2 text-left transition-colors hover:border-white/10 hover:bg-white/5"
    >
      <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
        <span className="text-[10px] uppercase tracking-wide text-white/35">{dateLabel.split(" ")[0]}</span>
        <span className="text-sm font-semibold text-foreground">{dateLabel.split(" ")[1] || ""}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {item.type === "show" ? item.artist : item.title}
          </span>
          {item.user_attending && item.type === "show" ? (
            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              Going
            </span>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {item.type === "show" ? `${item.title} · ${item.subtitle}` : `${item.artist} · ${item.title}`}
        </div>
      </div>
      <div className="shrink-0 rounded-full border border-primary/15 bg-primary/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-primary">
        {item.type === "show" ? "Show" : "Release"}
      </div>
    </button>
  );
}

export function FeaturedPlaylistCard({
  playlistId,
  name,
  description,
  tracks,
  coverDataUrl,
  meta,
  href,
  isFollowed,
  onClick,
  onPlay,
  onToggleFollow,
  badge,
}: {
  playlistId?: number;
  name: string;
  description?: string;
  tracks?: PlaylistArtworkTrack[];
  coverDataUrl?: string | null;
  meta: string;
  href?: string;
  isFollowed?: boolean;
  badge?: string;
  onClick: () => void;
  onPlay?: () => Promise<void> | void;
  onToggleFollow?: () => Promise<void> | void;
}) {
  const actions = usePlaylistActionEntries({
    playlistId,
    name,
    href,
    canFollow: Boolean(onToggleFollow),
    isFollowed,
    onToggleFollow,
    onPlay,
  });
  const actionMenu = useItemActionMenu(actions);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      className="group w-[180px] flex-shrink-0 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-3xl"
    >
      <div className="relative">
        <PlaylistArtwork
          name={name}
          coverDataUrl={coverDataUrl}
          tracks={tracks}
          className="aspect-square rounded-3xl shadow-xl transition-transform group-hover:scale-[1.02]"
        />
        {badge ? (
          <div className="absolute left-3 top-3 rounded-full border border-primary/25 bg-[var(--gradient-bg-85)] px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-primary backdrop-blur-md">
            {badge}
          </div>
        ) : null}
        <ItemActionMenuButton
          buttonRef={actionMenu.triggerRef}
          hasActions={actionMenu.hasActions}
          onClick={actionMenu.openFromTrigger}
          className="absolute bottom-3 left-3 z-10 opacity-80 transition-opacity hover:opacity-100"
        />
      </div>
      <div className="px-1 pt-3">
        <div className="truncate text-sm font-bold text-foreground">{name}</div>
        <div className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-muted-foreground">
          {description || meta}
        </div>
        <div className="mt-2 text-[11px] uppercase tracking-wider text-white/35">{meta}</div>
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

export function ContinueListeningCard({
  track,
  onPlay,
}: {
  track: Track;
  onPlay: () => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] p-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_55%)]" />
      <div className="relative flex items-center gap-4">
        <TrackCoverThumb
          src={track.albumCover}
          iconSize={24}
          className="h-20 w-20 shrink-0 rounded-2xl"
        />
        <div className="min-w-0 flex-1">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-wider text-white/45">
            <Clock3 size={11} />
            Continue listening
          </div>
          <h2 className="truncate text-xl font-bold text-foreground">{track.title}</h2>
          <p className="mt-1 truncate text-sm text-muted-foreground">{track.artist}</p>
          {track.album ? <p className="mt-1 truncate text-xs text-white/35">{track.album}</p> : null}
        </div>
        <button
          onClick={onPlay}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform group-hover:scale-105"
        >
          <Play size={18} fill="currentColor" className="ml-0.5" />
        </button>
      </div>
    </div>
  );
}
