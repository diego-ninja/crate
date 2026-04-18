import { Children, type ReactNode, useMemo } from "react";
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
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">{label}</p>
          <p className="mt-3 text-2xl font-bold text-foreground">{value}</p>
          {hint ? <p className="mt-2 text-sm text-muted-foreground">{hint}</p> : null}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
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
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function WindowPicker({
  value,
  onChange,
}: {
  value: StatsWindow;
  onChange: (value: StatsWindow) => void;
}) {
  return (
    <div className="inline-flex rounded-2xl border border-white/10 bg-white/[0.03] p-1">
      {STATS_WINDOW_OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-xl px-3 py-1.5 text-sm transition-colors ${
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-white/5 hover:text-white"
          }`}
        >
          {option.label}
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
  const hasVisibleItems = Children.count(children) > 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-3 space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : hasVisibleItems ? (
          children
        ) : (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
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
  const data = useMemo(() => [
    {
      id: "Minutes",
      data: points.map((point) => ({
        x: point.day,
        y: Number(point.minutes_listened.toFixed(2)),
      })),
    },
  ], [points]);

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/10 text-sm text-muted-foreground">
        Loading trend data...
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/10 text-sm text-muted-foreground">
        Start listening and your daily curve will appear here.
      </div>
    );
  }

  return (
    <div className="h-72 rounded-2xl border border-white/10 bg-black/10 p-3">
      <ResponsiveLine
        data={data}
        margin={{ top: 20, right: 20, bottom: 40, left: 50 }}
        xScale={{ type: "point" }}
        yScale={{ type: "linear", min: 0, max: "auto", stacked: false, reverse: false }}
        axisTop={null}
        axisRight={null}
        colors={["#22d3ee"]}
        enableGridX={false}
        pointSize={7}
        pointColor="#22d3ee"
        pointBorderWidth={0}
        useMesh
        theme={{
          text: { fill: "rgba(255,255,255,0.45)", fontSize: 11 },
          axis: {
            ticks: { text: { fill: "rgba(255,255,255,0.35)" } },
            legend: { text: { fill: "rgba(255,255,255,0.35)" } },
            domain: { line: { stroke: "rgba(255,255,255,0.08)" } },
          },
          grid: { line: { stroke: "rgba(255,255,255,0.06)" } },
          crosshair: { line: { stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 } },
          tooltip: {
            container: {
              background: "#0f1117",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "14px",
            },
          },
        }}
        axisBottom={{
          tickRotation: points.length > 14 ? -45 : 0,
          format: (value) => {
            const date = new Date(`${String(value)}T12:00:00`);
            return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          },
        }}
        axisLeft={{
          format: (value) => `${Math.round(Number(value))}m`,
        }}
        tooltip={({ point }) => (
          <div className="px-3 py-2">
            <div className="text-xs font-semibold text-white">{String(point.data.xFormatted)}</div>
            <div className="mt-1 text-sm text-cyan-300">{point.data.yFormatted} minutes</div>
          </div>
        )}
      />
    </div>
  );
}
