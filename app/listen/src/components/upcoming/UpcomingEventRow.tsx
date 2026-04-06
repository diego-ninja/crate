import { type MouseEvent as ReactMouseEvent, useEffect, useState } from "react";
import { Link } from "react-router";
import { Check, Loader2, MapPin, Play, Ticket } from "lucide-react";
import { toast } from "sonner";

import { usePlayerActions } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { fetchPlayableSetlist } from "@/lib/upcoming";
import { cn } from "@/lib/utils";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

import { UpcomingActionButton, UpcomingActionLink } from "./UpcomingActionButtons";
import type { UpcomingItem } from "./upcoming-model";

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
  const artistImageUrl = artistPhotoApiUrl({
    artistId: item.artist_id,
    artistSlug: item.artist_slug,
    artistName: item.artist,
  }) || item.cover_url || undefined;

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
    if (!isShow || !item.probable_setlist?.length) {
      toast.info("No probable setlist available for this show");
      return;
    }
    if (!item.artist_id) {
      toast.info("Artist not linked to library");
      return;
    }
    setPlayingSetlist(true);
    try {
      const queue = await fetchPlayableSetlist({ artistId: item.artist_id, artistName: item.artist });
      if (!queue.length) {
        toast.info(`None of the ${item.probable_setlist.length} setlist tracks were found in your library`);
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
      <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-white/5">
        <img
          src={
            isShow
              ? artistImageUrl
              : item.cover_url || artistImageUrl
          }
          alt=""
          className="h-full w-full object-cover"
          onError={(event) => {
            (event.target as HTMLImageElement).style.display = "none";
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
                to={artistPagePath({ artistId: item.artist_id, artistSlug: item.artist_slug })}
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
            <UpcomingActionButton
              onClick={playProbableSetlist}
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
              onClick={toggleAttendance}
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
                  event.stopPropagation();
                } else {
                  event.stopPropagation();
                }
              }}
              title="Tickets"
            >
              <Ticket size={14} />
            </UpcomingActionLink>
          </>
        ) : null}
      </div>
    </div>
  );
}
