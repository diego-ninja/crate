import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

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
    <section className={cn("rounded-md border border-white/10 bg-panel-surface/90 shadow-[0_24px_60px_rgba(0,0,0,0.2)] backdrop-blur-xl", className)}>
      <div className="flex flex-col gap-3 border-b border-white/8 px-4 py-4 md:flex-row md:items-start md:justify-between md:px-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-white/70">
            <Icon size={16} />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2>
            {description ? <p className="max-w-3xl text-sm text-white/45">{description}</p> : null}
          </div>
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      <div className="px-4 py-4 md:px-5 md:py-5">{children}</div>
    </section>
  );
}
