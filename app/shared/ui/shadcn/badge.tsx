import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@crate-ui/lib/cn"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-[background-color,color,border-color,box-shadow] focus-visible:border-white/15 focus-visible:shadow-[0_0_0_1px_rgba(255,255,255,0.08)] aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-primary/25 bg-primary/10 text-primary [a&]:hover:bg-primary/15",
        secondary:
          "border-white/10 bg-white/5 text-white/70 [a&]:hover:bg-white/8",
        destructive:
          "border-destructive/30 bg-destructive/10 text-red-200 dark:bg-destructive/20 [a&]:hover:bg-destructive/20",
        outline:
          "border-white/12 bg-transparent text-foreground [a&]:hover:bg-white/5 [a&]:hover:text-accent-foreground",
        ghost: "border-transparent bg-transparent [a&]:hover:bg-white/5 [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
