import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Clock3, Loader2, Play } from "lucide-react";

import { ItemActionMenu, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import { PlaylistArtwork, type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import { TrackCoverThumb } from "@/components/cards/TrackCoverThumb";
import type { Track } from "@/contexts/PlayerContext";
import { cn } from "@/lib/utils";

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
  railControls,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  railControls?: {
    canScrollLeft: boolean;
    canScrollRight: boolean;
    onScrollLeft: () => void;
    onScrollRight: () => void;
  };
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        {subtitle ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {railControls ? (
          <div className="flex items-center gap-1.5 md:gap-2">
            <button
              type="button"
              onClick={railControls.onScrollLeft}
              disabled={!railControls.canScrollLeft}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-35 md:h-8 md:w-8"
              aria-label={`Scroll ${title} left`}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={railControls.onScrollRight}
              disabled={!railControls.canScrollRight}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-white/65 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-35 md:h-8 md:w-8"
              aria-label={`Scroll ${title} right`}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        ) : null}
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
    </div>
  );
}

export function useSectionRail(itemCount: number) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateButtons = useCallback(() => {
    const node = railRef.current;
    if (!node) return;
    const maxScrollLeft = node.scrollWidth - node.clientWidth;
    setCanScrollLeft(node.scrollLeft > 8);
    setCanScrollRight(maxScrollLeft - node.scrollLeft > 8);
  }, []);

  useEffect(() => {
    const node = railRef.current;
    if (!node) return;
    updateButtons();
    const handleScroll = () => updateButtons();
    node.addEventListener("scroll", handleScroll, { passive: true });
    const resizeObserver = new ResizeObserver(() => updateButtons());
    resizeObserver.observe(node);
    Array.from(node.children).forEach((child) => resizeObserver.observe(child));
    return () => {
      node.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, [itemCount, updateButtons]);

  const scrollByDirection = useCallback((direction: -1 | 1) => {
    const node = railRef.current;
    if (!node) return;
    const delta = Math.max(node.clientWidth - 120, 260);
    node.scrollBy({ left: delta * direction, behavior: "smooth" });
  }, []);

  return {
    railRef,
    canScrollLeft,
    canScrollRight,
    onScrollLeft: () => scrollByDirection(-1),
    onScrollRight: () => scrollByDirection(1),
  };
}

export function SectionRail({
  children,
  railRef,
  className,
}: {
  children: ReactNode;
  railRef?: RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  return (
    <div
      ref={railRef}
      className={cn(
        "hide-rail-scrollbar flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto overflow-y-hidden pb-2 transform-gpu will-change-scroll",
        className,
      )}
    >
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
        <span className="text-[10px] uppercase tracking-wide text-white/40">{dateLabel.split(" ")[0]}</span>
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
  isSmart = false,
  description,
  tracks,
  coverDataUrl,
  meta,
  href,
  isFollowed,
  onClick,
  onPlay,
  onToggleFollow,
}: {
  playlistId?: number;
  name: string;
  isSmart?: boolean;
  description?: string;
  tracks?: PlaylistArtworkTrack[];
  coverDataUrl?: string | null;
  meta: string;
  href?: string;
  isFollowed?: boolean;
  onClick: () => void;
  onPlay?: () => Promise<void> | void;
  onToggleFollow?: () => Promise<void> | void;
}) {
  const actions = usePlaylistActionEntries({
    playlistId,
    name,
    isSmart,
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
        actionMenu.handleKeyboardTrigger(event);
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      {...actionMenu.longPressHandlers}
      className="group w-[180px] flex-shrink-0 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:rounded-3xl"
    >
      <div className="relative">
        <PlaylistArtwork
          name={name}
          coverDataUrl={coverDataUrl}
          tracks={tracks}
          showCrateMark
          className="aspect-square rounded-3xl shadow-xl transition-transform group-hover:scale-[1.02]"
        />
      </div>
      <div className="px-1 pt-3">
        <div className="truncate text-sm font-bold text-foreground">{name}</div>
        <div className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-muted-foreground">
          {description || meta}
        </div>
        <div className="mt-2 text-[11px] uppercase tracking-wider text-white/40">{meta}</div>
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
    <div className="group relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] p-3 sm:p-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_55%)]" />
      <div className="relative flex items-center gap-3 sm:gap-4">
        <TrackCoverThumb
          src={track.albumCover}
          iconSize={24}
          className="h-16 w-16 shrink-0 rounded-2xl sm:h-20 sm:w-20"
        />
        <div className="min-w-0 flex-1">
          <div className="mb-2 inline-flex max-w-full items-center gap-2 truncate rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Clock3 size={11} />
            Continue listening
          </div>
          <h2 className="truncate text-xl font-bold text-foreground">{track.title}</h2>
          <p className="mt-1 truncate text-sm text-muted-foreground">{track.artist}</p>
          {track.album ? <p className="mt-1 truncate text-xs text-white/40">{track.album}</p> : null}
        </div>
        <button
          onClick={onPlay}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform group-hover:scale-105 sm:h-11 sm:w-11"
        >
          <Play size={18} fill="currentColor" className="ml-0.5" />
        </button>
      </div>
    </div>
  );
}
