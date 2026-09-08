import type { ReactNode } from "react";
import { cn } from "@crate/ui/lib/cn";

export interface MediaGridProps {
  children: ReactNode;
  className?: string;
  minItemWidth?: number;
}

export function MediaGrid({
  children,
  className,
  minItemWidth = 160,
}: MediaGridProps) {
  return (
    <div
      className={cn("grid gap-[var(--content-grid-gap)]", className)}
      style={{
        ["--media-grid-min" as string]: `${minItemWidth}px`,
        gridTemplateColumns:
          "repeat(auto-fill, minmax(var(--media-grid-min), 1fr))",
      }}
    >
      {children}
    </div>
  );
}
