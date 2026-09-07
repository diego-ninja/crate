import { createPortal } from "react-dom";
import { MoreHorizontal, CRATE_ICON_SIZE, Disc } from "@crate/ui/icons";

import {
  ContextMenu,
  type ContextMenuEntry,
} from "@/components/actions/ItemActionMenu";
import type { UseContextMenuControllerReturn } from "@crate/ui/domain/actions";
import type { AlbumData } from "@/pages/album-types";

export function AlbumMobileMenuPortal({
  albumMenuController,
  albumMenuItems,
  closeAlbumMenu,
  coverUrl,
  data,
  displayName,
  isDesktop,
  onToggleAlbumMenu,
  t,
}: {
  albumMenuController: UseContextMenuControllerReturn<HTMLButtonElement>;
  albumMenuItems: ContextMenuEntry[];
  closeAlbumMenu: () => void;
  coverUrl: string;
  data: AlbumData;
  displayName: string;
  isDesktop: boolean;
  onToggleAlbumMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  if (isDesktop || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed z-app-header"
      style={{
        top: "calc(var(--listen-safe-top) + 0.625rem)",
        right: "max(1rem, var(--listen-safe-right))",
      }}
    >
      <button
        ref={albumMenuController.anchorRef}
        data-testid="album-mobile-hero-menu"
        className="flex size-11 touch-manipulation items-center justify-center text-text-primary/72 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-hover"
        onClick={onToggleAlbumMenu}
        aria-label={t("common.more")}
      >
        <MoreHorizontal
          data-testid="album-mobile-hero-menu-icon"
          size={CRATE_ICON_SIZE.navMobile}
          className="rotate-90"
        />
      </button>
      <ContextMenu
        header={{
          type: "media",
          title: displayName,
          subtitle: data.artist,
          imageUrl: data.has_cover || coverUrl ? coverUrl : undefined,
          imageAlt: displayName,
          imageShape: "square",
          fallbackIcon: Disc,
        }}
        items={albumMenuItems}
        menuRef={albumMenuController.menuRef}
        onClose={closeAlbumMenu}
        open={albumMenuController.open}
        position={albumMenuController.position}
      />
    </div>,
    document.body,
  );
}
