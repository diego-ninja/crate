import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { CRATE_ICON_SIZE, User } from "@crate/ui/icons";
import type { CrateIcon } from "@crate/ui/icons";
import { ContextMenu } from "@crate/ui/domain/actions/ContextMenu";
import { useItemActionMenu } from "@crate/ui/domain/actions/useItemActionMenu";
import type {
  ContextMenuEntry,
  ContextMenuMediaHeader,
} from "@crate/ui/domain/actions/types";
import { cn } from "@crate/ui/lib/cn";

export interface UserMenuProps {
  userName?: string | null;
  userEmail?: string | null;
  avatarUrl?: string | null;
  avatarInitial?: string | null;
  fallbackIcon?: CrateIcon;
  items: ContextMenuEntry[];
  trigger?: ReactNode;
  triggerClassName?: string;
  menuClassName?: string;
  onAvatarError?: () => void;
}

function initialFromName(name: string | null | undefined): string | null {
  const first = name?.trim().charAt(0);
  return first ? first.toUpperCase() : null;
}

export function UserMenu({
  userName,
  userEmail,
  avatarUrl,
  avatarInitial,
  fallbackIcon = User,
  items,
  trigger,
  triggerClassName,
  menuClassName,
  onAvatarError,
}: UserMenuProps) {
  const actionMenu = useItemActionMenu(items);
  const displayName = userName ?? "Signed in";
  const initial = avatarInitial ?? initialFromName(userName);
  const FallbackIcon = fallbackIcon;

  const header: ContextMenuMediaHeader = {
    type: "media",
    title: displayName,
    subtitle: userEmail ?? undefined,
    imageUrl: avatarUrl,
    imageAlt: displayName,
    imageOnError: onAvatarError,
    imageShape: "circle",
    fallbackIcon,
  };

  const defaultTrigger = (
    <button
      ref={actionMenu.triggerRef}
      type="button"
      onClick={actionMenu.openFromTrigger}
      onContextMenu={actionMenu.handleContextMenu}
      onKeyDown={actionMenu.handleKeyboardTrigger}
      aria-expanded={actionMenu.open}
      aria-haspopup="menu"
      aria-label="User menu"
      className={cn(
        "flex h-12 w-12 touch-manipulation items-center justify-center overflow-hidden rounded-full border border-border-quiet bg-surface-canvas/30 text-sm font-medium text-text-primary/70 shadow-icon-control backdrop-blur-sm transition-colors hover:bg-surface-canvas/50 hover:text-text-primary",
        triggerClassName,
      )}
      {...actionMenu.longPressHandlers}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          onError={onAvatarError}
          className=" size-full object-cover"
        />
      ) : initial ? (
        <span aria-hidden="true">{initial}</span>
      ) : FallbackIcon ? (
        <FallbackIcon size={CRATE_ICON_SIZE.lg} />
      ) : null}
    </button>
  );

  const triggerElement = isValidElement(trigger)
    ? cloneElement(trigger as ReactElement<Record<string, unknown>>, {
        ref: actionMenu.triggerRef,
        onClick: actionMenu.openFromTrigger,
        onContextMenu: actionMenu.handleContextMenu,
        onKeyDown: actionMenu.handleKeyboardTrigger,
        "aria-expanded": actionMenu.open,
        "aria-haspopup": "menu",
        ...actionMenu.longPressHandlers,
      })
    : trigger;

  return (
    <>
      <div className="relative pointer-events-auto">
        {trigger ? triggerElement : defaultTrigger}
      </div>
      <ContextMenu
        header={header}
        items={items}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
        className={menuClassName}
      />
    </>
  );
}
