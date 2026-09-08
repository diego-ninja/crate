import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import {
  useContextMenuController,
  type ContextMenuPlacement,
} from "./useContextMenuController";
import type {
  ContextMenuEntry,
  ContextMenuHeader,
  ContextMenuMediaImageRenderer,
} from "./types";

export type ItemActionMenuEntry = ContextMenuEntry;

export interface UseItemActionMenuOptions {
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: ContextMenuPlacement;
}

export interface UseItemActionMenuReturn {
  hasActions: boolean;
  isDesktop: boolean;
  open: boolean;
  position: { x: number; y: number } | null;
  measured: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  close: () => void;
  openFromTrigger: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  handleContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  handleKeyboardTrigger: (event: ReactKeyboardEvent<HTMLElement>) => void;
  shouldUseDesktopMenu: boolean;
  longPressHandlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onPointerLeave: () => void;
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
  };
}

export function useItemActionMenu(
  actions: ItemActionMenuEntry[],
  options: UseItemActionMenuOptions = {},
): UseItemActionMenuReturn {
  const isDesktop = useIsDesktop();
  const { disabled = false, onOpenChange, placement } = options;
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const hasActions = useMemo(
    () =>
      actions.some(
        (entry) =>
          entry.type == null ||
          entry.type === "action" ||
          entry.type === "disclosure",
      ),
    [actions],
  );
  const controller = useContextMenuController<HTMLButtonElement>({
    disabled: disabled || !hasActions,
    placement,
  });
  const { open, position, measured, close, openAtPoint } = controller;

  useEffect(() => {
    // Consumers need the controller's open state to coordinate their trigger.
    // react-doctor-disable-next-line no-pass-data-to-parent
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  const clearLongPress = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleLongPressPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (controller.shouldUseDesktopMenu || !hasActions || disabled) return;
    if (event.pointerType === "mouse") return;
    longPressTriggeredRef.current = false;
    clearLongPress();
    const target = event.currentTarget;
    longPressTimerRef.current = window.setTimeout(() => {
      const rect = target.getBoundingClientRect();
      longPressTriggeredRef.current = true;
      openAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }, 420);
  };

  const handleLongPressPointerUp = () => {
    clearLongPress();
  };

  const handleLongPressClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (!longPressTriggeredRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    longPressTriggeredRef.current = false;
  };

  return {
    hasActions,
    isDesktop,
    open,
    position,
    measured,
    triggerRef: controller.anchorRef,
    menuRef: controller.menuRef,
    close,
    openFromTrigger: controller.openFromTrigger,
    handleContextMenu: controller.handleContextMenu,
    handleKeyboardTrigger: controller.handleKeyboardTrigger,
    shouldUseDesktopMenu: controller.shouldUseDesktopMenu,
    longPressHandlers: {
      onPointerDown: handleLongPressPointerDown,
      onPointerUp: handleLongPressPointerUp,
      onPointerCancel: handleLongPressPointerUp,
      onPointerLeave: handleLongPressPointerUp,
      onClickCapture: handleLongPressClickCapture,
    },
  };
}

export interface ItemActionMenuProps {
  actions: ItemActionMenuEntry[];
  header?: ContextMenuHeader;
  open: boolean;
  position: { x: number; y: number } | null;
  menuRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  renderMediaImage?: ContextMenuMediaImageRenderer;
}

export interface ItemActionMenuButtonProps {
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
  className?: string;
  title?: string;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  hasActions?: boolean;
}
