import { Children, type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ResponsiveLine } from "@nivo/line";

import type { StatsTrendPoint, StatsWindow } from "./stats-model";
import { STATS_WINDOW_OPTIONS } from "./stats-model";

export function OverviewCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[12px] border border-border-quiet bg-text-primary/[0.03] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-text-primary/40">
            {label}
          </p>
          <p className="mt-3 text-2xl font-bold text-text-primary">{value}</p>
          {hint ? <p className="mt-2 text-sm text-text-muted">{hint}</p> : null}
        </div>
        <div className="flex size-10 items-center justify-center rounded-xl border border-accent-action/15 bg-accent-action/10 text-accent-action">
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

export function StatsSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[12px] border border-border-quiet bg-text-primary/[0.03] p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        {subtitle ? (
          <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function WindowPicker({
  value,
  onChange,
}: {
  value: StatsWindow | null;
  onChange: (value: StatsWindow) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-full border border-border-quiet bg-surface-canvas/25 p-1 backdrop-blur">
      {STATS_WINDOW_OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-black uppercase tracking-[0.12em] transition-all ${
            value === option.value
              ? "bg-accent-action text-accent-action-foreground shadow-accent-action"
              : "text-text-muted hover:bg-text-primary/5 hover:text-text-primary"
          }`}
        >
          {t(option.label)}
        </button>
      ))}
    </div>
  );
}

export function TopList({
  title,
  emptyText,
  loading = false,
  children,
}: {
  title: string;
  emptyText: string;
  loading?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const hasVisibleItems = Children.count(children) > 0;

  return (
    <div className="rounded-xl border border-border-quiet bg-surface-canvas/10 p-4">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      <div className="mt-3 space-y-2">
        {loading ? (
          <p className="text-sm text-text-muted">{t("common.loadingShort")}</p>
        ) : hasVisibleItems ? (
          children
        ) : (
          <p className="text-sm text-text-muted">{emptyText}</p>
        )}
      </div>
    </div>
  );
}

export function TrendChart({
  points,
  loading,
}: {
  points: StatsTrendPoint[];
  loading?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const data = useMemo(
    () => [
      {
        id: t("stats.metrics.minutes"),
        data: points.map((point) => ({
          x: point.day,
          y: Number(point.minutes_listened.toFixed(2)),
        })),
      },
    ],
    [points, t],
  );

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-border-quiet bg-surface-canvas/20 text-sm text-text-muted">
        {t("stats.trend.loading")}
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-border-quiet bg-surface-canvas/20 text-sm text-text-muted">
        {t("stats.trend.empty")}
      </div>
    );
  }

  return (
    <div className="stats-trend-chart h-72 rounded-xl border border-border-quiet p-3">
      <ResponsiveLine
        data={data}
        margin={{ top: 22, right: 22, bottom: 40, left: 48 }}
        xScale={{ type: "point" }}
        yScale={{
          type: "linear",
          min: 0,
          max: "auto",
          stacked: false,
          reverse: false,
        }}
        axisTop={null}
        axisRight={null}
        colors={["var(--accent-action)"]}
        enableGridX={false}
        enableArea
        areaOpacity={0.18}
        pointSize={8}
        pointColor="var(--accent-action)"
        pointBorderWidth={2}
        pointBorderColor="var(--surface-canvas)"
        lineWidth={3}
        curve="monotoneX"
        useMesh
        theme={{
          text: {
            fill: "color-mix(in srgb, var(--text-primary) 50%, transparent)",
            fontSize: 11,
          },
          axis: {
            ticks: {
              text: {
                fill: "color-mix(in srgb, var(--text-primary) 38%, transparent)",
              },
            },
            legend: {
              text: {
                fill: "color-mix(in srgb, var(--text-primary) 35%, transparent)",
              },
            },
            domain: { line: { stroke: "var(--border-quiet)" } },
          },
          grid: {
            line: {
              stroke: "color-mix(in srgb, var(--text-primary) 6%, transparent)",
            },
          },
          crosshair: {
            line: {
              stroke:
                "color-mix(in srgb, var(--text-primary) 20%, transparent)",
              strokeWidth: 1,
            },
          },
          tooltip: {
            container: {
              background: "var(--surface-elevated)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-quiet)",
              borderRadius: "14px",
            },
          },
        }}
        axisBottom={{
          tickRotation: points.length > 14 ? -45 : 0,
          format: (value) => {
            const date = new Date(`${String(value)}T12:00:00`);
            return date.toLocaleDateString(i18n.language, {
              month: "short",
              day: "numeric",
            });
          },
        }}
        axisLeft={{
          format: (value) => `${Math.round(Number(value))}m`,
        }}
        tooltip={({ point }) => (
          <div className="px-3 py-2">
            <div className="text-xs font-semibold text-text-primary">
              {String(point.data.xFormatted)}
            </div>
            <div className="mt-1 text-sm text-text-accent">
              {t("stats.trend.minutesValue", {
                value: point.data.yFormatted,
              })}
            </div>
          </div>
        )}
      />
    </div>
  );
}
