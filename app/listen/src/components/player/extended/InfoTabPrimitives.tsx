import type { ReactNode } from "react";
import { AudioLines, CRATE_ICON_SIZE, Star } from "@crate/ui/icons";

import { cn } from "@/lib/utils";

export function MetricBar({
  label,
  value,
  tone = "primary",
}: {
  label: string;
  value: number | null;
  tone?: "primary" | "accent" | "warm";
}) {
  if (value == null) return null;

  const percent = Math.max(0, Math.min(value, 1)) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-text-muted">
          {label}
        </span>
        <span className="text-xs font-medium tabular-nums text-text-secondary">
          {Math.round(percent)}%
        </span>
      </div>
      <div className="info-tab-metric-track h-2 overflow-hidden rounded-full">
        <div
          className={cn(
            "info-tab-metric-fill h-full rounded-full transition-[width]",
          )}
          data-tone={tone}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <div className="info-tab-stat-card rounded-lg px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-subtle">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
        {value}
      </p>
      {helper ? <p className="mt-1 text-xs text-text-muted">{helper}</p> : null}
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: typeof AudioLines;
  children: ReactNode;
}) {
  return (
    <section className="info-tab-section-card overflow-hidden rounded-[12px]">
      <div className="info-tab-section-header flex items-start justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
            {title}
          </p>
          {subtitle ? (
            <p className="mt-1 text-[0.75rem] text-text-muted">{subtitle}</p>
          ) : null}
        </div>
        <div className="info-tab-section-icon rounded-full p-2 text-text-secondary">
          <Icon size={CRATE_ICON_SIZE.md} />
        </div>
      </div>
      <div className="space-y-4 p-4 ">{children}</div>
    </section>
  );
}

export function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((score) => (
        <Star
          key={score}
          size={CRATE_ICON_SIZE.sm}
          className={
            score <= rating
              ? "fill-state-warning text-state-warning"
              : "text-text-faint"
          }
        />
      ))}
    </div>
  );
}
