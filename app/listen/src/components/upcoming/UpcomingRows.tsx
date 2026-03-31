import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Calendar,
  Check,
  Clock,
  Loader2,
  MapPin,
  Play,
  Ticket,
  X,
} from "lucide-react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { cn, encPath } from "@/lib/utils";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export interface UpcomingItem {
  id?: number;
  type: "release" | "show";
  date: string;
  time?: string;
  artist: string;
  title: string;
  subtitle: string;
  cover_url: string | null;
  status: string;
  is_upcoming: boolean;
  tidal_url?: string;
  release_id?: number;
  url?: string;
  venue?: string;
  city?: string;
  country?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
  lineup?: string[];
  genres?: string[];
  probable_setlist?: { title: string; position?: number; frequency?: number }[];
  user_attending?: boolean;
}

export interface ArtistShowEvent {
  id: string;
  show_id?: number;
  artist_name: string;
  date: string;
  local_time?: string;
  venue: string;
  city: string;
  country: string;
  country_code: string;
  url?: string;
  image_url?: string;
  lineup?: string[];
  artist_genres?: string[];
  latitude?: number;
  longitude?: number;
  probable_setlist?: { title: string; position?: number; frequency?: number }[];
  user_attending?: boolean;
}

export function artistShowToUpcomingItem(show: ArtistShowEvent): UpcomingItem {
  return {
    id: show.show_id,
    type: "show",
    date: show.date,
    time: show.local_time,
    artist: show.artist_name,
    title: show.venue || "",
    subtitle: [show.city, show.country].filter(Boolean).join(", "),
    cover_url: show.image_url || null,
    status: "onsale",
    url: show.url,
    venue: show.venue,
    city: show.city,
    country: show.country,
    country_code: show.country_code,
    latitude: show.latitude,
    longitude: show.longitude,
    lineup: show.lineup,
    genres: show.artist_genres || [],
    probable_setlist: show.probable_setlist || [],
    user_attending: show.user_attending,
    is_upcoming: true,
  };
}

export function itemKey(item: UpcomingItem, index: number): string {
  return `${item.type}-${item.artist}-${item.release_id ?? item.venue ?? index}-${item.date}`;
}

export function groupByMonth(items: UpcomingItem[]): [string, UpcomingItem[]][] {
  const groups = new Map<string, UpcomingItem[]>();
  for (const item of items) {
    const month = (item.date || "").slice(0, 7) || "Unknown";
    const existing = groups.get(month) || [];
    existing.push(item);
    groups.set(month, existing);
  }
  return [...groups.entries()];
}

function monthLabel(month: string) {
  if (month === "Unknown") return "Unknown Date";
  return new Date(`${month}-15T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function rowActionClassName(tone: "default" | "primary" = "default", disabled = false) {
  if (disabled) {
    return "pointer-events-none text-white/20";
  }

  return tone === "primary"
    ? "text-primary hover:bg-primary/10"
    : "text-white/45 hover:bg-white/10 hover:text-white";
}

function RowActionButton({
  title,
  onClick,
  disabled = false,
  active = false,
  children,
}: {
  title: string;
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
        rowActionClassName(active ? "primary" : "default", disabled),
      )}
      title={title}
    >
      {children}
    </button>
  );
}

function RowActionLink({
  title,
  href,
  disabled = false,
  active = false,
  onClick,
  children,
}: {
  title: string;
  href?: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}) {
  return (
    <a
      href={href || "#"}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
        rowActionClassName(active ? "primary" : "default", disabled || !href),
      )}
      title={title}
    >
      {children}
    </a>
  );
}

function MapSizeFixer() {
  const map = useMap();

  useEffect(() => {
    const timers = [
      window.setTimeout(() => map.invalidateSize(), 0),
      window.setTimeout(() => map.invalidateSize(), 120),
      window.setTimeout(() => map.invalidateSize(), 320),
    ];

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [map]);

  return null;
}

export function UpcomingMonthGroup({
  month,
  items,
  expandedId,
  onToggleExpand,
}: {
  month: string;
  items: UpcomingItem[];
  expandedId: string | null;
  onToggleExpand: (id: string | null) => void;
}) {
  const [attendanceOverrides, setAttendanceOverrides] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35 border-b border-white/5 pb-2">
        {monthLabel(month)}
      </div>
      <div className="space-y-2">
        {items.map((item, index) => {
          const key = itemKey(item, index);
          const itemWithOverrides = attendanceOverrides[key] == null
            ? item
            : { ...item, user_attending: attendanceOverrides[key] };
          if (item.type === "show") {
            return (
              <UpcomingShowCard
              key={key}
              item={itemWithOverrides}
              expanded={expandedId === key}
              onToggle={() => onToggleExpand(expandedId === key ? null : key)}
              onAttendanceChange={(attending) => {
                setAttendanceOverrides((current) => ({ ...current, [key]: attending }));
              }}
            />
            );
          }
          return (
            <UpcomingEventRow
              key={key}
              item={itemWithOverrides}
              onAttendanceChange={(attending) => {
                setAttendanceOverrides((current) => ({ ...current, [key]: attending }));
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

async function fetchPlayableSetlist(artist: string): Promise<Track[]> {
  const response = await api<{
    tracks: {
      library_track_id: number;
      title: string;
      artist: string;
      album: string;
      path: string;
      duration?: number;
      navidrome_id?: string;
    }[];
  }>(`/api/artist/${encPath(artist)}/setlist-playable`);

  return (response.tracks || []).map((track) => ({
    id: track.path || track.navidrome_id || String(track.library_track_id),
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumCover: track.album
      ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}`
      : `/api/artist/${encPath(track.artist)}/photo`,
    path: track.path || undefined,
    navidromeId: track.navidrome_id || undefined,
    libraryTrackId: track.library_track_id,
  }));
}

export function UpcomingEventRow({
  item,
  onAttendanceChange,
  onClick,
}: {
  item: UpcomingItem;
  onAttendanceChange?: (attending: boolean) => void;
  onClick?: () => void;
}) {
  const isShow = item.type === "show";
  const { playAll } = usePlayerActions();
  const [attending, setAttending] = useState(Boolean(item.user_attending));
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [playingSetlist, setPlayingSetlist] = useState(false);
  const dateObj = item.date ? new Date(`${item.date}T12:00:00`) : null;
  const dateStr = dateObj
    ? dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "";
  const timeStr = item.time ? item.time.slice(0, 5) : "";

  useEffect(() => {
    setAttending(Boolean(item.user_attending));
  }, [item.user_attending]);

  async function toggleAttendance(event: ReactMouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!item.id) return;
    setSavingAttendance(true);
    try {
      if (attending) {
        await api(`/api/me/shows/${item.id}/attendance`, "DELETE");
        setAttending(false);
        onAttendanceChange?.(false);
        toast.success("Removed from your concert plan");
      } else {
        await api(`/api/me/shows/${item.id}/attendance`, "POST");
        setAttending(true);
        onAttendanceChange?.(true);
        toast.success("Marked as attending");
      }
    } catch {
      toast.error("Failed to update attendance");
    } finally {
      setSavingAttendance(false);
    }
  }

  async function playProbableSetlist(event: ReactMouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!isShow || !item.probable_setlist?.length) return;
    setPlayingSetlist(true);
    try {
      const queue = await fetchPlayableSetlist(item.artist);
      if (!queue.length) {
        toast.info("No probable setlist tracks matched your library");
        return;
      }
      playAll(queue, 0, { type: "playlist", name: `${item.artist} Probable Setlist` });
      toast.success(`Playing probable setlist: ${queue.length} tracks`);
    } catch {
      toast.error("Failed to load probable setlist");
    } finally {
      setPlayingSetlist(false);
    }
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-4 rounded-2xl border p-3 transition-all",
        isShow
          ? "cursor-pointer border-primary/10 bg-white/[0.02] hover:border-primary/25 hover:bg-white/[0.04]"
          : "border-primary/10 bg-white/[0.02] hover:border-primary/20 hover:bg-white/[0.04]",
      )}
      onClick={onClick}
    >
      <div className="relative h-14 w-14 overflow-hidden rounded-xl bg-white/5 flex-shrink-0">
        <img
          src={
            isShow
              ? `/api/artist/${encPath(item.artist)}/photo`
              : item.cover_url || `/api/artist/${encPath(item.artist)}/photo`
          }
          alt=""
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {isShow ? item.artist : item.title}
          </span>
          {attending && isShow ? (
            <span className="rounded-full border border-primary/20 bg-primary/12 px-2 py-0.5 text-[10px] font-medium text-primary">
              Going
            </span>
          ) : null}
        </div>

        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/45">
          {isShow ? (
            <>
              <span className="inline-flex items-center gap-1 truncate">
                <MapPin size={11} className="text-primary/80" />
                <span className="truncate">{item.venue}</span>
              </span>
              <span className="text-white/20">&middot;</span>
              <span className="truncate">{item.city}, {item.country}</span>
            </>
          ) : (
            <>
              <Link
                to={`/artist/${encPath(item.artist)}`}
                className="truncate text-white/55 transition-colors hover:text-foreground"
              >
                {item.artist}
              </Link>
              <span className="text-white/20">&middot;</span>
              <span className="truncate">{item.subtitle}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        <div className="text-right text-primary">
          <div className="text-xs font-semibold">{dateStr}</div>
          {timeStr ? <div className="text-[10px] text-white/35">{timeStr}</div> : null}
        </div>
        {isShow ? (
          <>
            <RowActionButton
              onClick={playProbableSetlist}
              disabled={!item.probable_setlist?.length || playingSetlist}
              title="Play probable setlist"
            >
              {playingSetlist ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} className="fill-current" />}
            </RowActionButton>

            <RowActionButton
              onClick={toggleAttendance}
              disabled={!item.id || savingAttendance}
              title={attending ? "Attending" : "Mark as attending"}
              active={attending}
            >
              {savingAttendance ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            </RowActionButton>

            <RowActionLink
              href={item.url}
              onClick={(event) => {
                if (!item.url) {
                  event.preventDefault();
                  event.stopPropagation();
                } else {
                  event.stopPropagation();
                }
              }}
              title="Tickets"
            >
              <Ticket size={14} />
            </RowActionLink>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function UpcomingShowCard({
  item,
  expanded,
  onToggle,
  onAttendanceChange,
}: {
  item: UpcomingItem;
  expanded: boolean;
  onToggle: () => void;
  onAttendanceChange?: (attending: boolean) => void;
}) {
  const { playAll } = usePlayerActions();
  const [attending, setAttending] = useState(Boolean(item.user_attending));
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [playingSetlist, setPlayingSetlist] = useState(false);
  const position = useMemo<[number, number] | null>(() => {
    if (item.latitude == null || item.longitude == null) return null;
    return [item.latitude, item.longitude];
  }, [item.latitude, item.longitude]);

  useEffect(() => {
    setAttending(Boolean(item.user_attending));
  }, [item.user_attending]);

  const dateStr = item.date
    ? new Date(`${item.date}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "";
  const timeStr = item.time ? item.time.slice(0, 5) : "";
  const location = [item.city, item.country].filter(Boolean).join(", ");

  async function toggleAttendance() {
    if (!item.id) return;
    setSavingAttendance(true);
    try {
      if (attending) {
        await api(`/api/me/shows/${item.id}/attendance`, "DELETE");
        setAttending(false);
        onAttendanceChange?.(false);
        toast.success("Removed from your concert plan");
      } else {
        await api(`/api/me/shows/${item.id}/attendance`, "POST");
        setAttending(true);
        onAttendanceChange?.(true);
        toast.success("Marked as attending");
      }
    } catch {
      toast.error("Failed to update attendance");
    } finally {
      setSavingAttendance(false);
    }
  }

  async function playProbableSetlist() {
    if (!item.probable_setlist?.length) return;
    try {
      setPlayingSetlist(true);
      const queue = await fetchPlayableSetlist(item.artist);
      if (!queue.length) {
        toast.info("No probable setlist tracks matched your library");
        return;
      }
      playAll(queue, 0, { type: "playlist", name: `${item.artist} Probable Setlist` });
      toast.success(`Playing probable setlist: ${queue.length} tracks`);
    } catch {
      toast.error("Failed to load probable setlist");
    } finally {
      setPlayingSetlist(false);
    }
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border transition-[height,transform,border-color,background-color,box-shadow] duration-300 ease-out",
        expanded
          ? "animate-upcoming-expand border-primary/20 shadow-[0_18px_60px_rgba(6,182,212,0.14)]"
          : "border-primary/10 bg-white/[0.02] hover:border-primary/25 hover:bg-white/[0.04]",
      )}
      style={{ height: expanded ? 320 : 92 }}
      onClick={!expanded ? onToggle : undefined}
    >
      <div className="absolute inset-0 bg-[#11131a]" />

      <div
        className={cn(
          "upcoming-map absolute inset-0 z-0 transition-opacity duration-300",
          expanded ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {expanded && position ? (
          <MapContainer
            center={position}
            zoom={14}
            style={{ width: "100%", height: "100%" }}
            zoomControl
            attributionControl={false}
            dragging
            scrollWheelZoom
            doubleClickZoom
            touchZoom
            boxZoom={false}
            keyboard={false}
          >
            <MapSizeFixer />
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            <Marker position={position}>
              <Popup className="upcoming-marker-popup">
                <div className="space-y-2 text-xs">
                  <div>
                    <div className="font-semibold text-foreground">{item.venue || item.artist}</div>
                    <div className="text-muted-foreground">{location || item.subtitle}</div>
                  </div>
                  <div className="space-y-1 text-muted-foreground">
                    <div>{dateStr}</div>
                    {timeStr ? <div>Doors / time: {timeStr}</div> : null}
                    {item.lineup?.length ? <div>Lineup: {item.lineup.slice(0, 6).join(" · ")}</div> : null}
                  </div>
                </div>
              </Popup>
            </Marker>
          </MapContainer>
        ) : null}
      </div>

      {!expanded ? (
        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-4 p-3">
        <div className="relative h-14 w-14 overflow-hidden rounded-xl bg-white/5 flex-shrink-0">
          <img
            src={`/api/artist/${encPath(item.artist)}/photo`}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
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
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <div className="text-right text-primary">
            <div className="text-xs font-semibold">{dateStr}</div>
            {timeStr ? <div className="text-[10px] text-white/35">{timeStr}</div> : null}
          </div>
          <RowActionButton
            onClick={(event) => {
              event.stopPropagation();
              void playProbableSetlist();
            }}
            disabled={!item.probable_setlist?.length || playingSetlist}
            title="Play probable setlist"
          >
            {playingSetlist ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} className="fill-current" />}
          </RowActionButton>
          <RowActionButton
            onClick={(event) => {
              void toggleAttendance();
              event.stopPropagation();
            }}
            disabled={!item.id || savingAttendance}
            title={attending ? "Attending" : "Mark as attending"}
            active={attending}
          >
            {savingAttendance ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          </RowActionButton>
          <RowActionLink
            href={item.url}
            onClick={(event) => {
              if (!item.url) {
                event.preventDefault();
              }
              event.stopPropagation();
            }}
            title="Tickets"
          >
            <Ticket size={14} />
          </RowActionLink>
        </div>
        </div>
      ) : null}

      {expanded ? (
        <>
          <button
            onClick={onToggle}
            className="absolute top-3 right-3 z-[1000] rounded-full bg-black/60 p-1.5 transition-colors hover:bg-black/80"
          >
            <X size={14} className="text-white" />
          </button>

          {item.venue ? (
            <div className="absolute top-3 left-3 z-[1000] max-w-[220px] rounded-lg bg-black/70 px-3 py-2 backdrop-blur-sm">
              <div className="flex items-center gap-1.5">
                <MapPin size={12} className="text-primary flex-shrink-0" />
                <div className="truncate text-xs font-semibold text-white">{item.venue}</div>
              </div>
              <div className="ml-[18px] text-[10px] text-white/50">{location}</div>
            </div>
          ) : null}

          <div className="absolute top-12 right-3 z-[1000] flex flex-col gap-2">
            <RowActionButton
              onClick={() => {
                void playProbableSetlist();
              }}
              disabled={!item.probable_setlist?.length || playingSetlist}
              title="Play probable setlist"
            >
              {playingSetlist ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} className="fill-current" />}
            </RowActionButton>
            <RowActionButton
              onClick={toggleAttendance}
              disabled={!item.id || savingAttendance}
              title={attending ? "Attending" : "Mark as attending"}
              active={attending}
            >
              {savingAttendance ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            </RowActionButton>
            <RowActionLink
              href={item.url}
              onClick={(event) => {
                if (!item.url) event.preventDefault();
              }}
              title="Tickets"
            >
              <Ticket size={15} />
            </RowActionLink>
          </div>

          <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-[1000] bg-gradient-to-t from-black/90 via-black/70 to-transparent pt-16 pb-4 px-4">
            <div className="pointer-events-none flex items-end gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5 mb-1">
                  <img
                    src={`/api/artist/${encPath(item.artist)}/photo`}
                    alt=""
                    className="w-10 h-10 rounded-full object-cover ring-2 ring-primary/30 flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                  <Link
                    to={`/artist/${encPath(item.artist)}`}
                    className="pointer-events-auto text-xl font-bold text-white transition-colors hover:text-primary"
                  >
                    {item.artist}
                  </Link>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  {item.genres?.slice(0, 3).map((genre) => (
                    <span
                      key={genre}
                      className="rounded-full border border-white/20 px-2 py-0.5 text-[9px] text-white/70"
                    >
                      {genre}
                    </span>
                  ))}
                </div>

                <div className="mt-2 flex items-center gap-4 text-xs text-white/70">
                  <span className="flex items-center gap-1">
                    <Calendar size={12} className="text-primary" /> {dateStr}
                  </span>
                  {timeStr ? (
                    <span className="flex items-center gap-1">
                      <Clock size={12} className="text-primary" /> {timeStr}
                    </span>
                  ) : null}
                </div>

                {item.lineup && item.lineup.length > 1 ? (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-white/40">Lineup:</span>
                    {item.lineup.slice(0, 5).map((name) => (
                      <Link
                        key={name}
                        to={`/artist/${encPath(name)}`}
                        className="pointer-events-auto flex items-center gap-1 text-[11px] text-white/80 transition-colors hover:text-primary"
                      >
                        <img
                          src={`/api/artist/${encPath(name)}/photo`}
                          alt=""
                          className="w-4 h-4 rounded-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                        {name}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
