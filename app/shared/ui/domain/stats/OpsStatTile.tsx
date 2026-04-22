import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@crate-ui/lib/cn";

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
