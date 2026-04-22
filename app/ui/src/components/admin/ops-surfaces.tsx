import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type OpsTone = "default" | "primary" | "success" | "warning" | "danger";

function toneClasses(tone: OpsTone) {
  switch (tone) {
    case "primary":
      return {
        iconWrap: "border-cyan-400/20 bg-cyan-400/12 text-primary shadow-[0_18px_40px_rgba(6,182,212,0.14)]",
        value: "text-white",
      };
    case "success":
      return {
        iconWrap: "border-emerald-400/20 bg-emerald-400/12 text-emerald-300 shadow-[0_18px_40px_rgba(16,185,129,0.14)]",
        value: "text-emerald-200",
      };
    case "warning":
      return {
        iconWrap: "border-amber-400/20 bg-amber-400/12 text-amber-200 shadow-[0_18px_40px_rgba(245,158,11,0.14)]",
        value: "text-amber-100",
      };
    case "danger":
      return {
        iconWrap: "border-red-400/20 bg-red-500/12 text-red-200 shadow-[0_18px_40px_rgba(239,68,68,0.14)]",
        value: "text-red-100",
      };
    default:
      return {
        iconWrap: "border-white/10 bg-white/[0.05] text-white/65",
        value: "text-white",
      };
  }
}

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
    <section className={cn("rounded-md border border-white/10 bg-panel-surface/95 p-5 shadow-[0_28px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl", className)}>
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/12 text-primary shadow-[0_18px_40px_rgba(6,182,212,0.14)]">
              <Icon size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
              <p className="text-sm text-white/55">{description}</p>
            </div>
          </div>
          {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 xl:justify-end">{actions}</div> : null}
      </div>
    </section>
  );
}

export function OpsStatTile({
  icon: Icon,
  label,
  value,
  caption,
  tone = "default",
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  tone?: OpsTone;
  className?: string;
}) {
  const toneClass = toneClasses(tone);

  return (
    <div className={cn("rounded-md border border-white/8 bg-black/20 p-4 shadow-[0_16px_36px_rgba(0,0,0,0.16)]", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.12em] text-white/35">{label}</div>
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-md border", toneClass.iconWrap)}>
          <Icon size={16} />
        </div>
      </div>
      <div className={cn("text-xl font-semibold tracking-tight", toneClass.value)}>{value}</div>
      {caption ? <div className="mt-1 text-xs text-white/40">{caption}</div> : null}
    </div>
  );
}

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
