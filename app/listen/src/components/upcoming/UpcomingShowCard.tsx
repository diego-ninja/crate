import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Calendar, Check, Clock, Loader2, MapPin, Play, Ticket, X } from "lucide-react";
import { MapContainer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { toast } from "sonner";

import { usePlayerActions } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { fetchPlayableSetlist } from "@/lib/upcoming";
import { cn, encPath } from "@/lib/utils";

import { UpcomingActionButton, UpcomingActionLink } from "./UpcomingActionButtons";
import { UpcomingShowMap } from "./UpcomingShowMap";
import type { UpcomingItem } from "./upcoming-model";

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
      <div className="absolute inset-0 bg-raised-surface" />

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
            zoomControl={false}
            attributionControl={false}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            touchZoom={false}
            boxZoom={false}
            keyboard={false}
          >
            <UpcomingShowMap
              item={item}
              position={position}
              dateLabel={dateStr}
              timeLabel={timeStr}
              locationLabel={location}
            />
          </MapContainer>
        ) : null}
      </div>

      {!expanded ? (
        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-4 p-3">
          <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-white/5">
            <img
              src={`/api/artist/${encPath(item.artist)}/photo`}
              alt=""
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
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <div className="text-right text-primary">
              <div className="text-xs font-semibold">{dateStr}</div>
              {timeStr ? <div className="text-[10px] text-white/35">{timeStr}</div> : null}
            </div>
            <UpcomingActionButton
              onClick={(event) => {
                event.stopPropagation();
                void playProbableSetlist();
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
                void toggleAttendance();
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
            <UpcomingActionLink
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
            </UpcomingActionLink>
          </div>
        </div>
      ) : null}

      {expanded ? (
        <>
          <button
            onClick={onToggle}
            className="z-app-upcoming-overlay absolute top-3 right-3 rounded-full bg-black/60 p-1.5 transition-colors hover:bg-black/80"
          >
            <X size={14} className="text-white" />
          </button>

          {item.venue ? (
            <div className="z-app-upcoming-overlay absolute top-3 left-3 max-w-[220px] rounded-lg bg-black/70 px-3 py-2 backdrop-blur-sm">
              <div className="flex items-center gap-1.5">
                <MapPin size={12} className="flex-shrink-0 text-primary" />
                <div className="truncate text-xs font-semibold text-white">{item.venue}</div>
              </div>
              <div className="ml-[18px] text-[10px] text-white/50">{location}</div>
            </div>
          ) : null}

          <div className="z-app-upcoming-overlay absolute top-12 right-3 flex flex-col gap-2">
            <UpcomingActionButton
              onClick={() => {
                void playProbableSetlist();
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
              onClick={toggleAttendance}
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
            <UpcomingActionLink
              href={item.url}
              onClick={(event) => {
                if (!item.url) event.preventDefault();
              }}
              title="Tickets"
            >
              <Ticket size={15} />
            </UpcomingActionLink>
          </div>

          <div className="z-app-upcoming-overlay pointer-events-none absolute right-0 bottom-0 left-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-4 pt-16 pb-4">
            <div className="pointer-events-none flex items-end gap-4">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2.5">
                  <img
                    src={`/api/artist/${encPath(item.artist)}/photo`}
                    alt=""
                    className="h-10 w-10 flex-shrink-0 rounded-full object-cover ring-2 ring-primary/30"
                    onError={(event) => {
                      (event.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                  <Link
                    to={`/artist/${encPath(item.artist)}`}
                    className="pointer-events-auto text-xl font-bold text-white transition-colors hover:text-primary"
                  >
                    {item.artist}
                  </Link>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
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
                  <div className="mt-2 flex flex-wrap items-center gap-2">
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
                          className="h-4 w-4 rounded-full object-cover"
                          onError={(event) => {
                            (event.target as HTMLImageElement).style.display = "none";
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
