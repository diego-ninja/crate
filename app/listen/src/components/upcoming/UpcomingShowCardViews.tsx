import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { Link } from "react-router";
import {
  CalendarCheck, CalendarPlus, ExternalLink, Loader2,
  MapPin, Play, X,
} from "lucide-react";

import { ItemActionMenuButton } from "@/components/actions/ItemActionMenu";
import { artistBackgroundApiUrl, artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

/** Hidden img that preloads the artist background into the browser cache */
function PreloadBackground({ item }: { item: UpcomingItem }) {
  const url = artistBackgroundApiUrl({
    artistId: item.artist_id,
    artistSlug: item.artist_slug,
    artistName: item.artist,
  });
  if (!url) return null;
  return <img src={url} alt="" className="hidden" />;
}

import type { UpcomingItem } from "./upcoming-model";

interface ActionMenuSlot {
  triggerRef: RefObject<HTMLButtonElement | null>;
  hasActions: boolean;
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

interface CollapsedViewProps {
  item: UpcomingItem;
  attending: boolean;
  savingAttendance: boolean;
  actionMenu: ActionMenuSlot;
  onToggleAttendance: () => void;
}

interface ExpandedViewProps {
  item: UpcomingItem;
  attending: boolean;
  savingAttendance: boolean;
  playingSetlist: boolean;
  onToggleAttendance: () => void;
  onPlaySetlist: () => void;
  onClose: () => void;
}

// ── Collapsed — Poster Strip ─────────────────────────────────────

export function UpcomingShowCollapsedView({
  item,
  attending,
  savingAttendance,
  actionMenu,
  onToggleAttendance,
}: CollapsedViewProps) {
  const artistImageUrl =
    artistPhotoApiUrl({ artistId: item.artist_id, artistSlug: item.artist_slug, artistName: item.artist })
    || item.cover_url
    || undefined;

  const d = item.date ? new Date(`${item.date}T12:00:00`) : null;
  const monthStr = d ? d.toLocaleDateString("en-US", { month: "short" }).toUpperCase() : "";
  const dayStr = d ? String(d.getDate()) : "";
  const dowStr = d ? d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase() : "";
  const support = (item.lineup || []).slice(1);

  return (
    <div className="absolute inset-x-0 top-0 z-10 flex h-full items-center gap-0">
      {/* Preload hero background into browser cache while collapsed */}
      <PreloadBackground item={item} />
      {/* Artist photo */}
      <div className="h-full w-[88px] flex-shrink-0 bg-white/5">
        {artistImageUrl && (
          <img
            src={artistImageUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
      </div>

      {/* Center info */}
      <div className="flex-1 min-w-0 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-foreground">{item.artist}</span>
          {attending && <span className="h-[6px] w-[6px] flex-shrink-0 rounded-full bg-primary" title="Attending" />}
        </div>
        <div className="mt-1 flex items-center gap-1 text-[11px] text-white/40">
          <MapPin size={10} className="flex-shrink-0 text-primary/60" />
          <span className="truncate">{item.venue}</span>
          {item.city && (
            <>
              <span className="text-white/15">&middot;</span>
              <span className="flex-shrink-0">{item.city}</span>
            </>
          )}
        </div>
        {support.length > 0 && (
          <div className="mt-0.5 truncate text-[10px] text-white/40">
            w/ {support.slice(0, 3).join(", ")}
            {support.length > 3 && ` +${support.length - 3}`}
          </div>
        )}
      </div>

      {/* Date block */}
      <div className="flex flex-shrink-0 flex-col items-center justify-center px-2">
        <span className="text-[8px] font-bold leading-none tracking-[0.12em] text-primary/55">{monthStr}</span>
        <span className="text-[20px] font-black leading-tight text-primary">{dayStr}</span>
        <span className="text-[8px] font-medium leading-none text-white/40">{dowStr}</span>
      </div>

      {/* Quick attendance + menu */}
      <div className="flex flex-shrink-0 flex-col items-center gap-1 pr-2">
        <button
          onClick={(e) => { e.stopPropagation(); void onToggleAttendance(); }}
          disabled={!item.id || savingAttendance}
          title={attending ? "Attending" : "Mark as attending"}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/30 transition-colors hover:bg-white/8 hover:text-white/60 disabled:opacity-30"
        >
          {savingAttendance ? (
            <Loader2 size={15} className="animate-spin" />
          ) : attending ? (
            <CalendarCheck size={15} className="text-primary" />
          ) : (
            <CalendarPlus size={15} />
          )}
        </button>
        <ItemActionMenuButton
          buttonRef={actionMenu.triggerRef}
          hasActions={actionMenu.hasActions}
          onClick={actionMenu.onOpen}
          className="h-7 w-7 opacity-40 transition-opacity hover:opacity-80"
        />
      </div>
    </div>
  );
}

// ── Expanded — Hero Reveal ───────────────────────────────────────

export function UpcomingShowExpandedView({
  item,
  attending,
  savingAttendance,
  playingSetlist,
  onToggleAttendance,
  onPlaySetlist,
  onClose,
}: ExpandedViewProps) {
  const backgroundUrl = artistBackgroundApiUrl({
    artistId: item.artist_id,
    artistSlug: item.artist_slug,
    artistName: item.artist,
  });
  const artistPhotoUrl =
    artistPhotoApiUrl({ artistId: item.artist_id, artistSlug: item.artist_slug, artistName: item.artist })
    || item.cover_url
    || undefined;

  const d = item.date ? new Date(`${item.date}T12:00:00`) : null;
  const dateLabel = d
    ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "";
  const timeLabel = item.time ? item.time.slice(0, 5) : "";
  const support = (item.lineup || []).slice(1);
  const locationLabel = [item.city, item.region, item.country].filter(Boolean).join(", ");
  const addressLabel = [item.address_line1, item.postal_code].filter(Boolean).join(" · ");

  return (
    <div className="relative flex h-full flex-col">
      {/* Hero — artist background covers the entire card, gradient fades to black at bottom */}
      <div className="absolute inset-0 overflow-hidden">
        {backgroundUrl && (
          <img
            src={backgroundUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover brightness-[0.4] saturate-[0.7]"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
      </div>

      {/* Top section — close button, date, artist overlay */}
      <div className="relative h-[130px] flex-shrink-0">

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-2.5 left-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/40 text-white/60 backdrop-blur-sm transition-colors hover:text-white"
        >
          <X size={14} />
        </button>

        {/* Date + time */}
        <div className="absolute top-2.5 right-3 z-10 text-right">
          <div className="text-[10px] font-bold tracking-wide text-primary/70">{dateLabel}</div>
          {timeLabel && <div className="text-[10px] text-white/40">{timeLabel}</div>}
        </div>

        {/* Artist + lineup overlay */}
        <div className="absolute bottom-3 left-3 right-3 z-10">
          <div className="flex items-center gap-2">
            {artistPhotoUrl && (
              <img
                src={artistPhotoUrl}
                alt=""
                className="h-9 w-9 flex-shrink-0 rounded-full object-cover ring-2 ring-primary/25"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <div className="min-w-0">
              <Link
                to={artistPagePath({ artistId: item.artist_id, artistSlug: item.artist_slug })}
                className="block truncate text-sm font-bold text-white transition-colors hover:text-primary"
              >
                {item.artist}
              </Link>
              {support.length > 0 && (
                <div className="truncate text-[10px] text-white/40">
                  w/ {support.slice(0, 4).join(" · ")}
                  {support.length > 4 && ` +${support.length - 4}`}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Venue info — over the background */}
      <div className="relative flex-1 px-3 pt-2.5 pb-3">
        <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <MapPin size={11} className="mt-0.5 flex-shrink-0 text-primary/60" />
          <div className="min-w-0">
            <span className="font-medium text-white/70">{item.venue}</span>
            {addressLabel && <span className="text-white/40"> · {addressLabel}</span>}
            {locationLabel && <div className="text-white/40">{locationLabel}</div>}
          </div>
        </div>

        {/* Genres */}
        {item.genres && item.genres.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {item.genres.slice(0, 3).map((genre) => (
              <span
                key={genre}
                className="rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] text-white/40"
              >
                {genre}
              </span>
            ))}
          </div>
        )}

        {/* Action buttons — 3 equal width */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); void onToggleAttendance(); }}
            disabled={!item.id || savingAttendance}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2.5 text-[11px] font-semibold transition-colors ${
              attending
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-white/10 text-muted-foreground hover:border-primary/20 hover:text-primary"
            }`}
          >
            {savingAttendance ? (
              <Loader2 size={13} className="animate-spin" />
            ) : attending ? (
              <CalendarCheck size={13} />
            ) : (
              <CalendarPlus size={13} />
            )}
            {attending ? "Going" : "Attend"}
          </button>
          <button
            onClick={() => void onPlaySetlist()}
            disabled={!item.probable_setlist?.length || playingSetlist}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/20 py-2.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/8 disabled:opacity-25"
          >
            {playingSetlist ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} className="fill-current" />}
            Play Setlist
          </button>
          <a
            href={item.url || "#"}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { if (!item.url) e.preventDefault(); }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary/10 py-2.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/18"
          >
            <ExternalLink size={13} />
            Get Tickets
            {item.status === "onsale" && <span className="h-[5px] w-[5px] rounded-full bg-green-400" />}
          </a>
        </div>
      </div>
    </div>
  );
}
