import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { Check, MoreHorizontal, type LucideIcon } from "lucide-react";
import { createPortal } from "react-dom";

import { useIsDesktop } from "@/hooks/use-breakpoint";
import { useDismissibleLayer } from "@/hooks/use-dismissible-layer";
import { AppMenuButton, AppPopover, AppPopoverDivider } from "@/components/ui/AppPopover";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { AppModal, ModalBody } from "@/components/ui/AppModal";
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
            <div key={entry.key} className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-white/35">
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
      className="fixed z-[1300] w-60 origin-top-left p-1 animate-pop-in"
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
