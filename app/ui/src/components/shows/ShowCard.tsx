import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  ExternalLink,
  MapPin,
  Ticket,
  X,
} from "lucide-react";

import {
  artistBackgroundApiUrl,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";
import { cn } from "@/lib/utils";

const COLLAPSED_HEIGHT = 88;

interface ShowArtistRef {
  name: string;
  id?: number;
  slug?: string;
}

export interface ShowEvent {
  id: string;
  name: string;
  date: string;
  local_date: string;
  local_time: string;
  venue: string;
  address_line1?: string;
  city: string;
  region: string;
  country: string;
  country_code: string;
  url: string;
  image: string;
  lineup: string[];
  price_range?: { min: number; max: number; currency: string } | null;
  status: string;
  latitude?: string;
  longitude?: string;
  artist_name?: string;
  artist_id?: number;
  artist_slug?: string;
  lineup_artists?: ShowArtistRef[];
  artist_listeners?: number;
  artist_genres?: string[];
}

interface AdminShowCardItem {
  type?: "show" | "release";
  date: string;
  time?: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  title?: string;
  cover_url?: string | null;
  status?: string;
  url?: string;
  venue?: string;
  address_line1?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  lineup?: string[];
  lineup_artists?: ShowArtistRef[];
  genres?: string[];
}

type ShowCardInput = ShowEvent | AdminShowCardItem;

interface NormalizedShow {
  id?: string | number;
  date: string;
  time: string;
  venue: string;
  addressLine1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  url: string;
  status: string;
  title: string;
  primaryArtist: ShowArtistRef | null;
  lineupArtists: ShowArtistRef[];
  genres: string[];
  coverUrl: string;
  artistPhotoUrl: string;
  backgroundUrl: string;
}

const GENRE_COLORS: Record<string, string> = {
  metal: "#1f2937",
  "heavy metal": "#1f2937",
  "death metal": "#1f2937",
  "black metal": "#1f2937",
  "doom metal": "#374151",
  punk: "#dc2626",
  hardcore: "#dc2626",
  "hardcore punk": "#dc2626",
  "post-hardcore": "#ea580c",
  grindcore: "#991b1b",
  rock: "#2563eb",
  "alternative rock": "#3b82f6",
  "indie rock": "#6366f1",
  grunge: "#4b5563",
  "post-punk": "#7c3aed",
  shoegaze: "#a78bfa",
  electronic: "#06b6d4",
  ambient: "#0e7490",
  noise: "#78716c",
  experimental: "#a855f7",
  "math rock": "#14b8a6",
  emo: "#f43f5e",
  screamo: "#e11d48",
  "hip hop": "#eab308",
  jazz: "#f59e0b",
  folk: "#65a30d",
};

export function getGenreColor(genres?: string[]): string {
  if (!genres || genres.length === 0) return "#06b6d4";
  for (const genre of genres) {
    const lower = genre.toLowerCase();
    if (GENRE_COLORS[lower]) return GENRE_COLORS[lower];
    for (const [key, color] of Object.entries(GENRE_COLORS)) {
      if (lower.includes(key) || key.includes(lower)) return color;
    }
  }
  return "#06b6d4";
}

function getArtistLink(artist: ShowArtistRef | null | undefined) {
  if (!artist || artist.id == null) return undefined;
  return artistPagePath({ artistId: artist.id, artistSlug: artist.slug, artistName: artist.name });
}

function formatDateParts(date: string, time: string) {
  if (!date) return { dateLabel: "", monthLabel: "", dayLabel: "", weekdayLabel: "" };
  const value = new Date(`${date}T12:00:00`);
  return {
    dateLabel: value.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    monthLabel: value.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    dayLabel: String(value.getDate()),
    weekdayLabel: value.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(),
    timeLabel: time ? time.slice(0, 5) : "",
  };
}

function normalizeLineupArtists(show: ShowCardInput, primaryArtist: ShowArtistRef | null) {
  const raw = show as Partial<ShowEvent & AdminShowCardItem>;
  const rawLineupArtists = Array.isArray(raw.lineup_artists)
    ? raw.lineup_artists.filter(
        (artist): artist is ShowArtistRef =>
          Boolean(artist) && typeof artist.name === "string" && artist.name.length > 0,
      )
    : [];
  const rawLineup = Array.isArray(raw.lineup)
    ? raw.lineup.filter((artist): artist is string => typeof artist === "string" && artist.length > 0)
    : [];

  const lineup: ShowArtistRef[] = rawLineupArtists.length > 0
    ? rawLineupArtists
    : rawLineup.map((name) => ({ name }));

  if (primaryArtist && !lineup.some((artist) => artist.name === primaryArtist.name && artist.id === primaryArtist.id)) {
    return [primaryArtist, ...lineup];
  }
  return lineup.length > 0 ? lineup : primaryArtist ? [primaryArtist] : [];
}

function normalizeShow(show: ShowCardInput): NormalizedShow {
  const raw = show as Partial<ShowEvent & AdminShowCardItem>;
  const artistName =
    typeof raw.artist === "string"
      ? raw.artist
      : typeof raw.artist_name === "string"
        ? raw.artist_name
        : Array.isArray(raw.lineup) && typeof raw.lineup[0] === "string"
          ? raw.lineup[0]
          : typeof raw.name === "string"
            ? raw.name
            : "Unknown Artist";
  const primaryArtist: ShowArtistRef | null = artistName
    ? {
        name: artistName,
        id: typeof raw.artist_id === "number" ? raw.artist_id : undefined,
        slug: typeof raw.artist_slug === "string" ? raw.artist_slug : undefined,
      }
    : null;
  const lineupArtists = normalizeLineupArtists(show, primaryArtist);
  const coverUrl =
    typeof raw.cover_url === "string" && raw.cover_url.length > 0
      ? raw.cover_url
      : typeof raw.image === "string" && raw.image.length > 0
        ? raw.image
        : "";
  const artistPhotoUrl =
    primaryArtist && primaryArtist.id != null
      ? artistPhotoApiUrl({
          artistId: primaryArtist.id,
          artistSlug: primaryArtist.slug,
          artistName: primaryArtist.name,
        }) || coverUrl
      : coverUrl;
  const backgroundUrl =
    primaryArtist && primaryArtist.id != null
      ? artistBackgroundApiUrl({
          artistId: primaryArtist.id,
          artistSlug: primaryArtist.slug,
          artistName: primaryArtist.name,
        }) || ""
      : "";

  return {
    id:
      typeof raw.id === "number" || typeof raw.id === "string"
        ? raw.id
        : undefined,
    date: typeof raw.date === "string" ? raw.date.slice(0, 10) : "",
    time:
      typeof raw.time === "string"
        ? raw.time
        : typeof raw.local_time === "string"
          ? raw.local_time
          : "",
    venue: typeof raw.venue === "string" ? raw.venue : "",
    addressLine1: typeof raw.address_line1 === "string" ? raw.address_line1 : "",
    city: typeof raw.city === "string" ? raw.city : "",
    region: typeof raw.region === "string" ? raw.region : "",
    postalCode: typeof raw.postal_code === "string" ? raw.postal_code : "",
    country: typeof raw.country === "string" ? raw.country : "",
    url: typeof raw.url === "string" ? raw.url : "",
    status: typeof raw.status === "string" ? raw.status : "onsale",
    title:
      typeof raw.title === "string" && raw.title.length > 0
        ? raw.title
        : typeof raw.name === "string"
          ? raw.name
          : "",
    primaryArtist,
    lineupArtists,
    genres:
      Array.isArray(raw.genres)
        ? raw.genres.filter((genre): genre is string => typeof genre === "string" && genre.length > 0)
        : Array.isArray(raw.artist_genres)
          ? raw.artist_genres.filter((genre): genre is string => typeof genre === "string" && genre.length > 0)
          : [],
    coverUrl,
    artistPhotoUrl,
    backgroundUrl,
  };
}

function CompactCard({ show }: { show: ShowEvent }) {
  const normalized = normalizeShow(show);
  return (
    <div className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-white/5">
      <div className="h-[18px] w-[18px] flex-shrink-0 overflow-hidden rounded-sm bg-white/5">
        {normalized.artistPhotoUrl ? (
          <img
            src={normalized.artistPhotoUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={(event) => {
              (event.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
      </div>
      <span className="truncate font-medium">{normalized.primaryArtist?.name ?? normalized.title}</span>
      <span className="hidden truncate text-muted-foreground sm:inline">{normalized.venue}</span>
    </div>
  );
}

function PreloadBackground({ show }: { show: NormalizedShow }) {
  if (!show.backgroundUrl) return null;
  return <img src={show.backgroundUrl} alt="" className="hidden" />;
}

function CollapsedShowCard({
  show,
  onToggle,
}: {
  show: NormalizedShow;
  onToggle?: () => void;
}) {
  const { monthLabel, dayLabel, weekdayLabel } = formatDateParts(show.date, show.time);
  const support = show.lineupArtists.slice(1);

  return (
    <div
      className="absolute inset-x-0 top-0 z-10 flex h-full items-center gap-0"
      onClick={onToggle}
    >
      <PreloadBackground show={show} />
      <div className="h-full w-[88px] flex-shrink-0 bg-white/5">
        {show.artistPhotoUrl ? (
          <img
            src={show.artistPhotoUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(event) => {
              (event.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1 px-3 py-2.5">
        <div className="truncate text-[13px] font-semibold text-foreground">
          {show.primaryArtist?.name ?? show.title}
        </div>
        <div className="mt-1 flex items-center gap-1 text-[11px] text-white/40">
          <MapPin size={10} className="flex-shrink-0 text-primary/60" />
          <span className="truncate">{show.venue}</span>
          {show.city ? (
            <>
              <span className="text-white/15">&middot;</span>
              <span className="flex-shrink-0">{show.city}</span>
            </>
          ) : null}
        </div>
        {support.length > 0 ? (
          <div className="mt-0.5 truncate text-[10px] text-white/40">
            w/ {support.slice(0, 3).map((artist) => artist.name).join(", ")}
            {support.length > 3 ? ` +${support.length - 3}` : ""}
          </div>
        ) : null}
      </div>

      <div className="flex flex-shrink-0 flex-col items-center justify-center px-2">
        <span className="text-[8px] font-bold leading-none tracking-[0.12em] text-primary/55">{monthLabel}</span>
        <span className="text-[20px] font-black leading-tight text-primary">{dayLabel}</span>
        <span className="text-[8px] font-medium leading-none text-white/40">{weekdayLabel}</span>
      </div>

      <div className="flex flex-shrink-0 flex-col items-center gap-1 pr-2">
        {show.url ? (
          <a
            href={show.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            title="Open tickets"
            className="flex h-8 w-8 items-center justify-center rounded-md text-white/30 transition-colors hover:bg-white/8 hover:text-white/70"
          >
            <ExternalLink size={15} />
          </a>
        ) : (
          <div className="h-8 w-8" />
        )}
      </div>
    </div>
  );
}

function ActionButton({
  href,
  label,
  icon,
  tone = "neutral",
}: {
  href?: string;
  label: string;
  icon: ReactNode;
  tone?: "neutral" | "primary";
}) {
  if (!href) return null;

  return (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md border py-2.5 text-[11px] font-semibold transition-colors",
        tone === "primary"
          ? "border-primary/20 bg-primary/10 text-primary hover:bg-primary/18"
          : "border-white/10 text-muted-foreground hover:border-primary/20 hover:text-primary",
      )}
    >
      {icon}
      {label}
      {href.startsWith("http") ? <span className="h-[5px] w-[5px] rounded-full bg-green-400" /> : null}
    </a>
  );
}

function ExpandedShowCardBody({
  show,
  closeable,
  onClose,
}: {
  show: NormalizedShow;
  closeable?: boolean;
  onClose?: () => void;
}) {
  const { dateLabel, timeLabel } = formatDateParts(show.date, show.time) as ReturnType<typeof formatDateParts> & {
    timeLabel?: string;
  };
  const support = show.lineupArtists.slice(1);
  const locationLabel = [show.city, show.region, show.country].filter(Boolean).join(", ");
  const addressLabel = [show.addressLine1, show.postalCode].filter(Boolean).join(" · ");
  const artistHref = getArtistLink(show.primaryArtist);

  return (
    <div className="relative flex h-full flex-col">
      <div className="absolute inset-0 overflow-hidden">
        {show.backgroundUrl ? (
          <img
            src={show.backgroundUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover brightness-[0.4] saturate-[0.7]"
            onError={(event) => {
              (event.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/65 to-transparent" />
      </div>

      <div className="relative h-[136px] flex-shrink-0">
        {closeable ? (
          <button
            type="button"
            onClick={onClose}
            className="absolute left-2.5 top-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-white/60 backdrop-blur-sm transition-colors hover:text-white"
            aria-label="Close show details"
          >
            <X size={14} />
          </button>
        ) : null}

        <div className="absolute right-3 top-2.5 z-10 text-right">
          <div className="text-[10px] font-bold tracking-wide text-primary/70">{dateLabel}</div>
          {timeLabel ? <div className="text-[10px] text-white/40">{timeLabel}</div> : null}
        </div>

        <div className="absolute bottom-3 left-3 right-3 z-10">
          <div className="flex items-center gap-2">
            {show.artistPhotoUrl ? (
              <img
                src={show.artistPhotoUrl}
                alt=""
                className="h-9 w-9 flex-shrink-0 rounded-full object-cover ring-2 ring-primary/25"
                onError={(event) => {
                  (event.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : null}
            <div className="min-w-0">
              {artistHref ? (
                <Link
                  to={artistHref}
                  className="block truncate text-sm font-bold text-white transition-colors hover:text-primary"
                >
                  {show.primaryArtist?.name ?? show.title}
                </Link>
              ) : (
                <div className="truncate text-sm font-bold text-white">
                  {show.primaryArtist?.name ?? show.title}
                </div>
              )}
              {support.length > 0 ? (
                <div className="truncate text-[10px] text-white/40">
                  w/ {support.slice(0, 4).map((artist) => artist.name).join(" · ")}
                  {support.length > 4 ? ` +${support.length - 4}` : ""}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="relative flex-1 px-3 pb-3 pt-2.5">
        <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <MapPin size={11} className="mt-0.5 flex-shrink-0 text-primary/60" />
          <div className="min-w-0">
            <span className="font-medium text-white/70">{show.venue}</span>
            {addressLabel ? <span className="text-white/40"> · {addressLabel}</span> : null}
            {locationLabel ? <div className="text-white/40">{locationLabel}</div> : null}
          </div>
        </div>

        {show.genres.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {show.genres.slice(0, 3).map((genre) => (
              <span
                key={genre}
                className="rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] text-white/40"
              >
                {genre}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex gap-2">
          <ActionButton href={artistHref} label="Open Artist" icon={<MapPin size={13} />} />
          <ActionButton href={show.url} label="Get Tickets" icon={<Ticket size={13} />} tone="primary" />
        </div>
      </div>
    </div>
  );
}

export function ShowCard({
  show,
  compact,
  expanded,
  onToggle,
  className,
}: {
  show: ShowCardInput;
  compact?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  const normalized = useMemo(() => normalizeShow(show), [show]);
  const isInteractive = typeof expanded === "boolean" && typeof onToggle === "function";
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

  if (compact) return <CompactCard show={show as ShowEvent} />;

  if (!isInteractive) {
    return (
      <div
        className={cn(
          "relative w-[340px] overflow-hidden rounded-md border border-white/[0.06] bg-panel-surface shadow-[0_20px_48px_rgba(0,0,0,0.28)]",
          className,
        )}
      >
        <ExpandedShowCardBody show={normalized} />
      </div>
    );
  }

  const cardHeight = expanded
    ? (measuredHeight > 0 ? measuredHeight : "auto")
    : COLLAPSED_HEIGHT;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-md border",
        expanded
          ? "border-primary/20 shadow-[0_12px_40px_rgba(6,182,212,0.10)] transition-[height,border-color,box-shadow] duration-400 ease-out"
          : "border-white/[0.06] bg-white/[0.02] transition-[height,border-color] duration-300 ease-out hover:border-primary/15 hover:bg-white/[0.03]",
        className,
      )}
      style={{ height: cardHeight }}
      onClick={!expanded ? onToggle : undefined}
    >
      <div ref={contentRef}>
        {!expanded ? <div className="absolute inset-0 bg-raised-surface" /> : null}
        {!expanded ? (
          <CollapsedShowCard show={normalized} onToggle={onToggle} />
        ) : (
          <ExpandedShowCardBody show={normalized} closeable onClose={onToggle} />
        )}
      </div>
    </div>
  );
}
