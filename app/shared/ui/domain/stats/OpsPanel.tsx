import type { ReactNode } from "react";
import { CRATE_ICON_SIZE, type LucideIcon } from "@crate/ui/icons";

import { cn } from "@crate/ui/lib/cn";

export function OpsPanel({
  icon: Icon,
  title,
  description,
  action,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-md border border-border-quiet bg-panel-surface/90 shadow-card backdrop-blur-xl",
        className,
      )}
    >
      <div className="flex flex-col gap-3 border-b border-text-primary/8 p-4 md:flex-row md:items-start md:justify-between md:px-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-10 items-center justify-center rounded-md border border-border-quiet bg-text-primary/[0.04] text-text-primary/70">
            <Icon size={CRATE_ICON_SIZE.md} />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-text-primary">
              {title}
            </h2>
            {description ? (
              <p className="max-w-3xl text-sm text-text-primary/45">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action ? (
          <div className="flex flex-wrap items-center gap-2">{action}</div>
        ) : null}
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}
