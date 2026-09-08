import { useTranslation } from "react-i18next";
import { CalendarCheck, CalendarPlus, Loader2, MapPin } from "@crate/ui/icons";

import { ItemActionMenuButton } from "@/components/actions/ItemActionMenu";
import { CrateImage } from "@/components/artwork/CrateImage";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import {
  artistBackgroundApiUrl,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

import type { CollapsedViewProps } from "./UpcomingShowCardViewTypes";

function PreloadBackground({ item }: { item: CollapsedViewProps["item"] }) {
  const url = artistBackgroundApiUrl(
    {
      artistId: item.artist_id,
      artistSlug: item.artist_slug,
      artistName: item.artist,
    },
    { size: 1280 },
  );
  if (!url) return null;
  return <CrateImage src={url} alt="" className="hidden" />;
}

function CollapsedShowArtwork({
  item,
  artistImageUrl,
}: {
  item: CollapsedViewProps["item"];
  artistImageUrl?: string;
}) {
  return (
    <div className="h-full w-[88px] shrink-0 bg-text-primary/5">
      {artistImageUrl && (
        <CrateImage
          src={artistImageUrl}
          alt={item.artist}
          loading="lazy"
          className=" size-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
    </div>
  );
}

function CollapsedShowDetails({
  item,
  attending,
}: {
  item: CollapsedViewProps["item"];
  attending: boolean;
}) {
  const { t } = useTranslation();
  const support = (item.lineup || []).slice(1);

  return (
    <div className="min-w-0 flex-1 px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[0.8125rem] font-semibold text-text-primary">
          {item.artist}
        </span>
        {attending && (
          <span
            className="size-[6px] shrink-0 rounded-full bg-accent-action"
            title={t("radar.show.attending")}
          />
        )}
      </div>
      <div className="mt-1 flex items-center gap-1 text-xs text-text-primary/40">
        <MapPin size={10} className="shrink-0 text-accent-action/60" />
        <span className="truncate">{item.venue}</span>
        {item.city && (
          <>
            <span className="text-text-primary/15">&middot;</span>
            <span className="shrink-0">{item.city}</span>
          </>
        )}
      </div>
      {support.length > 0 && (
        <div className="mt-0.5 truncate text-xs text-text-primary/40">
          {t("radar.show.withSupportPrefix")} {support.slice(0, 3).join(", ")}
          {support.length > 3 && ` +${support.length - 3}`}
        </div>
      )}
    </div>
  );
}

function CollapsedShowDate({
  item,
  locale,
}: {
  item: CollapsedViewProps["item"];
  locale: string;
}) {
  const date = item.date ? new Date(`${item.date}T12:00:00`) : null;
  const month = date
    ? date.toLocaleDateString(locale, { month: "short" }).toUpperCase()
    : "";
  const day = date ? String(date.getDate()) : "";
  const weekday = date
    ? date.toLocaleDateString(locale, { weekday: "short" }).toUpperCase()
    : "";

  return (
    <div className="flex shrink-0 flex-col items-center justify-center px-2">
      <span className="text-xs font-bold leading-none tracking-[0.12em] text-accent-action/55">
        {month}
      </span>
      <span className="text-[1.25rem] font-black leading-tight text-accent-action">
        {day}
      </span>
      <span className="text-xs font-medium leading-none text-text-primary/40">
        {weekday}
      </span>
    </div>
  );
}

function CollapsedShowActions({
  item,
  attending,
  savingAttendance,
  actionMenu,
  onToggleAttendance,
}: CollapsedViewProps) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 flex-col items-center gap-1 pr-2">
      <button
        onClick={(e) => {
          e.stopPropagation();
          void onToggleAttendance();
        }}
        disabled={!item.id || savingAttendance}
        title={
          attending
            ? t("radar.show.attending")
            : t("actions.show.markAttending")
        }
        className="flex size-8 items-center justify-center rounded-lg text-text-primary/30 transition-colors hover:bg-text-primary/8 hover:text-text-primary/60 disabled:opacity-30"
      >
        {savingAttendance ? (
          <Loader2 size={15} className="animate-spin" />
        ) : attending ? (
          <CalendarCheck size={15} className="text-accent-action" />
        ) : (
          <CalendarPlus size={15} />
        )}
      </button>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.onOpen}
        className=" size-7 opacity-40 transition-opacity hover:opacity-80"
      />
    </div>
  );
}

export function UpcomingShowCollapsedView({
  item,
  attending,
  savingAttendance,
  actionMenu,
  onToggleAttendance,
}: CollapsedViewProps) {
  const { i18n } = useTranslation();
  const artistImageUrl =
    artistPhotoApiUrl(
      {
        artistId: item.artist_id,
        artistSlug: item.artist_slug,
        artistName: item.artist,
      },
      { size: 320 },
    ) ||
    resolveMaybeApiAssetUrl(item.cover_url) ||
    undefined;

  return (
    <div className="absolute inset-x-0 top-0 z-10 flex h-full items-center gap-0">
      <PreloadBackground item={item} />
      <CollapsedShowArtwork item={item} artistImageUrl={artistImageUrl} />
      <CollapsedShowDetails item={item} attending={attending} />
      <CollapsedShowDate item={item} locale={i18n.language} />
      <CollapsedShowActions
        item={item}
        attending={attending}
        savingAttendance={savingAttendance}
        actionMenu={actionMenu}
        onToggleAttendance={onToggleAttendance}
      />
    </div>
  );
}
