import * as React from "react";

import { cn } from "@crate/ui/lib/cn";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-md border border-border-quiet bg-surface-canvas/25 px-4 py-1 text-base text-text-primary shadow-control-inset backdrop-blur-sm transition-[background-color,border-color,box-shadow] outline-none selection:bg-accent-action selection:text-accent-action-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text-primary placeholder:text-text-primary/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-accent-action/35 focus-visible:bg-surface-canvas/35 focus-visible:shadow-focus",
        "aria-invalid:border-state-danger dark:aria-invalid:border-state-danger/70",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
