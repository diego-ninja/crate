import type { TFunction } from "i18next";
import { Link } from "react-router";
import { Calendar, Disc3, Play } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";

import type { UpcomingItem } from "./upcoming-model";
import type { UpcomingEventRowModel } from "./upcoming-event-row-model";

export function UpcomingEventRowArtwork({
  coverUrl,
}: Pick<UpcomingEventRowModel, "coverUrl">) {
  return (
    <>
      <div className="upcoming-event-row-atmosphere absolute inset-0" />
      {coverUrl ? (
        <CrateImage
          src={coverUrl}
          alt=""
          loading="lazy"
          className="absolute inset-y-0 right-0 h-full w-1/2 object-cover opacity-[0.24] grayscale transition-opacity group-hover:opacity-[0.34]"
          onError={(event) => {
            (event.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : null}
      <div className="upcoming-event-row-scrim absolute inset-0" />
      <div className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-border-quiet bg-text-primary/5">
        {coverUrl ? (
          <CrateImage
            src={coverUrl}
            alt=""
            loading="lazy"
            className=" size-full object-cover"
            onError={(event) => {
              (event.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-accent-action">
            <Disc3 size={24} />
          </div>
        )}
      </div>
    </>
  );
}

export function UpcomingEventRowDetails({
  artistPath,
  badgeLabel,
  item,
}: {
  artistPath: string;
  badgeLabel: string;
  item: UpcomingItem;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-accent-action/15 bg-accent-action/10 px-2.5 py-1 text-xs font-medium uppercase tracking-[0.16em] text-accent-action">
        <Disc3 size={11} />
        {badgeLabel}
      </div>
      <h3 className="truncate text-lg font-extrabold text-text-primary">
        {item.title}
      </h3>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
        <Link
          to={artistPath}
          className="truncate transition-colors hover:text-text-primary"
        >
          {item.artist}
        </Link>
        <span className="text-text-primary/20">&middot;</span>
        <span className="truncate">{item.subtitle}</span>
      </div>
    </div>
  );
}

export function UpcomingEventRowActions({
  albumPath,
  countdown,
  dateLabel,
  t,
}: Pick<UpcomingEventRowModel, "albumPath" | "countdown" | "dateLabel"> & {
  t: TFunction;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
      {dateLabel ? (
        <div className="inline-flex items-center gap-2 rounded-lg border border-border-quiet bg-text-primary/[0.06] px-3 py-2 text-sm font-semibold text-accent-action backdrop-blur">
          <Calendar size={14} />
          {dateLabel}
        </div>
      ) : null}
      {albumPath ? (
        <Link
          to={albumPath}
          className="inline-flex items-center gap-2 rounded-full bg-accent-action px-3.5 py-2 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90"
        >
          <Play size={14} className="fill-current" />
          {t("common.open")}
        </Link>
      ) : null}
      {countdown ? (
        <div className="rounded-lg border border-accent-action/15 bg-accent-action/10 px-3 py-2 text-sm font-semibold text-accent-action backdrop-blur">
          {countdown.unit === "hours"
            ? t("radar.show.time.hoursToGo", { count: countdown.value })
            : t("radar.show.time.daysToGo", { count: countdown.value })}
        </div>
      ) : null}
    </div>
  );
}
