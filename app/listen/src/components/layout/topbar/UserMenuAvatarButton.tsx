import { CRATE_ICON_SIZE, User } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import type { useItemActionMenu } from "@/components/actions/ItemActionMenu";

type UserMenuActionMenu = ReturnType<typeof useItemActionMenu>;

export function UserMenuAvatarButton({
  actionMenu,
  avatarUrl,
  handleAvatarError,
  initial,
  userMenuLabel,
}: {
  actionMenu: UserMenuActionMenu;
  avatarUrl: string | null;
  handleAvatarError: () => void;
  initial: string | null;
  userMenuLabel: string;
}) {
  return (
    <div className="pointer-events-auto relative">
      <button
        type="button"
        ref={actionMenu.triggerRef}
        onClick={actionMenu.openFromTrigger}
        onContextMenu={actionMenu.handleContextMenu}
        onKeyDown={actionMenu.handleKeyboardTrigger}
        aria-expanded={actionMenu.open}
        aria-haspopup="menu"
        aria-label={userMenuLabel}
        className="flex size-12 touch-manipulation items-center justify-center overflow-hidden rounded-full border border-border-quiet bg-surface-canvas/30 text-sm font-medium text-text-primary/70 shadow-icon-control backdrop-blur-sm transition-colors hover:bg-surface-canvas/50 hover:text-text-primary"
        {...actionMenu.longPressHandlers}
      >
        {avatarUrl ? (
          <CrateImage
            src={avatarUrl}
            alt=""
            onError={handleAvatarError}
            className=" size-full object-cover"
          />
        ) : (
          initial || <User size={CRATE_ICON_SIZE.lg} />
        )}
      </button>
    </div>
  );
}
