import * as React from "react";

import { cn } from "@crate/ui/lib/cn";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-28 w-full rounded-md border border-border-quiet bg-surface-canvas/25 px-4 py-3 text-base text-text-primary shadow-control-inset backdrop-blur-sm transition-[background-color,border-color,box-shadow] outline-none placeholder:text-text-primary/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-accent-action/35 focus-visible:bg-surface-canvas/35 focus-visible:shadow-focus",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
