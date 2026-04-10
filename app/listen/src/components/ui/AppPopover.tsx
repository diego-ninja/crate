import { forwardRef, type ButtonHTMLAttributes, type ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

export const APP_POPOVER_SURFACE =
  "z-app-popover rounded-xl border border-white/10 bg-popover-surface backdrop-blur-xl shadow-2xl animate-pop-in";

export const AppPopover = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  function AppPopover({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(APP_POPOVER_SURFACE, className)}
        {...props}
      />
    );
  },
);

export function AppPopoverDivider({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("my-1 border-t border-white/5", className)} {...props} />;
}

interface AppMenuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  danger?: boolean;
}

export function AppMenuButton({ className, danger = false, type = "button", ...props }: AppMenuButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "w-full text-left transition-colors",
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm",
        danger
          ? "text-red-400/80 hover:bg-white/5 hover:text-red-400"
          : "text-foreground hover:bg-white/5",
        className,
      )}
      {...props}
    />
  );
}
