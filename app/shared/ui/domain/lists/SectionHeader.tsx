import type { ReactNode } from "react";
import { cn } from "@crate/ui/lib/cn";

export interface SectionHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function SectionHeader({
  title,
  subtitle,
  action,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn("flex items-end justify-between gap-4", className)}
      data-testid="section-header"
    >
      <div className="min-w-0">
        <div className="text-lg font-semibold leading-tight">{title}</div>
        {subtitle ? (
          <div className="mt-1 text-sm text-text-primary/50">{subtitle}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
