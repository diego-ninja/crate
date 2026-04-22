import * as React from "react"

import { cn } from "@crate/ui/lib/cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-md border border-white/10 bg-black/25 px-4 py-1 text-base text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-sm transition-[background-color,border-color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-white/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-primary/35 focus-visible:bg-black/35 focus-visible:shadow-[0_0_0_1px_rgba(34,211,238,0.08)]",
        "aria-invalid:border-destructive dark:aria-invalid:border-destructive/70",
        className
      )}
      {...props}
    />
  )
}

export { Input }
