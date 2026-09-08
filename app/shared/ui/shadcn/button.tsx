import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@crate/ui/lib/cn";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-medium transition-all outline-none disabled:pointer-events-none disabled:opacity-50 focus-visible:border-border-focus focus-visible:shadow-focus aria-invalid:border-state-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default:
          "rounded-md bg-accent-action text-accent-action-foreground shadow-action hover:bg-accent-action-hover",
        destructive:
          "rounded-md bg-state-danger text-state-danger-foreground hover:bg-state-danger/90 dark:bg-state-danger/60",
        outline:
          "rounded-md border border-border-subtle bg-surface-control text-text-primary shadow-control-inset hover:bg-surface-control-hover hover:text-text-primary",
        secondary:
          "rounded-md bg-surface-control text-text-primary hover:bg-surface-control-hover",
        ghost:
          "rounded-md text-text-secondary hover:bg-surface-control hover:text-text-primary dark:hover:bg-surface-control-hover",
        link: "text-accent-action underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 text-sm has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-[14px]",
        sm: "h-8 gap-1.5 rounded-md px-3 text-sm has-[>svg]:px-2.5 [&_svg:not([class*='size-'])]:size-4",
        lg: "h-11 rounded-md px-6 text-sm has-[>svg]:px-4",
        icon: "size-10 rounded-md",
        "icon-xs":
          "size-6 rounded-md [&_svg:not([class*='size-'])]:size-[14px]",
        "icon-sm": "size-8 rounded-md [&_svg:not([class*='size-'])]:size-4",
        "icon-lg": "size-11 rounded-md [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
