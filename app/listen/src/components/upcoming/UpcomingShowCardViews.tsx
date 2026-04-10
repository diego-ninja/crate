import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { Link } from "react-router";
import { Calendar, Check, Clock, Loader2, MapPin, Play, Ticket, X } from "lucide-react";

import { ItemActionMenuButton } from "@/components/actions/ItemActionMenu";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

import { UpcomingActionButton, UpcomingActionLink } from "./UpcomingActionButtons";
import type { UpcomingItem } from "./upcoming-model";

interface ActionMenuSlot {
  triggerRef: RefObject<HTMLButtonElement | null>;
  hasActions: boolean;
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

interface UpcomingShowCardViewProps {
  item: UpcomingItem;
  attending: boolean;
  savingAttendance: boolean;
  playingSetlist: boolean;
  dateLabel: string;
  timeLabel: string;
  addressLabel: string;
  locationLabel: string;
  actionMenu: ActionMenuSlot;
  onToggleAttendance: () => void;
  onPlaySetlist: () => void;
}

export function UpcomingShowCollapsedView({
  item,
  attending,
  savingAttendance,
  playingSetlist,
  dateLabel,
  timeLabel,
  addressLabel,
  actionMenu,
  onToggleAttendance,
  onPlaySetlist,
}: Omit<UpcomingShowCardViewProps, "locationLabel">) {
  const artistImageUrl = artistPhotoApiUrl({
    artistId: item.artist_id,
    artistSlug: item.artist_slug,
    artistName: item.artist,
  }) || item.cover_url || undefined;

  return (
    <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-4 p-3">
      <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-white/5">
        <img
          src={artistImageUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={(event) => {
            (event.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{item.artist}</span>
          {attending ? (
            <span className="rounded-full border border-primary/20 bg-primary/12 px-2 py-0.5 text-[10px] font-medium text-primary">
              Going
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/45">
          <span className="inline-flex items-center gap-1 truncate">
            <MapPin size={11} className="text-primary/80" />
            <span className="truncate">{item.venue}</span>
          </span>
          <span className="text-white/20">&middot;</span>
          <span className="truncate">{item.city}, {item.country}</span>
        </div>
        {addressLabel ? (
          <div className="mt-1 truncate text-[11px] text-white/35">{addressLabel}</div>
        ) : null}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <div className="text-right text-primary">
          <div className="text-xs font-semibold">{dateLabel}</div>
          {timeLabel ? <div className="text-[10px] text-white/35">{timeLabel}</div> : null}
        </div>
        <UpcomingActionButton
          onClick={(event) => {
            event.stopPropagation();
            void onPlaySetlist();
          }}
          disabled={!item.probable_setlist?.length || playingSetlist}
          title="Play probable setlist"
        >
          {playingSetlist ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Play size={14} className="fill-current" />
          )}
        </UpcomingActionButton>
        <UpcomingActionButton
          onClick={(event) => {
            void onToggleAttendance();
            event.stopPropagation();
          }}
          disabled={!item.id || savingAttendance}
          title={attending ? "Attending" : "Mark as attending"}
          active={attending}
        >
          {savingAttendance ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Check size={14} />
          )}
        </UpcomingActionButton>
        <TicketsActionLink href={item.url} />
        <ItemActionMenuButton
          buttonRef={actionMenu.triggerRef}
          hasActions={actionMenu.hasActions}
          onClick={actionMenu.onOpen}
          className="h-8 w-8 opacity-80 transition-opacity hover:opacity-100"
        />
      </div>
    </div>
  );
}

export function UpcomingShowExpandedView({
  item,
  attending,
  savingAttendance,
  playingSetlist,
  dateLabel,
  timeLabel,
  addressLabel,
  locationLabel,
  actionMenu,
  onToggleAttendance,
  onPlaySetlist,
  onClose,
}: UpcomingShowCardViewProps & {
  onClose: () => void;
}) {
  const artistImageUrl = artistPhotoApiUrl({
    artistId: item.artist_id,
    artistSlug: item.artist_slug,
    artistName: item.artist,
  }) || item.cover_url || undefined;

  return (
    <>
      {/* Venue card — top-left */}
      {item.venue ? (
        <div className="z-app-upcoming-overlay absolute top-3 left-3 max-w-[220px] rounded-lg bg-black/70 px-3 py-2 backdrop-blur-sm">
          <div className="flex items-center gap-1.5">
            <MapPin size={12} className="flex-shrink-0 text-primary" />
            <div className="truncate text-xs font-semibold text-white">{item.venue}</div>
          </div>
          {addressLabel ? (
            <div className="ml-[18px] truncate text-[10px] text-white/65">{addressLabel}</div>
          ) : null}
          <div className="ml-[18px] text-[10px] text-white/50">{locationLabel}</div>
        </div>
      ) : null}

      {/* Show info card — bottom-left */}
      <div className="z-app-upcoming-overlay absolute bottom-3 left-3 max-w-[260px] rounded-lg bg-black/70 px-3 py-2.5 backdrop-blur-sm">
        <div className="mb-1 flex items-center gap-2">
          <img
            src={artistImageUrl}
            alt=""
            className="h-8 w-8 flex-shrink-0 rounded-full object-cover ring-1 ring-primary/30"
            onError={(event) => {
              (event.target as HTMLImageElement).style.display = "none";
            }}
          />
          <Link
            to={artistPagePath({ artistId: item.artist_id, artistSlug: item.artist_slug })}
            className="truncate text-sm font-bold text-white transition-colors hover:text-primary"
          >
            {item.artist}
          </Link>
        </div>
        {item.genres && item.genres.length > 0 ? (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {item.genres.slice(0, 3).map((genre) => (
              <span
                key={genre}
                className="rounded-full border border-white/20 px-1.5 py-0.5 text-[9px] text-white/60"
              >
                {genre}
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-3 text-[11px] text-white/60">
          <span className="flex items-center gap-1">
            <Calendar size={11} className="text-primary/80" /> {dateLabel}
          </span>
          {timeLabel ? (
            <span className="flex items-center gap-1">
              <Clock size={11} className="text-primary/80" /> {timeLabel}
            </span>
          ) : null}
        </div>
        {item.lineup && item.lineup.length > 1 ? (
          <div className="mt-1.5 truncate text-[10px] text-white/40">
            Lineup: {item.lineup.slice(0, 5).join(" · ")}
          </div>
        ) : null}
      </div>

      {/* Close — top-right */}
      <div className="z-app-upcoming-overlay absolute top-3 right-3">
        <UpcomingActionButton
          onClick={onClose}
          title="Close"
        >
          <X size={15} />
        </UpcomingActionButton>
      </div>

      {/* Actions — bottom-right */}
      <div className="z-app-upcoming-overlay absolute bottom-3 right-3 flex flex-col gap-2">
        <UpcomingActionButton
          onClick={() => {
            void onPlaySetlist();
          }}
          disabled={!item.probable_setlist?.length || playingSetlist}
          title="Play probable setlist"
        >
          {playingSetlist ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Play size={15} className="fill-current" />
          )}
        </UpcomingActionButton>
        <UpcomingActionButton
          onClick={onToggleAttendance}
          disabled={!item.id || savingAttendance}
          title={attending ? "Attending" : "Mark as attending"}
          active={attending}
        >
          {savingAttendance ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Check size={15} />
          )}
        </UpcomingActionButton>
        <TicketsActionLink href={item.url} />
        <ItemActionMenuButton
          buttonRef={actionMenu.triggerRef}
          hasActions={actionMenu.hasActions}
          onClick={actionMenu.onOpen}
          className="h-9 w-9 opacity-85 transition-opacity hover:opacity-100"
        />
      </div>
    </>
  );
}

function TicketsActionLink({ href }: { href?: string }) {
  return (
    <UpcomingActionLink
      href={href}
      onClick={(event: ReactMouseEvent<HTMLAnchorElement>) => {
        if (!href) {
          event.preventDefault();
        }
        event.stopPropagation();
      }}
      title="Tickets"
    >
      <Ticket size={14} />
    </UpcomingActionLink>
  );
}
