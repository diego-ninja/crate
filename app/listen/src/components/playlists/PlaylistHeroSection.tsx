import { type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  CRATE_ICON_SIZE,
  ListMusic,
  MoreHorizontal,
  Play,
  Shuffle,
  type CrateIcon,
} from "@crate/ui/icons";
import {
  ContextMenu,
  type ContextMenuEntry,
} from "@/components/actions/ItemActionMenu";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useContextMenuController } from "@crate/ui/domain/actions";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface PlaylistHeroSecondaryAction {
  key: string;
  label: string;
  ariaLabel?: string;
  icon: CrateIcon;
  iconClassName?: string;
  className?: string;
  active?: boolean;
  pulseIcon?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}

interface PlaylistHeroSectionProps {
  title: string;
  subtitle?: string;
  description?: string;
  metaItems: Array<string | null | undefined | false>;
  badges?: ReactNode;
  artwork: (className: string) => ReactNode;
  menuImageUrl?: string | null;
  menuImageAlt?: string;
  onPlay: () => void;
  onShuffle: () => void;
  playDisabled?: boolean;
  shuffleDisabled?: boolean;
  secondaryActions: PlaylistHeroSecondaryAction[];
  menuItems: ContextMenuEntry[];
}

const SECONDARY_ACTION_CLASS =
  "flex min-h-14 min-w-[56px] shrink-0 touch-manipulation flex-col items-center justify-center gap-1 px-1.5 py-1 text-xs font-medium text-text-primary/62 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-hover disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:drop-shadow-none";

export function PlaylistHeroSection({
  title,
  subtitle,
  description,
  metaItems,
  badges,
  artwork,
  menuImageUrl,
  menuImageAlt,
  onPlay,
  onShuffle,
  playDisabled,
  shuffleDisabled,
  secondaryActions,
  menuItems,
}: PlaylistHeroSectionProps) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const menuController = useContextMenuController<HTMLButtonElement>({
    placement: "bottom-end",
  });
  const visibleMetaItems = metaItems.filter(Boolean);
  const menuImageSrc = resolveMaybeApiAssetUrl(menuImageUrl);

  function handleToggleMenu(event: MouseEvent<HTMLButtonElement>) {
    menuController.openFromTrigger(event);
  }

  const menuHeader = {
    type: "media" as const,
    title,
    subtitle,
    detail: visibleMetaItems[0] || undefined,
    imageUrl: menuImageSrc,
    imageAlt: menuImageAlt || title,
    imageShape: "square" as const,
    fallbackIcon: ListMusic,
  };

  const mobileMenuTrigger =
    !isDesktop && typeof document !== "undefined" ? (
      <div
        className="fixed z-app-header"
        style={{
          top: "calc(var(--listen-safe-top) + 0.625rem)",
          right: "max(1rem, var(--listen-safe-right))",
        }}
      >
        <button
          ref={menuController.anchorRef}
          data-testid="playlist-mobile-hero-menu"
          className="flex size-11 touch-manipulation items-center justify-center text-text-primary/72 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-hover"
          onClick={handleToggleMenu}
          aria-label={t("common.more")}
        >
          <MoreHorizontal
            data-testid="playlist-mobile-hero-menu-icon"
            size={CRATE_ICON_SIZE.navMobile}
            className="rotate-90"
          />
        </button>
        <ContextMenu
          header={menuHeader}
          items={menuItems}
          menuRef={menuController.menuRef}
          onClose={menuController.close}
          open={menuController.open}
          position={menuController.position}
        />
      </div>
    ) : null;

  return (
    <>
      {mobileMenuTrigger
        ? createPortal(mobileMenuTrigger, document.body)
        : null}
      <div className="relative h-[420px] overflow-hidden sm:h-[420px] lg:h-[460px]">
        <div className="absolute inset-0 scale-[1.02] opacity-[0.82] sm:grayscale sm:brightness-[0.5] sm:opacity-[0.45]">
          {artwork("h-full w-full rounded-none")}
        </div>
        <div className="absolute inset-0 bg-surface-canvas/12 sm:bg-surface-canvas/36" />
        <div
          className="absolute inset-0 sm:hidden"
          data-testid="playlist-hero-mobile-gradient"
          style={{ background: "var(--hero-artwork-gradient-mobile)" }}
        />
        <div
          className="absolute inset-0 hidden sm:block"
          data-testid="playlist-hero-desktop-gradient"
          style={{
            background: "var(--hero-artwork-gradient-desktop-strong)",
          }}
        />

        <div className="relative mx-auto flex size-full max-w-[1480px] items-end px-4 pb-6 pt-[var(--listen-mobile-page-top)] sm:px-6 sm:pt-0">
          <div className="flex w-full flex-col gap-5 sm:flex-row sm:items-end">
            <div className="hidden w-[200px] shrink-0 sm:block lg:w-[240px]">
              {artwork(
                "aspect-square rounded-xl bg-text-primary/5 shadow-2xl ring-1 ring-text-primary/10",
              )}
            </div>

            <div className="flex min-w-0 max-w-3xl flex-col justify-end pb-1 text-left">
              {badges ? (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {badges}
                </div>
              ) : null}
              <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
                {title}
              </h1>
              {description ? (
                <p className="mt-3 line-clamp-3 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-text-primary/70">
                  {description}
                </p>
              ) : null}
              {visibleMetaItems.length ? (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                  {visibleMetaItems.map((item) => (
                    <span key={String(item)}>{item}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="p-4  sm:px-6">
        <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 md:flex-row md:items-center md:justify-between md:gap-6">
          <div
            role="group"
            aria-label={t("playlist.actions.primaryGroup")}
            className="grid grid-cols-2 gap-3 md:flex md:shrink-0 md:items-center md:gap-3"
          >
            <button
              className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-accent-action px-5 text-sm font-semibold text-accent-action-foreground shadow-action-solid transition-[background-color,box-shadow] hover:bg-accent-action/90 hover:shadow-action-solid-hover disabled:cursor-not-allowed disabled:opacity-45 md:px-7 md:text-[0.9375rem]"
              onClick={onPlay}
              disabled={playDisabled}
              aria-label={t("player.play")}
            >
              <Play size={17} fill="currentColor" />
              <span>{t("player.play")}</span>
            </button>
            <button
              className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-text-primary/[0.08] px-5 text-sm font-semibold text-text-primary shadow-control-inset transition-[background-color,color,filter,transform] hover:-translate-y-px hover:bg-text-primary/[0.12] hover:text-accent-action hover:drop-shadow-accent-action disabled:cursor-not-allowed disabled:opacity-45 md:w-auto md:px-7"
              onClick={onShuffle}
              disabled={shuffleDisabled}
              aria-label={t("player.shuffle")}
            >
              <Shuffle size={17} />
              <span>{t("player.shuffle")}</span>
            </button>
          </div>

          <div
            role="group"
            aria-label={t("playlist.actions.secondaryGroup")}
            className="grid grid-cols-5 items-start gap-2 md:ml-auto md:flex md:shrink-0 md:items-center md:gap-4"
          >
            {secondaryActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.key}
                  className={cn(
                    SECONDARY_ACTION_CLASS,
                    action.active
                      ? "text-accent-action drop-shadow-accent-action"
                      : "text-text-primary/62",
                    action.className,
                  )}
                  onClick={action.onClick}
                  disabled={action.disabled}
                  aria-label={action.ariaLabel || action.label}
                  title={action.title}
                >
                  <Icon
                    size={CRATE_ICON_SIZE.lg}
                    className={cn(
                      action.pulseIcon && "animate-crate-icon-active-pulse",
                      action.iconClassName,
                    )}
                  />
                  <span>{action.label}</span>
                </button>
              );
            })}
            {isDesktop ? (
              <div className="relative shrink-0">
                <button
                  ref={menuController.anchorRef}
                  className={SECONDARY_ACTION_CLASS}
                  onClick={handleToggleMenu}
                  aria-label={t("common.more")}
                >
                  <MoreHorizontal size={CRATE_ICON_SIZE.lg} />
                  <span>{t("common.more")}</span>
                </button>
                <ContextMenu
                  header={menuHeader}
                  items={menuItems}
                  menuRef={menuController.menuRef}
                  onClose={menuController.close}
                  open={menuController.open}
                  position={menuController.position}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
