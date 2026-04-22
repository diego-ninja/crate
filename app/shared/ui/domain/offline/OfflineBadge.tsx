import { AlertCircle, CheckCircle2, Download, Loader2 } from "lucide-react";

import { getOfflineStateLabel, type OfflineItemState } from "@crate/ui/lib/offline";
import { cn } from "@crate/ui/lib/cn";

interface OfflineBadgeProps {
  state: OfflineItemState;
  compact?: boolean;
  subtle?: boolean;
  className?: string;
}

export function OfflineBadge({ state, compact = false, subtle = false, className }: OfflineBadgeProps) {
  if (state === "idle") return null;
  const label = getOfflineStateLabel(state);

  if (subtle) {
    const iconSize = compact ? 12 : 14;
    const icon = state === "ready"
      ? <CheckCircle2 size={iconSize} />
      : state === "error"
        ? <AlertCircle size={iconSize} />
        : state === "queued"
          ? <Download size={iconSize} />
          : <Loader2 size={iconSize} className="animate-spin" />;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 align-middle",
          state === "ready"
            ? "text-cyan-300/80"
            : state === "error"
              ? "text-amber-300/80"
              : "text-primary/85",
          className,
        )}
      >
        {icon}
        {!compact ? <span className="text-[11px] font-medium tracking-wide">{label}</span> : null}
      </span>
    );
  }

  if (state === "ready") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-200",
          className,
        )}
      >
        <CheckCircle2 size={compact ? 11 : 12} />
        {!compact ? label : null}
      </span>
    );
  }

  if (state === "error") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200",
          className,
        )}
      >
        <AlertCircle size={compact ? 11 : 12} />
        {!compact ? label : null}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary",
        className,
      )}
    >
      {state === "queued" ? <Download size={compact ? 11 : 12} /> : <Loader2 size={compact ? 11 : 12} className="animate-spin" />}
      {!compact ? label : null}
    </span>
  );
}
