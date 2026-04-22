import * as React from "react";

import { cn } from "@crate/ui/lib/cn";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-28 w-full rounded-md border border-white/10 bg-black/25 px-4 py-3 text-base text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-sm transition-[background-color,border-color,box-shadow] outline-none placeholder:text-white/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-primary/35 focus-visible:bg-black/35 focus-visible:shadow-[0_0_0_1px_rgba(34,211,238,0.08)]",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
