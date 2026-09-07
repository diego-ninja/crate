import type { ReactNode } from "react";
import type { LucideIcon } from "@crate/ui/icons";

import { cn } from "@crate/ui/lib/cn";

export function OpsPageHero({
  icon: Icon,
  title,
  description,
  actions,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-md border border-border-quiet bg-panel-surface/95 p-5 shadow-card backdrop-blur-xl",
        className,
      )}
    >
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-md border border-accent-action/20 bg-accent-action/12 text-accent-action shadow-accent-action-status">
              <Icon size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
                {title}
              </h1>
              <p className="text-sm text-text-primary/55">{description}</p>
            </div>
          </div>
          {children ? (
            <div className="flex flex-wrap items-center gap-2">{children}</div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
    </section>
  );
}
