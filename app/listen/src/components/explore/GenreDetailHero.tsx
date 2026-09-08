import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  Calendar,
  CRATE_ICON_SIZE,
  Loader2,
  MoreHorizontal,
  Play,
  Radio,
  Share2,
} from "@crate/ui/icons";

import {
  ItemActionMenu,
  type ItemActionMenuEntry,
  type UseItemActionMenuReturn,
} from "@/components/actions/ItemActionMenu";
import { CrateImage } from "@/components/artwork/CrateImage";
import type { UpcomingItem } from "@/components/upcoming/UpcomingRows";

import type { GenreDetail } from "./explore-model";

const GENRE_SECONDARY_ACTION_CLASS =
  "flex min-h-14 min-w-[56px] shrink-0 touch-manipulation flex-col items-center justify-center gap-1 px-1.5 py-1 text-xs font-medium text-text-primary/62 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-hover disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:drop-shadow-none";

export interface GenreHeroProps {
  artistCount: number;
  albumCount: number;
  data: GenreDetail;
  description: string;
  heroCoverUrl: string | null;
  onCoverError: () => void;
  trackCount: number;
}

export function GenreHero({
  artistCount,
  albumCount,
  data,
  description,
  heroCoverUrl,
  onCoverError,
  trackCount,
}: GenreHeroProps) {
  const { t } = useTranslation();
  return (
    <section className="relative -mx-4 -mt-4 h-[420px] overflow-hidden sm:-mx-6 sm:-mt-6 sm:h-[400px] lg:-mt-8">
      {heroCoverUrl ? (
        <CrateImage
          key={heroCoverUrl}
          src={heroCoverUrl}
          alt={t("genre.coverAlt", { name: data.name })}
          decoding="async"
          fetchPriority="high"
          className="absolute inset-0 size-full scale-[1.02] object-cover brightness-[0.66] contrast-110 opacity-[0.68] saturate-125"
          onError={onCoverError}
        />
      ) : null}
      <div className="explore-genre-hero-scrim absolute inset-0" />
      <div className="explore-genre-hero-gradient absolute inset-0" />
      <div className="relative mx-auto flex size-full max-w-[1480px] flex-col px-4 pb-6 pt-[var(--listen-mobile-page-top)] sm:px-6 sm:pt-6">
        <div className="mt-auto max-w-3xl pb-1">
          <h1 className="text-4xl font-black leading-none tracking-tight text-text-primary sm:text-6xl">
            {data.name}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-text-primary/68 sm:text-base sm:leading-7">
            {description}
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-text-primary/56">
            <span>{t("common.artistCountLabel", { count: artistCount })}</span>
            <span className="text-text-primary/20">/</span>
            <span>{t("common.albumCountLabel", { count: albumCount })}</span>
            <span className="text-text-primary/20">/</span>
            <span>{t("common.trackCountLabel", { count: trackCount })}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export interface GenreActionBarProps {
  albumCount: number;
  artistCount: number;
  data: GenreDetail;
  genreMenu: UseItemActionMenuReturn;
  genreMenuActions: ItemActionMenuEntry[];
  heroCoverUrl: string | null;
  isDesktop: boolean;
  nextShow: UpcomingItem | null;
  onOpenGenreRadar: (show?: UpcomingItem | null) => void;
  onPlayGenreRadio: () => void;
  onShareGenre: () => void;
  startingRadio: boolean;
}

export function GenreActionBar({
  albumCount,
  artistCount,
  data,
  genreMenu,
  genreMenuActions,
  heroCoverUrl,
  isDesktop,
  nextShow,
  onOpenGenreRadar,
  onPlayGenreRadio,
  onShareGenre,
  startingRadio,
}: GenreActionBarProps) {
  const { t } = useTranslation();
  const menuHeader = {
    type: "media" as const,
    title: data.name,
    subtitle: t("genre.kind"),
    detail: t("genre.menu.detail", {
      artists: artistCount,
      albums: albumCount,
    }),
    imageUrl: heroCoverUrl,
    imageAlt: data.name,
    imageShape: "square" as const,
    fallbackIcon: Radio,
  };

  const mobileMenu =
    !isDesktop && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed z-app-header"
            style={{
              top: "calc(var(--listen-safe-top) + 0.625rem)",
              right: "max(1rem, var(--listen-safe-right))",
            }}
          >
            <button
              ref={genreMenu.triggerRef}
              type="button"
              data-testid="genre-mobile-hero-menu"
              className="flex size-11 touch-manipulation items-center justify-center text-text-primary/72 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-hover"
              onClick={genreMenu.openFromTrigger}
              onContextMenu={genreMenu.handleContextMenu}
              aria-label={t("common.more")}
              title={t("common.more")}
            >
              <MoreHorizontal
                data-testid="genre-mobile-hero-menu-icon"
                size={CRATE_ICON_SIZE.navMobile}
                className="rotate-90"
              />
            </button>
            <ItemActionMenu
              actions={genreMenuActions}
              header={menuHeader}
              open={genreMenu.open}
              position={genreMenu.position}
              menuRef={genreMenu.menuRef}
              onClose={genreMenu.close}
            />
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {mobileMenu}
      <div className="px-0 py-1 sm:px-0">
        <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 md:flex-row md:items-center md:justify-between md:gap-6">
          <div
            role="group"
            aria-label={t("genre.actions.primaryGroup")}
            className="grid grid-cols-2 gap-3 md:flex md:shrink-0 md:items-center md:gap-3"
          >
            <button
              type="button"
              onClick={onPlayGenreRadio}
              disabled={startingRadio}
              aria-label={t("genre.actions.playRadio")}
              className="explore-genre-primary-action flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-accent-action px-5 text-sm font-semibold text-accent-action-foreground shadow-accent-action-glow transition-[background-color,box-shadow] hover:bg-accent-action/90 hover:shadow-accent-action-strong disabled:cursor-wait disabled:opacity-70 md:px-7 md:text-[0.9375rem]"
            >
              {startingRadio ? (
                <Loader2 size={17} className="animate-spin" />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
              <span>{t("player.play")}</span>
            </button>
            {nextShow ? (
              <button
                type="button"
                onClick={() => onOpenGenreRadar(nextShow)}
                aria-label={t("genre.actions.openNextGenreShow")}
                className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-text-primary/[0.08] px-5 text-sm font-semibold text-text-primary shadow-[inset_0_0_0_1px_var(--border-quiet)] transition-[background-color,color,filter,transform] hover:-translate-y-px hover:bg-text-primary/[0.12] hover:text-accent-action hover:drop-shadow-accent-action md:w-auto md:px-7"
              >
                <Calendar size={17} />
                <span>{t("genre.actions.nextShow")}</span>
              </button>
            ) : null}
          </div>

          {isDesktop ? (
            <div
              role="group"
              aria-label={t("genre.actions.secondaryGroup")}
              className="ml-auto flex shrink-0 items-center gap-4"
            >
              <button
                type="button"
                className={GENRE_SECONDARY_ACTION_CLASS}
                onClick={onShareGenre}
                aria-label={t("genre.actions.share")}
              >
                <Share2 size={CRATE_ICON_SIZE.lg} />
                <span>{t("common.share")}</span>
              </button>
              <div className="relative shrink-0">
                <button
                  ref={genreMenu.triggerRef}
                  type="button"
                  className={GENRE_SECONDARY_ACTION_CLASS}
                  onClick={genreMenu.openFromTrigger}
                  onContextMenu={genreMenu.handleContextMenu}
                  aria-label={t("common.more")}
                >
                  <MoreHorizontal size={CRATE_ICON_SIZE.lg} />
                  <span>{t("common.more")}</span>
                </button>
                <ItemActionMenu
                  actions={genreMenuActions}
                  header={menuHeader}
                  open={genreMenu.open}
                  position={genreMenu.position}
                  menuRef={genreMenu.menuRef}
                  onClose={genreMenu.close}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
