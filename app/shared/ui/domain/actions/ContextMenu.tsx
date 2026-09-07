import {
  type CSSProperties,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CRATE_ICON_SIZE,
} from "@crate/ui/icons";
import {
  AppMenuButton,
  AppPopoverDivider,
} from "@crate/ui/primitives/AppPopover";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useHoverCapability } from "@crate/ui/lib/use-hover-capability";
import { cn } from "@crate/ui/lib/cn";

import { MobileActionSheet } from "./MobileActionSheet";
import type {
  ContextMenuEntry,
  ContextMenuHeader,
  ContextMenuMediaHeader,
  ContextMenuMediaImageProps,
  ContextMenuMediaImageRenderer,
  ContextMenuProps,
  DesktopMenuEnvironment,
} from "./types";

export type {
  ContextMenuEntry,
  ContextMenuHeader,
  ContextMenuMediaHeader,
  ContextMenuMediaImageProps,
  ContextMenuMediaImageRenderer,
  ContextMenuProps,
};

export function detectTouchDominant(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) {
    return true;
  }
  if (typeof window.matchMedia === "function") {
    if (window.matchMedia("(pointer: coarse)").matches) return true;
    if (window.matchMedia("(hover: none)").matches) return true;
  }
  return false;
}

function detectCapacitor(): boolean {
  if (typeof window === "undefined") return false;
  const capacitor = (window as unknown as Record<string, unknown>).Capacitor as
    | { isNativePlatform?: () => boolean }
    | undefined;
  if (typeof capacitor?.isNativePlatform === "function") {
    return capacitor.isNativePlatform();
  }
  if (typeof navigator !== "undefined") {
    return /Capacitor\/\d/.test(navigator.userAgent);
  }
  return false;
}

export function shouldRenderDesktopContextMenu(
  environment: DesktopMenuEnvironment,
): boolean {
  const {
    isDesktop,
    canHover,
    isTouchDominant,
    isCapacitor = detectCapacitor(),
    forceMobileSheet = false,
  } = environment;

  if (!isDesktop || !canHover) return false;
  if (forceMobileSheet) return false;
  if (isCapacitor) return false;
  if (typeof window === "undefined") return false;
  if (isTouchDominant) return false;
  return true;
}

function hasSelectableEntries(items: ContextMenuEntry[]): boolean {
  return items.some((item) => {
    if (item.type === "divider" || item.type === "label") return false;
    return true;
  });
}

function isStructuredHeader(
  header: ContextMenuHeader | ReactNode | undefined,
): header is ContextMenuMediaHeader {
  return (
    typeof header === "object" &&
    header !== null &&
    "type" in header &&
    header.type === "media"
  );
}

function ContextMenuMediaHeaderView({
  header,
  renderMediaImage,
}: {
  header: ContextMenuMediaHeader;
  renderMediaImage?: ContextMenuMediaImageRenderer;
}) {
  const FallbackIcon = header.fallbackIcon;
  const [imageFailed, setImageFailed] = useState(false);
  const hasImage = Boolean(header.imageUrl);
  const showImage = hasImage && !imageFailed;
  const imageShape =
    header.imageShape === "circle" ? "rounded-full" : "rounded-lg";

  useEffect(() => {
    setImageFailed(false);
  }, [header.imageUrl]);

  return (
    <div className="flex items-center gap-3 border-b border-border-quiet p-4 ">
      <div
        className={cn(
          "relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden bg-text-primary/5",
          imageShape,
        )}
      >
        {hasImage && renderMediaImage ? (
          renderMediaImage({
            src: header.imageUrl || "",
            alt: header.imageAlt ?? header.title,
            width: 48,
            height: 48,
            loading: "lazy",
            onLoad: () => {
              setImageFailed(false);
            },
            onError: () => {
              setImageFailed(true);
              header.imageOnError?.();
            },
            className: cn(
              "h-full w-full object-cover",
              imageFailed ? "opacity-0" : undefined,
            ),
          })
        ) : showImage ? (
          <img
            src={header.imageUrl || ""}
            alt={header.imageAlt ?? header.title}
            width={48}
            height={48}
            loading="lazy"
            onError={() => {
              setImageFailed(true);
              header.imageOnError?.();
            }}
            className=" size-full object-cover"
          />
        ) : FallbackIcon ? (
          <FallbackIcon
            size={CRATE_ICON_SIZE.xl}
            className="text-text-primary/35"
          />
        ) : null}
        {hasImage && renderMediaImage && imageFailed && FallbackIcon ? (
          <FallbackIcon
            size={CRATE_ICON_SIZE.xl}
            className="absolute text-text-primary/35"
          />
        ) : null}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-text-primary">
          {header.title}
        </div>
        {header.subtitle ? (
          <div className="truncate text-xs text-text-muted">
            {header.subtitle}
          </div>
        ) : null}
        {header.detail ? (
          <div className="truncate text-xs text-text-primary/55">
            {header.detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ContextMenuHeaderView({
  header,
  renderMediaImage,
}: {
  header?: ContextMenuHeader | ReactNode;
  renderMediaImage?: ContextMenuMediaImageRenderer;
}) {
  if (!header) return null;
  if (isStructuredHeader(header)) {
    return (
      <ContextMenuMediaHeaderView
        header={header}
        renderMediaImage={renderMediaImage}
      />
    );
  }
  return <>{header}</>;
}

function ContextMenuItems({
  items,
  onClose,
}: {
  items: ContextMenuEntry[];
  onClose: () => void;
}) {
  const handleSelect = (
    entry: Extract<ContextMenuEntry, { type?: "action" }>,
  ) => {
    if (entry.disabled) return;
    const result = entry.onSelect();
    onClose();
    if (result && typeof (result as Promise<void>).then === "function") {
      void (result as Promise<void>).catch(() => {
        /* callers surface action failures via toast */
      });
    }
  };

  return (
    <>
      {items.map((entry) => {
        if (entry.type === "divider") {
          return <AppPopoverDivider key={entry.key} className="mx-1" />;
        }

        if (entry.type === "label") {
          return (
            <div
              key={entry.key}
              className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-text-primary/40"
            >
              {entry.label}
            </div>
          );
        }

        const Icon = entry.icon;

        if (entry.type === "disclosure") {
          const Indicator = entry.expanded ? ChevronDown : ChevronRight;

          return (
            <div key={entry.key}>
              <AppMenuButton
                role="menuitem"
                aria-expanded={entry.expanded}
                disabled={entry.disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!entry.disabled) entry.onToggle();
                }}
                className={cn(entry.disabled ? "opacity-50" : undefined)}
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  {Icon ? (
                    <Icon size={CRATE_ICON_SIZE.md} className="shrink-0" />
                  ) : (
                    <span className="w-[18px] shrink-0" />
                  )}
                  <span className="truncate">{entry.label}</span>
                </span>
                <Indicator
                  size={17}
                  className="shrink-0 text-text-primary/45"
                />
              </AppMenuButton>
              {entry.expanded ? (
                <div className="space-y-1 px-3 pb-2">
                  <ContextMenuItems items={entry.items} onClose={onClose} />
                </div>
              ) : null}
            </div>
          );
        }

        return (
          <AppMenuButton
            key={entry.key}
            role="menuitem"
            danger={entry.danger}
            disabled={entry.disabled}
            onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              handleSelect(entry);
            }}
            className={cn(
              entry.active ? "text-accent-action" : undefined,
              entry.disabled ? "opacity-50" : undefined,
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-3">
              {Icon ? (
                <Icon
                  size={CRATE_ICON_SIZE.md}
                  className={cn(
                    "shrink-0",
                    entry.active && "animate-crate-icon-active-pulse",
                  )}
                />
              ) : (
                <span className="w-[18px] shrink-0" />
              )}
              <span className="truncate">{entry.label}</span>
            </span>
            {entry.active ? (
              <Check size={17} className="shrink-0 text-accent-action" />
            ) : null}
          </AppMenuButton>
        );
      })}
    </>
  );
}

export function ContextMenu({
  items,
  header,
  open,
  position,
  menuRef,
  onClose,
  className,
  renderMediaImage,
}: ContextMenuProps) {
  const isDesktop = useIsDesktop();
  const canHover = useHoverCapability();
  const shouldUseDesktopMenu = shouldRenderDesktopContextMenu({
    isDesktop,
    canHover,
    isTouchDominant: detectTouchDominant(),
  });

  if (!open || !hasSelectableEntries(items)) return null;

  const content = (
    <>
      <ContextMenuHeaderView
        header={header}
        renderMediaImage={renderMediaImage}
      />
      <div className="p-1.5">
        <ContextMenuItems items={items} onClose={onClose} />
      </div>
    </>
  );

  if (!shouldUseDesktopMenu) {
    return (
      <MobileActionSheet open={open} panelRef={menuRef} onClose={onClose}>
        <div
          role="menu"
          className="max-h-[calc(100%-5rem)] overflow-y-auto pb-3"
        >
          {content}
        </div>
      </MobileActionSheet>
    );
  }

  if (typeof document === "undefined") return null;

  const style: CSSProperties = {
    left: position?.x ?? 12,
    top: position?.y ?? 12,
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className={cn(
        "listen-glass-panel fixed z-app-context-menu w-72 max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] origin-top-left overflow-y-auto overflow-x-hidden rounded-2xl animate-pop-in",
        className,
      )}
      style={style}
    >
      {content}
    </div>,
    document.body,
  );
}
