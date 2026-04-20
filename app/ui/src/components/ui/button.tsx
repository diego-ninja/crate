import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-medium transition-all outline-none disabled:pointer-events-none disabled:opacity-50 focus-visible:border-white/15 focus-visible:shadow-[0_0_0_1px_rgba(255,255,255,0.08)] aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "rounded-md bg-primary text-primary-foreground shadow-[0_14px_28px_rgba(6,182,212,0.22)] hover:bg-primary/90",
        destructive:
          "rounded-md bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive/60",
        outline:
          "rounded-md border border-white/12 bg-white/5 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:bg-white/10 hover:text-accent-foreground",
        secondary:
          "rounded-md bg-white/7 text-secondary-foreground hover:bg-white/10",
        ghost:
          "rounded-md text-white/70 hover:bg-white/5 hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 text-sm has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 text-sm has-[>svg]:px-2.5",
        lg: "h-11 rounded-md px-6 text-sm has-[>svg]:px-4",
        icon: "size-10 rounded-md",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-md",
        "icon-lg": "size-11 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
