import type { ReactNode } from "react";
import { CRATE_ICON_SIZE, type LucideIcon } from "@crate/ui/icons";

import { cn } from "@crate/ui/lib/cn";

type OpsTone = "default" | "primary" | "success" | "warning" | "danger";

function toneClasses(tone: OpsTone) {
  switch (tone) {
    case "primary":
      return {
        iconWrap:
          "border-accent-action/20 bg-accent-action/12 text-accent-action shadow-accent-action-status",
        value: "text-text-primary",
      };
    case "success":
      return {
        iconWrap:
          "border-state-success/20 bg-state-success/12 text-state-success-text shadow-state-success",
        value: "text-state-success-text",
      };
    case "warning":
      return {
        iconWrap:
          "border-state-warning/20 bg-state-warning/12 text-state-warning-text shadow-state-warning",
        value: "text-state-warning-text",
      };
    case "danger":
      return {
        iconWrap:
          "border-state-danger/20 bg-state-danger/12 text-state-danger-text shadow-state-danger",
        value: "text-state-danger-text",
      };
    default:
      return {
        iconWrap:
          "border-border-quiet bg-text-primary/[0.05] text-text-primary/65",
        value: "text-text-primary",
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
    <div
      className={cn(
        "rounded-md border border-text-primary/8 bg-surface-canvas/20 p-4 shadow-card",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.12em] text-text-primary/35">
          {label}
        </div>
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md border",
            toneClass.iconWrap,
          )}
        >
          <Icon size={CRATE_ICON_SIZE.md} />
        </div>
      </div>
      <div
        className={cn("text-xl font-semibold tracking-tight", toneClass.value)}
      >
        {value}
      </div>
      {caption ? (
        <div className="mt-1 text-xs text-text-primary/40">{caption}</div>
      ) : null}
    </div>
  );
}
