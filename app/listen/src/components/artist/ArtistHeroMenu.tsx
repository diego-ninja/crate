import { type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  CRATE_ICON_SIZE,
  Heart,
  HeartBold,
  ListMusic,
  MoreHorizontal,
  Play,
  Radio,
  Share2,
  Shuffle,
  Users,
} from "@crate/ui/icons";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useContextMenuController } from "@crate/ui/domain/actions";

import {
  ContextMenu,
  type ContextMenuEntry,
} from "@/components/actions/ItemActionMenu";
import type { ArtistData } from "@/components/artist/artist-model";

interface ArtistHeroMenuProps {
  artist: ArtistData;
  photoUrl: string;
  following: boolean;
  hasSetlist?: boolean;
  onPlay: () => void;
  onShuffle: () => void;
  onArtistRadio: () => void;
  onPlaySetlist?: () => void;
  onToggleFollow: () => void;
  onShare: () => void;
}

const SECONDARY_ACTION_CLASS =
  "flex min-h-14 min-w-[56px] shrink-0 touch-manipulation flex-col items-center justify-center gap-1 px-1.5 py-1 text-xs font-medium text-text-primary/62 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-hover disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:drop-shadow-none";

function buildArtistHeroMenuItems({
  following,
  hasSetlist,
  onArtistRadio,
  onPlay,
  onPlaySetlist,
  onShuffle,
  onShare,
  onToggleFollow,
  t,
}: Omit<ArtistHeroMenuProps, "artist" | "photoUrl"> & {
  t: ReturnType<typeof useTranslation>["t"];
}): ContextMenuEntry[] {
  return [
    {
      key: "play",
      label: t("artist.actions.playTopTracks"),
      icon: Play,
      onSelect: onPlay,
    },
    {
      key: "shuffle",
      label: t("player.shuffle"),
      icon: Shuffle,
      onSelect: onShuffle,
    },
    {
      key: "radio",
      label: t("artist.actions.radio"),
      icon: Radio,
      onSelect: onArtistRadio,
    },
    ...(onPlaySetlist
      ? [
          {
            key: "setlist",
            label: t("artist.actions.playSetlist"),
            icon: ListMusic,
            disabled: !hasSetlist,
            onSelect: onPlaySetlist,
          },
        ]
      : []),
    {
      key: "follow",
      label: following ? t("common.unfollow") : t("common.follow"),
      icon: following ? HeartBold : Heart,
      active: following,
      onSelect: onToggleFollow,
    },
    {
      key: "share",
      label: t("common.share"),
      icon: Share2,
      onSelect: onShare,
    },
  ];
}

export function ArtistHeroMenu({
  artist,
  photoUrl,
  following,
  hasSetlist,
  onPlay,
  onShuffle,
  onArtistRadio,
  onPlaySetlist,
  onToggleFollow,
  onShare,
}: ArtistHeroMenuProps) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const menuController = useContextMenuController<HTMLButtonElement>({
    placement: "bottom-end",
  });
  const menuItems = buildArtistHeroMenuItems({
    following,
    hasSetlist,
    onArtistRadio,
    onPlay,
    onPlaySetlist,
    onShuffle,
    onShare,
    onToggleFollow,
    t,
  });

  function handleToggleMenu(event: MouseEvent<HTMLButtonElement>) {
    menuController.openFromTrigger(event);
  }

  const menu = (
    <ContextMenu
      header={{
        type: "media",
        title: artist.name,
        subtitle: `${t("common.trackCountLabel", {
          count: artist.total_tracks,
        })} · ${t("common.albumCountLabel", {
          count: artist.albums.length,
        })}`,
        imageUrl: photoUrl,
        imageAlt: artist.name,
        imageShape: "circle",
        fallbackIcon: Users,
      }}
      items={menuItems}
      menuRef={menuController.menuRef}
      onClose={menuController.close}
      open={menuController.open}
      position={menuController.position}
    />
  );

  if (!isDesktop) {
    if (typeof document === "undefined") return null;

    return createPortal(
      <div
        className="fixed z-app-header"
        style={{
          top: "calc(var(--listen-safe-top) + 0.625rem)",
          right: "max(1rem, var(--listen-safe-right))",
        }}
      >
        <button
          ref={menuController.anchorRef}
          data-testid="artist-mobile-hero-menu"
          className="flex size-11 touch-manipulation items-center justify-center text-text-primary/72 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-hover"
          onClick={handleToggleMenu}
          aria-label={t("common.more")}
        >
          <MoreHorizontal
            data-testid="artist-mobile-hero-menu-icon"
            size={CRATE_ICON_SIZE.navMobile}
            className="rotate-90"
          />
        </button>
        {menu}
      </div>,
      document.body,
    );
  }

  return (
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
      {menu}
    </div>
  );
}
