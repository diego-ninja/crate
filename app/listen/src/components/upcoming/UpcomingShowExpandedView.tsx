import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  CalendarCheck,
  CalendarPlus,
  ExternalLink,
  Loader2,
  MapPin,
  Play,
  X,
} from "@crate/ui/icons";

import { GenrePillRow } from "@crate/ui/domain/genres/GenrePill";
import { CrateImage } from "@/components/artwork/CrateImage";
import {
  artistBackgroundApiUrl,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

import {
  formatShowTimeRemaining,
  showDirectionsUrl,
} from "./UpcomingShowCardModel";
import type { ExpandedViewProps } from "./UpcomingShowCardViewTypes";

function ExpandedShowBackground({ backgroundUrl }: { backgroundUrl?: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {backgroundUrl && (
        <CrateImage
          src={backgroundUrl}
          alt=""
          className="absolute inset-0 size-full object-cover brightness-[0.4] saturate-[0.7]"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div className="absolute inset-0 bg-linear-to-t from-surface-canvas via-surface-canvas/60 to-transparent" />
    </div>
  );
}

function ExpandedShowHeader({
  item,
  artistPhotoUrl,
  dateLabel,
  timeLabel,
  timeRemaining,
  onClose,
  showClose,
}: {
  item: ExpandedViewProps["item"];
  artistPhotoUrl?: string;
  dateLabel: string;
  timeLabel: string;
  timeRemaining: string | null;
  onClose: () => void;
  showClose: boolean;
}) {
  const { t } = useTranslation();
  const support = (item.lineup || []).slice(1);

  return (
    <div className="relative h-[130px] shrink-0">
      {showClose ? (
        <button
          onClick={onClose}
          aria-label={t("radar.show.closeDetails")}
          className="absolute top-2.5 left-2.5 z-10 flex size-7 items-center justify-center rounded-lg bg-surface-canvas/40 text-text-primary/60 backdrop-blur-sm transition-colors hover:text-text-primary"
        >
          <X size={14} />
        </button>
      ) : null}

      <div className="absolute top-2.5 right-3 z-10 text-right">
        {timeRemaining ? (
          <div className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-accent-action">
            {timeRemaining}
          </div>
        ) : null}
        <div className="text-xs font-bold tracking-wide text-accent-action/70">
          {dateLabel}
        </div>
        {timeLabel && (
          <div className="text-xs text-text-primary/40">{timeLabel}</div>
        )}
      </div>

      <div className="absolute bottom-3 left-3 right-3 z-10">
        <div className="flex items-center gap-2">
          {artistPhotoUrl && (
            <CrateImage
              src={artistPhotoUrl}
              alt={item.artist}
              className=" size-9 shrink-0 rounded-full object-cover ring-2 ring-primary/25"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          <div className="min-w-0">
            <Link
              to={artistPagePath({
                artistId: item.artist_id,
                artistSlug: item.artist_slug,
              })}
              className="block truncate text-sm font-bold text-text-primary transition-colors hover:text-accent-action"
            >
              {item.artist}
            </Link>
            {support.length > 0 && (
              <div className="truncate text-xs text-text-primary/40">
                {t("radar.show.withSupportPrefix")}{" "}
                {support.slice(0, 4).join(" · ")}
                {support.length > 4 && " +" + (support.length - 4)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type ExpandedShowActionProps = Pick<
  ExpandedViewProps,
  | "item"
  | "attending"
  | "savingAttendance"
  | "playingSetlist"
  | "onToggleAttendance"
  | "onPlaySetlist"
> & { directionsUrl: string | null };

function ExpandedShowActions({
  item,
  attending,
  savingAttendance,
  playingSetlist,
  directionsUrl,
  onToggleAttendance,
  onPlaySetlist,
}: ExpandedShowActionProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "mt-3 grid gap-2 sm:grid-cols-2",
        directionsUrl ? "lg:grid-cols-4" : "lg:grid-cols-3",
      )}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          void onToggleAttendance();
        }}
        disabled={!item.id || savingAttendance}
        className={cn(
          "flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-xs font-semibold transition-colors",
          attending
            ? "border-accent-action/30 bg-accent-action/10 text-accent-action"
            : "border-border-quiet text-text-muted hover:border-accent-action/20 hover:text-accent-action",
        )}
      >
        {savingAttendance ? (
          <Loader2 size={13} className="animate-spin" />
        ) : attending ? (
          <CalendarCheck size={13} />
        ) : (
          <CalendarPlus size={13} />
        )}
        {attending ? t("radar.show.going") : t("radar.show.attend")}
      </button>
      <button
        onClick={() => void onPlaySetlist()}
        disabled={!item.probable_setlist?.length || playingSetlist}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-accent-action/20 py-2.5 text-xs font-semibold text-accent-action transition-colors hover:bg-accent-action/8 disabled:opacity-25"
      >
        {playingSetlist ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Play size={13} className="fill-current" />
        )}
        {t("radar.show.playSetlist")}
      </button>
      {directionsUrl ? (
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border-quiet py-2.5 text-xs font-semibold text-text-muted transition-colors hover:border-accent-action/20 hover:text-accent-action"
        >
          <MapPin size={13} />
          {t("radar.show.directions")}
        </a>
      ) : null}
      <a
        href={item.url || "#"}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          if (!item.url) e.preventDefault();
        }}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-accent-action/10 py-2.5 text-xs font-semibold text-accent-action transition-colors hover:bg-accent-action/18"
      >
        <ExternalLink size={13} />
        {t("radar.show.getTickets")}
        {item.status === "onsale" && (
          <span className="size-[5px] rounded-full bg-state-success" />
        )}
      </a>
    </div>
  );
}

function ExpandedShowDetails(props: ExpandedShowActionProps) {
  const { item } = props;
  const addressLabel = [item.address_line1, item.postal_code]
    .filter(Boolean)
    .join(" · ");
  const locationLabel = [item.city, item.region, item.country]
    .filter(Boolean)
    .join(", ");
  const genreItems = (item.genres || []).slice(0, 3).map((name) => ({ name }));

  return (
    <div className="relative flex-1 px-3 pt-2.5 pb-3">
      <div className="flex items-start gap-2 text-xs text-text-muted">
        <MapPin size={11} className="mt-0.5 shrink-0 text-accent-action/60" />
        <div className="min-w-0">
          <span className="font-medium text-text-primary/70">{item.venue}</span>
          {addressLabel && (
            <span className="text-text-primary/40"> · {addressLabel}</span>
          )}
          {locationLabel && (
            <div className="text-text-primary/40">{locationLabel}</div>
          )}
        </div>
      </div>

      <GenrePillRow items={genreItems} max={3} className="mt-2" />
      <ExpandedShowActions {...props} />
    </div>
  );
}

export function UpcomingShowExpandedView({
  item,
  attending,
  savingAttendance,
  playingSetlist,
  onToggleAttendance,
  onPlaySetlist,
  onClose,
  showClose = true,
}: ExpandedViewProps) {
  const { t, i18n } = useTranslation();
  const backgroundUrl = artistBackgroundApiUrl(
    {
      artistId: item.artist_id,
      artistSlug: item.artist_slug,
      artistName: item.artist,
    },
    { size: 1280 },
  );
  const artistPhotoUrl =
    artistPhotoApiUrl(
      {
        artistId: item.artist_id,
        artistSlug: item.artist_slug,
        artistName: item.artist,
      },
      { size: 640 },
    ) ||
    resolveMaybeApiAssetUrl(item.cover_url) ||
    undefined;
  const date = item.date ? new Date(item.date + "T12:00:00") : null;
  const dateLabel = date
    ? date.toLocaleDateString(i18n.language, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";
  const timeLabel = item.time ? item.time.slice(0, 5) : "";
  const timeRemaining = formatShowTimeRemaining(item, t);
  const directionsUrl = showDirectionsUrl(item);

  return (
    <div className="relative flex h-full flex-col">
      <ExpandedShowBackground backgroundUrl={backgroundUrl} />
      <ExpandedShowHeader
        item={item}
        artistPhotoUrl={artistPhotoUrl}
        dateLabel={dateLabel}
        timeLabel={timeLabel}
        timeRemaining={timeRemaining}
        onClose={onClose}
        showClose={showClose}
      />
      <ExpandedShowDetails
        item={item}
        attending={attending}
        savingAttendance={savingAttendance}
        playingSetlist={playingSetlist}
        directionsUrl={directionsUrl}
        onToggleAttendance={onToggleAttendance}
        onPlaySetlist={onPlaySetlist}
      />
    </div>
  );
}
