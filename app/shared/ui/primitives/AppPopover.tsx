import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
} from "react";

import { cn } from "@crate/ui/lib/cn";

export const APP_FLOATING_SURFACE_BASE =
  "rounded-md border border-[var(--idle-border)] bg-popover-surface shadow-popover backdrop-blur-xl animate-pop-in";
export const APP_POPOVER_SURFACE = `z-app-popover ${APP_FLOATING_SURFACE_BASE}`;
export const APP_CONTEXT_MENU_SURFACE = `z-app-context-menu ${APP_FLOATING_SURFACE_BASE}`;
export const APP_DROPDOWN_SURFACE = `z-app-dropdown ${APP_FLOATING_SURFACE_BASE}`;

interface AppPopoverProps extends ComponentPropsWithoutRef<"div"> {
  layer?: "popover" | "dropdown" | "context";
}

export const AppPopover = forwardRef<HTMLDivElement, AppPopoverProps>(
  function AppPopover({ className, layer = "dropdown", ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          layer === "dropdown"
            ? APP_DROPDOWN_SURFACE
            : layer === "context"
              ? APP_CONTEXT_MENU_SURFACE
              : APP_POPOVER_SURFACE,
          className,
        )}
        {...props}
      />
    );
  },
);

export function AppPopoverDivider({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("my-1 border-t border-[var(--idle-border)]", className)}
      {...props}
    />
  );
}

interface AppMenuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  danger?: boolean;
}

export function AppMenuButton({
  className,
  danger = false,
  type = "button",
  ...props
}: AppMenuButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
        danger
          ? "text-[var(--status-danger-text)] hover:bg-[var(--hover-bg)]"
          : "text-text-primary hover:bg-[var(--hover-bg)]",
        className,
      )}
      {...props}
    />
  );
}
