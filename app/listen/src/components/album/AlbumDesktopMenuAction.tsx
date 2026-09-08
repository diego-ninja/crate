import { CRATE_ICON_SIZE, Disc, MoreHorizontal } from "@crate/ui/icons";

import { ContextMenu } from "@/components/actions/ItemActionMenu";
import type {
  AlbumActionData,
  AlbumActionHandlers,
  AlbumActionMenu,
  AlbumActionState,
} from "@/components/album/album-action-types";
import { SECONDARY_ACTION_CLASS } from "@/components/album/album-action-types";

export function AlbumDesktopMenuAction({
  data,
  coverUrl,
  displayName,
  state,
  menu,
  actions,
  t,
}: Pick<AlbumActionData, "data" | "coverUrl" | "displayName"> & {
  state: AlbumActionState;
  menu: AlbumActionMenu;
  actions: AlbumActionHandlers;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  if (!state.isDesktop) return null;

  return (
    <div className="relative shrink-0">
      <button
        ref={menu.controller.anchorRef}
        className={SECONDARY_ACTION_CLASS}
        onClick={actions.onToggleAlbumMenu}
        aria-label={t("common.more")}
      >
        <MoreHorizontal size={CRATE_ICON_SIZE.lg} />
        <span>{t("common.more")}</span>
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
        items={menu.items}
        menuRef={menu.controller.menuRef}
        onClose={actions.onCloseAlbumMenu}
        open={menu.controller.open}
        position={menu.controller.position}
      />
    </div>
  );
}
