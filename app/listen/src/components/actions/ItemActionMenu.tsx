import {
  type KeyboardEvent as ReactKeyboardEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { Check, MoreHorizontal, type LucideIcon } from "lucide-react";
import { createPortal } from "react-dom";

import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { AppMenuButton, AppPopover, AppPopoverDivider } from "@crate/ui/primitives/AppPopover";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { AppModal, ModalBody } from "@crate/ui/primitives/AppModal";
import { cn } from "@/lib/utils";

export type ItemActionMenuEntry =
  | {
      type?: "action";
      key: string;
      label: string;
      icon?: LucideIcon;
      active?: boolean;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void | Promise<void>;
    }
  | {
      type: "divider";
      key: string;
    }
  | {
      type: "label";
      key: string;
      label: string;
    };

interface ItemActionMenuProps {
  actions: ItemActionMenuEntry[];
  open: boolean;
  position: { x: number; y: number } | null;
  menuRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

interface UseItemActionMenuOptions {
  disabled?: boolean;
}

export function useItemActionMenu(actions: ItemActionMenuEntry[], options: UseItemActionMenuOptions = {}) {
  const isDesktop = useIsDesktop();
  const { disabled = false } = options;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [rawPosition, setRawPosition] = useState<{ x: number; y: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [measured, setMeasured] = useState(false);
  const hasActions = useMemo(
    () => actions.some((entry) => entry.type == null || entry.type === "action"),
    [actions],
  );

  const close = () => {
    setOpen(false);
    setRawPosition(null);
    setPosition(null);
    setMeasured(false);
  };

  const openAtPoint = (x: number, y: number) => {
    if (!hasActions || disabled) return;
    setRawPosition({ x, y });
    setPosition({ x, y });
    setMeasured(false);
    setOpen(true);
  };

  const openFromTrigger = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (open) {
      close();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    openAtPoint(rect.right - 8, rect.bottom + 8);
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    if (!hasActions || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    openAtPoint(event.clientX + 4, event.clientY + 4);
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleLongPressPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (isDesktop || !hasActions || disabled) return;
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

  const handleKeyboardTrigger = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!hasActions || disabled) return;
    if (!(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    openAtPoint(rect.right - 8, rect.bottom + 8);
  };

  useDismissibleLayer({
    active: open,
    refs: [menuRef, triggerRef],
    onDismiss: close,
  });

  // Measure + clamp into viewport before the browser paints to avoid flash.
  useLayoutEffect(() => {
    if (!open || !isDesktop || !rawPosition || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const padding = 12;
    const maxX = Math.max(padding, window.innerWidth - rect.width - padding);
    const maxY = Math.max(padding, window.innerHeight - rect.height - padding);
    setPosition({
      x: Math.min(rawPosition.x, maxX),
      y: Math.min(rawPosition.y, maxY),
    });
    setMeasured(true);
  }, [isDesktop, open, rawPosition]);

  return {
    hasActions,
    isDesktop,
    open,
    position,
    measured,
    triggerRef,
    menuRef,
    close,
    openFromTrigger,
    handleContextMenu,
    handleKeyboardTrigger,
    longPressHandlers: {
      onPointerDown: handleLongPressPointerDown,
      onPointerUp: handleLongPressPointerUp,
      onPointerCancel: handleLongPressPointerUp,
      onPointerLeave: handleLongPressPointerUp,
      onClickCapture: handleLongPressClickCapture,
    },
  };
}

export function ItemActionMenu({
  actions,
  open,
  position,
  menuRef,
  onClose,
}: ItemActionMenuProps) {
  const isDesktop = useIsDesktop();
  const actionEntries = actions.filter((entry) => entry.type == null || entry.type === "action");
  if (!actionEntries.length) return null;

  const handleSelect = (entry: ItemActionMenuEntry) => {
    if (entry.type === "divider" || entry.type === "label" || entry.disabled) return;
    // Invoke first so the caller can read fresh state, then close so the menu
    // doesn't linger while the action kicks off.
    const result = entry.onSelect();
    onClose();
    if (result && typeof (result as Promise<void>).then === "function") {
      void (result as Promise<void>).catch(() => {
        /* errors are surfaced by the action itself via toast */
      });
    }
  };

  const content = (
    <>
      {actions.map((entry) => {
        if (entry.type === "divider") {
          return <AppPopoverDivider key={entry.key} />;
        }

        if (entry.type === "label") {
          return (
            <div key={entry.key} className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">
              {entry.label}
            </div>
          );
        }

        const Icon = entry.icon;

        return (
          <AppMenuButton
            key={entry.key}
            danger={entry.danger}
            disabled={entry.disabled}
            onClick={() => handleSelect(entry)}
            className={cn(entry.active ? "text-primary" : undefined, entry.disabled ? "opacity-50" : undefined)}
          >
            <span className="flex min-w-0 flex-1 items-center gap-3">
              {Icon ? <Icon size={15} className="shrink-0" /> : <span className="w-[15px] shrink-0" />}
              <span className="truncate">{entry.label}</span>
            </span>
            {entry.active ? <Check size={14} className="shrink-0 text-primary" /> : null}
          </AppMenuButton>
        );
      })}
    </>
  );

  if (!open) return null;

  if (!isDesktop) {
    return createPortal((
      <AppModal open={open} onClose={onClose} maxWidthClassName="sm:max-w-sm">
        <ModalBody className="px-3 pb-4 pt-2">
          <div className="space-y-1">{content}</div>
        </ModalBody>
      </AppModal>
    ), document.body);
  }

  return createPortal((
    <AppPopover
      ref={menuRef}
      className="fixed z-app-popover w-60 origin-top-left p-1 animate-pop-in"
      style={{
        left: position?.x ?? 12,
        top: position?.y ?? 12,
      }}
    >
      {content}
    </AppPopover>
  ), document.body);
}

interface ItemActionMenuButtonProps {
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
  className?: string;
  title?: string;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  /** When false, the trigger disappears entirely instead of rendering a dead button. */
  hasActions?: boolean;
}

export function ItemActionMenuButton({
  onClick,
  buttonRef,
  className,
  title = "More actions",
  onContextMenu,
  hasActions = true,
}: ItemActionMenuButtonProps) {
  if (!hasActions) return null;
  return (
    <ActionIconButton
      ref={buttonRef}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-label={title}
      title={title}
      className={className}
    >
      <MoreHorizontal size={15} />
    </ActionIconButton>
  );
}
