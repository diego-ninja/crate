import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Calendar,
  Clock,
  ExternalLink,
  Loader2,
  MapPin,
  Music4,
  Ticket,
} from "lucide-react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { cn, encPath } from "@/lib/utils";

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
          const isExpanded = item.type === "show" && expandedId === key;
          return isExpanded ? (
            <ShowDetailPanel
              key={key}
              item={itemWithOverrides}
              onClose={() => onToggleExpand(null)}
              onAttendanceChange={(attending) => {
                setAttendanceOverrides((current) => ({ ...current, [key]: attending }));
              }}
            />
          ) : (
            <UpcomingEventRow
              key={key}
              item={itemWithOverrides}
              onClick={item.type === "show" ? () => onToggleExpand(key) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

export function UpcomingEventRow({
  item,
  onClick,
}: {
  item: UpcomingItem;
  onClick?: () => void;
}) {
  const isShow = item.type === "show";
  const dateObj = item.date ? new Date(`${item.date}T12:00:00`) : null;
  const dateStr = dateObj
    ? dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "";
  const timeStr = item.time ? item.time.slice(0, 5) : "";

  return (
    <div
      className={cn(
        "group flex items-center gap-4 rounded-2xl border p-3 transition-all",
        isShow
          ? "cursor-pointer border-amber-500/10 bg-white/[0.02] hover:border-amber-500/20 hover:bg-white/[0.04]"
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
        {item.type === "release" && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-gradient-to-t from-black/80 to-transparent pb-1 pt-4">
            <span className="rounded-full border border-primary/30 bg-black/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
              Release
            </span>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {isShow ? item.artist : item.title}
          </span>
          {item.genres?.slice(0, 2).map((genre) => (
            <span
              key={genre}
              className="hidden rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/50 sm:inline-flex"
            >
              {genre}
            </span>
          ))}
        </div>

        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/45">
          {isShow ? (
            <>
              <span className="inline-flex items-center gap-1 truncate">
                <MapPin size={11} className="text-amber-400/70" />
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

        {isShow && item.probable_setlist?.length ? (
          <div className="mt-2 flex items-center gap-2 overflow-hidden">
            <span className="text-[10px] uppercase tracking-[0.16em] text-white/30">Probable setlist</span>
            <div className="flex min-w-0 gap-1 overflow-hidden">
              {item.probable_setlist.slice(0, 3).map((song) => (
                <span
                  key={song.title}
                  className="truncate rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/50"
                >
                  {song.title}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {isShow && item.user_attending ? (
          <div className="mt-2">
            <span className="inline-flex rounded-full border border-primary/20 bg-primary/12 px-2 py-0.5 text-[10px] font-medium text-primary">
              You&apos;re going
            </span>
          </div>
        ) : null}
      </div>

      <div className={cn("text-right flex-shrink-0", isShow ? "text-amber-400" : "text-primary")}>
        <div className="text-xs font-semibold">{dateStr}</div>
        {timeStr ? <div className="text-[10px] text-white/35">{timeStr}</div> : null}
      </div>

      {isShow && item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="rounded-xl border border-amber-500/20 p-2 text-amber-400 transition-colors hover:bg-amber-500/10"
        >
          <ExternalLink size={14} />
        </a>
      ) : null}
    </div>
  );
}

export function ShowDetailPanel({
  item,
  onClose,
  onAttendanceChange,
}: {
  item: UpcomingItem;
  onClose: () => void;
  onAttendanceChange?: (attending: boolean) => void;
}) {
  const [attending, setAttending] = useState(Boolean(item.user_attending));
  const [savingAttendance, setSavingAttendance] = useState(false);
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

  return (
    <div className="relative overflow-hidden rounded-[1.4rem] border border-amber-500/20">
      <div className="absolute inset-0 bg-[#11131a]" />
      {position ? (
        <div className="absolute inset-0">
          <MapContainer
            center={position}
            zoom={13}
            style={{ width: "100%", height: "100%" }}
            zoomControl={false}
            attributionControl={false}
            scrollWheelZoom={false}
            dragging
          >
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            <Marker position={position}>
              <Popup>
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
                  {item.probable_setlist?.length ? (
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Probable setlist
                      </div>
                      <div className="space-y-1">
                        {item.probable_setlist.slice(0, 6).map((song, index) => (
                          <div key={song.title} className="truncate text-foreground">
                            {song.position ?? index + 1}. {song.title}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </Popup>
            </Marker>
          </MapContainer>
        </div>
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-[#05070d] via-[#05070d]/72 to-[#05070d]/25" />

      <button
        onClick={onClose}
        className="absolute right-3 top-3 z-10 rounded-full border border-white/10 bg-black/50 px-3 py-1 text-xs text-white/70 transition-colors hover:bg-black/70 hover:text-white"
      >
        Close
      </button>

      {item.venue ? (
        <div className="absolute left-3 top-3 z-10 max-w-[240px] rounded-2xl border border-white/10 bg-black/55 px-3 py-2 backdrop-blur-md">
          <div className="flex items-center gap-1.5">
            <MapPin size={12} className="text-amber-400 flex-shrink-0" />
            <div className="truncate text-xs font-semibold text-white">{item.venue}</div>
          </div>
          <div className="ml-[18px] mt-0.5 text-[10px] text-white/45">{location}</div>
        </div>
      ) : null}

      <div className="relative z-10 flex min-h-[310px] items-end px-4 pb-4 pt-24">
        <div className="flex w-full items-end gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex items-center gap-3">
              <img
                src={`/api/artist/${encPath(item.artist)}/photo`}
                alt=""
                className="h-12 w-12 rounded-full object-cover ring-2 ring-amber-500/30"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              <div className="min-w-0">
                <Link
                  to={`/artist/${encPath(item.artist)}`}
                  className="block truncate text-xl font-bold text-white transition-colors hover:text-amber-300"
                >
                  {item.artist}
                </Link>
                {item.genres?.length ? (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {item.genres.slice(0, 4).map((genre) => (
                      <span
                        key={genre}
                        className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/55"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-white/70">
              <span className="inline-flex items-center gap-1">
                <Calendar size={12} className="text-amber-400" />
                {dateStr}
              </span>
              {timeStr ? (
                <span className="inline-flex items-center gap-1">
                  <Clock size={12} className="text-amber-400" />
                  {timeStr}
                </span>
              ) : null}
              {location ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={12} className="text-amber-400" />
                  {location}
                </span>
              ) : null}
            </div>

            {item.lineup && item.lineup.length > 1 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide text-white/35">Lineup</span>
                {item.lineup.slice(0, 6).map((name) => (
                  <Link
                    key={name}
                    to={`/artist/${encPath(name)}`}
                    className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/75 transition-colors hover:text-white"
                  >
                    <Music4 size={11} className="text-amber-400/80" />
                    {name}
                  </Link>
                ))}
              </div>
            ) : null}

            {item.probable_setlist?.length ? (
              <div className="mt-4">
                <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/35">
                  Probable setlist
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {item.probable_setlist.slice(0, 8).map((song, index) => (
                    <span
                      key={song.title}
                      className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/75"
                    >
                      {song.position ?? index + 1}. {song.title}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-shrink-0 flex-col items-stretch gap-2">
            {item.id ? (
              <button
                onClick={toggleAttendance}
                disabled={savingAttendance}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition-colors",
                  attending
                    ? "border-primary/30 bg-primary/15 text-primary hover:bg-primary/20"
                    : "border-white/15 bg-black/35 text-white hover:bg-black/55",
                )}
              >
                {savingAttendance ? <Loader2 size={15} className="animate-spin" /> : null}
                {attending ? "You're going" : "I'm going"}
              </button>
            ) : null}
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-amber-400"
              >
                <Ticket size={15} />
                Tickets
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
