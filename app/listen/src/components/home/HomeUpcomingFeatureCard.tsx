import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Calendar, Disc3, MapPin, Play, RadioTower } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";

import type { HomeUpcomingItem } from "./home-model";
import { buildUpcomingPresentation } from "./home-upcoming-model";

function UpcomingFeatureMeta({
  item,
  isShow,
  date,
}: {
  item: HomeUpcomingItem;
  isShow: boolean;
  date: string | null;
}) {
  const { t } = useTranslation();

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {date ? (
        <div className="home-upcoming-meta-card rounded-lg px-3 py-2 backdrop-blur">
          <div className="home-upcoming-meta-label text-xs uppercase tracking-[0.16em]">
            {t("home.radar.meta.date")}
          </div>
          <div className="mt-1 text-sm font-semibold text-text-primary">
            {date}
          </div>
        </div>
      ) : null}
      {isShow && item.venue ? (
        <div className="home-upcoming-meta-card rounded-lg px-3 py-2 backdrop-blur">
          <div className="home-upcoming-meta-label text-xs uppercase tracking-[0.16em]">
            {t("home.radar.meta.venue")}
          </div>
          <div className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-text-primary">
            <MapPin size={12} className="text-accent-action" />
            {item.venue}
          </div>
        </div>
      ) : null}
      {item.user_attending && isShow ? (
        <div className="home-upcoming-attending rounded-lg px-3 py-2 text-sm font-semibold backdrop-blur">
          {t("radar.show.going")}
        </div>
      ) : null}
    </div>
  );
}

function UpcomingFeatureActions({
  item,
  isShow,
  releasePath,
  artistPath,
  onOpenUpcoming,
  onPlaySetlist,
}: {
  item: HomeUpcomingItem;
  isShow: boolean;
  releasePath: string | null;
  artistPath: string;
  onOpenUpcoming: () => void;
  onPlaySetlist?: (item: HomeUpcomingItem) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isShow && onPlaySetlist ? (
        <button
          type="button"
          onClick={() => onPlaySetlist(item)}
          disabled={!item.probable_setlist?.length}
          className="inline-flex items-center gap-2 rounded-full bg-accent-action px-4 py-2 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play size={15} className="fill-current" />
          {t("radar.show.playSetlist")}
        </button>
      ) : null}
      {!isShow && releasePath ? (
        <Link
          to={releasePath}
          className="inline-flex items-center gap-2 rounded-full bg-accent-action px-4 py-2 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90"
        >
          <Play size={15} className="fill-current" />
          {t("home.radar.openAlbum")}
        </Link>
      ) : null}
      <button
        type="button"
        onClick={onOpenUpcoming}
        className="home-upcoming-secondary-action inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-text-primary transition-colors"
      >
        <Calendar size={15} />
        {t("home.radar.viewRadar")}
      </button>
      {isShow ? (
        <Link
          to={artistPath}
          className="home-upcoming-secondary-action inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-text-primary transition-colors"
        >
          {t("common.artist")}
        </Link>
      ) : null}
    </div>
  );
}

export function HomeUpcomingFeature({
  item,
  onOpenUpcoming,
  onPlaySetlist,
}: {
  item: HomeUpcomingItem;
  onOpenUpcoming: () => void;
  onPlaySetlist?: (item: HomeUpcomingItem) => void;
}) {
  const { t, i18n } = useTranslation();
  const presentation = buildUpcomingPresentation(item, i18n.language);

  return (
    <div className="home-upcoming-feature relative min-h-[270px] overflow-hidden rounded-[12px] p-5 sm:p-6">
      <div className="home-upcoming-feature-glow absolute inset-0" />
      {presentation.artistImage ? (
        <CrateImage
          src={presentation.artistImage}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover opacity-40 grayscale"
          onError={(event) => {
            (event.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : null}
      <div className="home-upcoming-feature-overlay absolute inset-0" />

      <div className="relative flex min-h-[222px] flex-col justify-between">
        <div>
          <div className="home-upcoming-badge mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.18em]">
            {presentation.isShow ? (
              <RadioTower size={12} />
            ) : (
              <Disc3 size={12} />
            )}
            {presentation.isShow
              ? t("home.radar.badge.nextShow")
              : t("home.radar.badge.nextRelease")}
          </div>

          <h2 className="max-w-3xl text-3xl font-extrabold leading-none tracking-tight text-text-primary sm:text-4xl">
            {presentation.isShow ? item.artist : item.title}
          </h2>
          <p className="home-upcoming-feature-copy mt-3 max-w-2xl text-sm leading-6">
            {presentation.isShow
              ? `${item.title} · ${item.subtitle}`
              : `${item.artist} · ${item.subtitle}`}
          </p>
        </div>

        <div>
          <UpcomingFeatureMeta
            item={item}
            isShow={presentation.isShow}
            date={presentation.date}
          />
          <UpcomingFeatureActions
            item={item}
            isShow={presentation.isShow}
            releasePath={presentation.releasePath}
            artistPath={presentation.artistPath}
            onOpenUpcoming={onOpenUpcoming}
            onPlaySetlist={onPlaySetlist}
          />
        </div>
      </div>
    </div>
  );
}
