import {
  AlertCircle,
  ArrowDownToLine,
  ArrowDownToLineBold,
  Loader2,
} from "@crate/ui/icons";

import {
  getOfflineStateLabel,
  type OfflineItemState,
} from "@crate/ui/lib/offline";
import { cn } from "@crate/ui/lib/cn";

interface OfflineBadgeProps {
  state: OfflineItemState;
  compact?: boolean;
  subtle?: boolean;
  className?: string;
}

export function OfflineBadge({
  state,
  compact = false,
  subtle = false,
  className,
}: OfflineBadgeProps) {
  if (state === "idle") return null;
  const label = getOfflineStateLabel(state);

  if (subtle) {
    const iconSize = compact ? 12 : 14;
    const icon =
      state === "ready" ? (
        <ArrowDownToLineBold size={iconSize} />
      ) : state === "error" ? (
        <AlertCircle size={iconSize} />
      ) : state === "queued" ? (
        <ArrowDownToLine size={iconSize} />
      ) : (
        <Loader2 size={iconSize} className="animate-spin" />
      );
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 align-middle",
          state === "ready"
            ? "text-[var(--status-ready-text)]"
            : state === "error"
              ? "text-[var(--status-error-text)]"
              : "text-accent-action/85",
          className,
        )}
      >
        {icon}
        {!compact ? (
          <span className="text-xs font-medium tracking-wide">{label}</span>
        ) : null}
      </span>
    );
  }

  if (state === "ready") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
          "border-[var(--status-ready-border)] bg-[var(--status-ready-bg)] text-[var(--status-ready-text)]",
          className,
        )}
      >
        <ArrowDownToLineBold size={compact ? 11 : 12} />
        {!compact ? label : null}
      </span>
    );
  }

  if (state === "error") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
          "border-[var(--status-error-border)] bg-[var(--status-error-bg)] text-[var(--status-error-text)]",
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
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
        "border-[var(--active-border)] bg-[var(--active-bg)] text-accent-action",
        className,
      )}
    >
      {state === "queued" ? (
        <ArrowDownToLine size={compact ? 11 : 12} />
      ) : (
        <Loader2 size={compact ? 11 : 12} className="animate-spin" />
      )}
      {!compact ? label : null}
    </span>
  );
}
