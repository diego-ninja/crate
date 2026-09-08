import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@crate/ui/lib/cn";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-[background-color,color,border-color,box-shadow] focus-visible:border-text-primary/15 focus-visible:shadow-border-soft aria-invalid:border-state-danger [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default:
          "border-accent-action/25 bg-accent-action/10 text-accent-action [a&]:hover:bg-accent-action/15",
        secondary:
          "border-border-quiet bg-text-primary/5 text-text-primary/70 [a&]:hover:bg-text-primary/8",
        destructive:
          "border-state-danger/30 bg-state-danger/10 text-state-danger-text dark:bg-state-danger/20 [a&]:hover:bg-state-danger/20",
        outline:
          "border-text-primary/12 bg-transparent text-text-primary [a&]:hover:bg-text-primary/5 [a&]:hover:text-text-primary",
        ghost:
          "border-transparent bg-transparent [a&]:hover:bg-text-primary/5 [a&]:hover:text-text-primary",
        link: "text-accent-action underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
