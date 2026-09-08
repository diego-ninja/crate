import type { ReactNode } from "react";
import { cn } from "@crate/ui/lib/cn";

export interface MediaRailProps {
  children: ReactNode;
  className?: string;
}

export function MediaRail({ children, className }: MediaRailProps) {
  return (
    <div
      className={cn(
        "overflow-x-auto scrollbar-hide snap-x snap-mandatory",
        className,
      )}
      data-testid="media-rail"
    >
      <div className="flex gap-[var(--content-rail-gap)] [&>*]:shrink-0">
        {children}
      </div>
    </div>
  );
}
