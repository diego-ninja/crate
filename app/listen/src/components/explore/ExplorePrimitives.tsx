import type { ReactNode } from "react";
import { ArrowRight, Loader2 } from "@crate/ui/icons";

export function ExplorePill({
  label,
  count,
  onClick,
}: {
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-border-quiet px-4 py-2 transition-colors hover:border-accent-action/40 hover:bg-accent-action/5"
    >
      <span className="text-sm font-medium text-accent-action">{label}</span>
      {count != null && count > 0 ? (
        <span className="text-xs text-text-muted">{count}</span>
      ) : null}
    </button>
  );
}

export function ExploreSectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-bold text-text-primary">{title}</h2>
        {subtitle ? (
          <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
        ) : null}
      </div>
      {actionLabel && onAction ? (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-primary"
        >
          {actionLabel}
          <ArrowRight size={15} />
        </button>
      ) : null}
    </div>
  );
}

export function ExploreSectionRail({ children }: { children: ReactNode }) {
  return (
    <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}

export function ExploreLoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 size={24} className="animate-spin text-accent-action" />
    </div>
  );
}
