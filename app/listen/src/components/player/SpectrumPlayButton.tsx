import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

type SpectrumPlayButtonSize = "sm" | "md" | "lg";

interface SpectrumPlayButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children: ReactNode;
  size?: SpectrumPlayButtonSize;
}

const sizeClasses: Record<SpectrumPlayButtonSize, string> = {
  sm: "h-9 w-9 p-[2px]",
  md: "h-12 w-12 p-[2px]",
  lg: "h-16 w-16 p-[3px]",
};

export const SpectrumPlayButton = forwardRef<
  HTMLButtonElement,
  SpectrumPlayButtonProps
>(function SpectrumPlayButton(
  {
    active = false,
    children,
    className,
    size = "md",
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-active={active ? "true" : "false"}
      className={cn(
        "group relative z-30 isolate flex shrink-0 items-center justify-center overflow-visible rounded-full",
        "spectrum-play-button",
        "transition-[transform,filter,box-shadow] duration-200 hover:scale-105 active:scale-95 data-[active=true]:brightness-110 data-[active=true]:saturate-125",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-action/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-canvas",
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "spectrum-play-button-aura pointer-events-none absolute -inset-[16px] z-0 origin-[46%_57%] rounded-[45%_55%_49%_51%/53%_47%_56%_44%] opacity-[0.62] transition-opacity duration-200 group-hover:opacity-[0.76] group-data-[active=true]:opacity-[0.72]",
          active && "animate-crate-play-aura-pulse",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "spectrum-play-button-rim pointer-events-none absolute inset-0 z-10 rounded-full",
          active && "animate-crate-play-rim-pulse",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "spectrum-play-button-core pointer-events-none absolute inset-[2px] z-20 rounded-full",
          active && "animate-crate-play-core-pulse",
        )}
      />
      <span className="spectrum-play-button-icon relative z-30 flex size-full items-center justify-center rounded-full text-text-primary">
        {children}
      </span>
    </button>
  );
});
