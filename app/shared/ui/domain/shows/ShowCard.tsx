import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import {
  CRATE_ICON_SIZE,
  ExternalLink,
  MapPin,
  Ticket,
  X,
} from "@crate/ui/icons";

import { cn } from "@crate/ui/lib/cn";
import { type NormalizedShow, formatShowDateParts } from "./show-types";

const COLLAPSED_HEIGHT = 88;

function getArtistHref(
  artist: { name: string; id?: number; slug?: string } | null | undefined,
  buildPath: ShowCardProps["buildArtistPath"],
) {
  if (!artist || artist.id == null || !buildPath) return undefined;
  return buildPath(artist);
}

function PreloadBackground({ url }: { url?: string }) {
  if (!url) return null;
  return <img src={url} alt="" className="hidden" />;
}

function CollapsedView({
  show,
  collapsedActionsSlot,
}: {
  show: NormalizedShow;
  collapsedActionsSlot?: ReactNode;
}) {
  const { monthLabel, dayLabel, weekdayLabel } = formatShowDateParts(
    show.date,
    show.time,
  );
  const support = show.lineupArtists.slice(1);

  return (
    <div className="absolute inset-x-0 top-0 z-10 flex h-full items-center gap-0">
      <PreloadBackground url={show.backgroundUrl} />
      <div className="h-full w-[88px] shrink-0 bg-text-primary/5">
        {show.artistPhotoUrl ? (
          <img
            src={show.artistPhotoUrl}
            alt=""
            loading="lazy"
            className=" size-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1 px-3 py-2.5">
        <div className="truncate text-[0.8125rem] font-semibold text-text-primary">
          {show.primaryArtist?.name ?? show.title}
        </div>
        <div className="mt-1 flex items-center gap-1 text-xs text-text-primary/40">
          <MapPin size={10} className="shrink-0 text-accent-action/60" />
          <span className="truncate">{show.venue}</span>
          {show.city ? (
            <>
              <span className="text-text-primary/15">&middot;</span>
              <span className="shrink-0">{show.city}</span>
            </>
          ) : null}
        </div>
        {support.length > 0 ? (
          <div className="mt-0.5 truncate text-xs text-text-primary/40">
            w/{" "}
            {support
              .slice(0, 3)
              .map((a) => a.name)
              .join(", ")}
            {support.length > 3 ? ` +${support.length - 3}` : ""}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-center justify-center px-2">
        <span className="text-xs font-bold leading-none tracking-[0.12em] text-accent-action/55">
          {monthLabel}
        </span>
        <span className="text-[20px] font-black leading-tight text-accent-action">
          {dayLabel}
        </span>
        <span className="text-xs font-medium leading-none text-text-primary/40">
          {weekdayLabel}
        </span>
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1 pr-2">
        {collapsedActionsSlot ??
          (show.url ? (
            <a
              href={show.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Open tickets"
              className="flex size-8 items-center justify-center rounded-md text-text-primary/30 transition-colors hover:bg-text-primary/8 hover:text-text-primary/70"
            >
              <ExternalLink size={CRATE_ICON_SIZE.md} />
            </a>
          ) : (
            <div className=" size-8" />
          ))}
      </div>
    </div>
  );
}

function ExpandedView({
  show,
  onClose,
  expandedActionsSlot,
  buildArtistPath,
}: {
  show: NormalizedShow;
  onClose?: () => void;
  expandedActionsSlot?: ReactNode;
  buildArtistPath?: ShowCardProps["buildArtistPath"];
}) {
  const { dateLabel, timeLabel } = formatShowDateParts(show.date, show.time);
  const support = show.lineupArtists.slice(1);
  const locationLabel = [show.city, show.region, show.country]
    .filter(Boolean)
    .join(", ");
  const addressLabel = [show.addressLine1, show.postalCode]
    .filter(Boolean)
    .join(" · ");
  const artistHref = getArtistHref(show.primaryArtist, buildArtistPath);

  return (
    <div className="relative flex h-full flex-col">
      <div className="absolute inset-0 overflow-hidden">
        {show.backgroundUrl ? (
          <img
            src={show.backgroundUrl}
            alt=""
            className="absolute inset-0 size-full object-cover brightness-[0.4] saturate-[0.7]"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
        <div className="absolute inset-0 bg-linear-to-t from-surface-canvas via-surface-canvas/65 to-transparent" />
      </div>

      <div className="relative h-[136px] shrink-0">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="absolute left-2.5 top-2.5 z-10 flex size-10 items-center justify-center text-text-primary/60 transition-colors hover:text-text-primary"
            aria-label="Close show details"
          >
            <X size={CRATE_ICON_SIZE.xl} />
          </button>
        ) : null}

        <div className="absolute right-3 top-2.5 z-10 text-right">
          <div className="text-xs font-bold tracking-wide text-accent-action/70">
            {dateLabel}
          </div>
          {timeLabel ? (
            <div className="text-xs text-text-primary/40">{timeLabel}</div>
          ) : null}
        </div>

        <div className="absolute bottom-3 left-3 right-3 z-10">
          <div className="flex items-center gap-2">
            {show.artistPhotoUrl ? (
              <img
                src={show.artistPhotoUrl}
                alt=""
                className=" size-9 shrink-0 rounded-full object-cover ring-2 ring-primary/25"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : null}
            <div className="min-w-0">
              {artistHref ? (
                <Link
                  to={artistHref}
                  className="block truncate text-sm font-bold text-text-primary transition-colors hover:text-accent-action"
                >
                  {show.primaryArtist?.name ?? show.title}
                </Link>
              ) : (
                <div className="truncate text-sm font-bold text-text-primary">
                  {show.primaryArtist?.name ?? show.title}
                </div>
              )}
              {support.length > 0 ? (
                <div className="truncate text-xs text-text-primary/40">
                  w/{" "}
                  {support
                    .slice(0, 4)
                    .map((a) => a.name)
                    .join(" · ")}
                  {support.length > 4 ? ` +${support.length - 4}` : ""}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="relative flex-1 px-3 pb-3 pt-2.5">
        <div className="flex items-start gap-2 text-xs text-text-muted">
          <MapPin size={11} className="mt-0.5 shrink-0 text-accent-action/60" />
          <div className="min-w-0">
            <span className="font-medium text-text-primary/70">
              {show.venue}
            </span>
            {addressLabel ? (
              <span className="text-text-primary/40"> · {addressLabel}</span>
            ) : null}
            {locationLabel ? (
              <div className="text-text-primary/40">{locationLabel}</div>
            ) : null}
          </div>
        </div>

        {show.genres.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {show.genres.slice(0, 3).map((genre) => (
              <span
                key={genre}
                className="rounded-full border border-border-quiet px-1.5 py-0.5 text-xs text-text-primary/40"
              >
                {genre}
              </span>
            ))}
          </div>
        ) : null}

        {expandedActionsSlot ?? (
          <div className="mt-3 flex gap-2">
            {artistHref ? (
              <Link
                to={artistHref}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border-quiet py-2.5 text-xs font-semibold text-text-muted transition-colors hover:border-accent-action/20 hover:text-accent-action"
              >
                <MapPin size={13} />
                Open Artist
              </Link>
            ) : null}
            {show.url ? (
              <a
                href={show.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-accent-action/20 bg-accent-action/10 py-2.5 text-xs font-semibold text-accent-action transition-colors hover:bg-accent-action/18"
              >
                <Ticket size={13} />
                Get Tickets
                <span className="h-[5px] w-[5px] rounded-full bg-state-success" />
              </a>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export interface ShowCardProps {
  show: NormalizedShow;
  expanded?: boolean;
  onToggle?: () => void;
  className?: string;
  /** Slot for action buttons in the collapsed row (attendance, menu trigger, etc.) */
  collapsedActionsSlot?: ReactNode;
  /** Slot for action buttons in the expanded hero (attend, play setlist, tickets, etc.) */
  expandedActionsSlot?: ReactNode;
  /** Context menu wrapper — rendered around the entire card */
  contextMenuSlot?: ReactNode;
  /** Build artist page path from artist ref — injected by the app */
  buildArtistPath?: (artist: {
    name: string;
    id?: number;
    slug?: string;
  }) => string;
}

export function ShowCard({
  show,
  expanded,
  onToggle,
  className,
  collapsedActionsSlot,
  expandedActionsSlot,
  contextMenuSlot,
  buildArtistPath,
}: ShowCardProps) {
  const isInteractive =
    typeof expanded === "boolean" && typeof onToggle === "function";
  const contentRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number>(0);

  const measure = useCallback(() => {
    if (contentRef.current) {
      setMeasuredHeight(contentRef.current.scrollHeight);
    }
  }, []);

  useEffect(() => {
    if (isInteractive && expanded) measure();
  }, [expanded, isInteractive, measure]);

  if (!isInteractive) {
    return (
      <div
        className={cn(
          "relative w-[340px] overflow-hidden rounded-md border border-text-primary/[0.06] bg-panel-surface shadow-card",
          className,
        )}
      >
        <ExpandedView
          show={show}
          expandedActionsSlot={expandedActionsSlot}
          buildArtistPath={buildArtistPath}
        />
      </div>
    );
  }

  const cardHeight = expanded
    ? measuredHeight > 0
      ? measuredHeight
      : "auto"
    : COLLAPSED_HEIGHT;

  const card = (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-md border",
        expanded
          ? "border-accent-action/20 shadow-accent-action-card transition-[height,border-color,box-shadow] duration-400 ease-out"
          : "border-text-primary/[0.06] bg-text-primary/[0.02] transition-[height,border-color] duration-300 ease-out hover:border-accent-action/15 hover:bg-text-primary/[0.03]",
        className,
      )}
      style={{ height: cardHeight }}
      role={!expanded ? "button" : undefined}
      tabIndex={!expanded ? 0 : undefined}
      aria-expanded={!expanded ? expanded : undefined}
      onClick={!expanded ? onToggle : undefined}
      onKeyDown={
        !expanded && onToggle
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggle();
              }
            }
          : undefined
      }
    >
      <div ref={contentRef}>
        {!expanded ? (
          <div className="absolute inset-0 bg-raised-surface" />
        ) : null}
        {!expanded ? (
          <CollapsedView
            show={show}
            collapsedActionsSlot={collapsedActionsSlot}
          />
        ) : (
          <ExpandedView
            show={show}
            onClose={onToggle}
            expandedActionsSlot={expandedActionsSlot}
            buildArtistPath={buildArtistPath}
          />
        )}
      </div>
    </div>
  );

  return contextMenuSlot ? (
    <>
      {contextMenuSlot}
      {card}
    </>
  ) : (
    card
  );
}
