import { Link } from "react-router";
import { Check, Loader2, MapPin, Play, Ticket } from "lucide-react";

import { ItemActionMenu, ItemActionMenuButton, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { useShowActionEntries } from "@/components/actions/show-actions";
import { cn } from "@/lib/utils";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

import { UpcomingActionButton, UpcomingActionLink } from "./UpcomingActionButtons";
import { useUpcomingShowActions } from "./use-upcoming-show-actions";
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
  const {
    attending,
    savingAttendance,
    playingSetlist,
    toggleAttendance,
    playProbableSetlist,
  } = useUpcomingShowActions(item, onAttendanceChange);
  const menuActions = useShowActionEntries({
    item,
    attending,
    toggleAttendance,
    playProbableSetlist,
  });
  const actionMenu = useItemActionMenu(menuActions, { disabled: !isShow });

  return (
    <div
      className={cn(
        "group flex items-center gap-4 rounded-2xl border p-3 transition-all",
        isShow
          ? "cursor-pointer border-primary/10 bg-white/[0.02] hover:border-primary/25 hover:bg-white/[0.04]"
          : "border-primary/10 bg-white/[0.02] hover:border-primary/20 hover:bg-white/[0.04]",
      )}
      onContextMenu={actionMenu.handleContextMenu}
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
          loading="lazy"
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

        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
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
                className="truncate text-muted-foreground transition-colors hover:text-foreground"
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
          {timeStr ? <div className="text-[10px] text-white/40">{timeStr}</div> : null}
        </div>
        {isShow ? (
          <>
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
                event.stopPropagation();
                void toggleAttendance();
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
                  event.stopPropagation();
                } else {
                  event.stopPropagation();
                }
              }}
              title="Tickets"
            >
              <Ticket size={14} />
            </UpcomingActionLink>
            <ItemActionMenuButton
              buttonRef={actionMenu.triggerRef}
              hasActions={actionMenu.hasActions}
              onClick={actionMenu.openFromTrigger}
              className="h-8 w-8 opacity-80 transition-opacity hover:opacity-100"
            />
          </>
        ) : null}
      </div>
      <ItemActionMenu
        actions={menuActions}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}
