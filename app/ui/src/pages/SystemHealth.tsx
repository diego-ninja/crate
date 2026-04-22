import { useMemo, useState, type ReactNode } from "react";

import { ResponsiveLine } from "@nivo/line";
import {
  Activity,
  AlertTriangle,
  Clock,
  Cpu,
  Database,
  Disc3,
  Gauge,
  HardDrive,
  Radio,
  RefreshCw,
  Zap,
} from "lucide-react";

import { OpsPageHero, OpsPanel, OpsStatTile } from "@/components/admin/ops-surfaces";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { CrateChip } from "@crate/ui/primitives/CrateBadge";
import { useApi } from "@/hooks/use-api";
import { taskLabel } from "@/lib/task-labels";

interface MetricSummary {
  count: number;
  avg: number;
  min: number;
  max: number;
  sum: number;
}

interface MetricsSummaryResponse {
  api_latency: MetricSummary;
  api_requests: MetricSummary;
  api_errors: MetricSummary;
  stream_requests: MetricSummary;
  stream_latency: MetricSummary;
  stream_concurrent: MetricSummary;
}

interface TimeseriesPoint {
  timestamp: string;
  count: number;
  avg: number;
  min: number;
  max: number;
  sum: number;
}

interface TimeseriesResponse {
  name: string;
  period: string;
  data: TimeseriesPoint[];
}

interface ActiveTask {
  id: string;
  type: string;
  status: string;
  label?: string;
  progress?: string;
  created_at?: string;
  updated_at?: string;
}

interface DiskUsage {
  total_gb: number;
  used_gb: number;
  free_gb: number;
  percent: number;
}

interface SystemMetrics {
  disk: Record<string, DiskUsage | null>;
  db_pool: { size: number; checked_in: number; checked_out: number; overflow: number; total: number };
  analysis: {
    analysis?: { pending: number; done: number; failed: number };
    bliss?: { pending: number; done: number; failed: number };
  };
  load: { load_1m: number; load_5m: number; load_15m: number; cpu_count: number; load_percent: number };
}

type Period = "minute" | "hour";

function ChartTooltip({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: string }[];
}) {
  return (
    <div className="min-w-[180px] rounded-sm border border-white/10 bg-panel-surface/95 px-3 py-3 text-xs text-white shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="text-[10px] uppercase tracking-[0.14em] text-cyan-200/65">Metric slice</div>
      <div className="mt-2 font-medium text-white">{title}</div>
      <div className="mt-3 space-y-1.5">
        {items.map((item) => (
          <div
            key={`${item.label}-${item.value}`}
            className="flex items-center justify-between gap-4 border-b border-white/6 pb-1 last:border-b-0 last:pb-0"
          >
            <span className="text-white/45">{item.label}</span>
            <span className="font-medium text-white">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HealthSignal({
  score,
  summary,
}: {
  score: number;
  summary: string;
}) {
  const color =
    score >= 80 ? "text-emerald-300" : score >= 50 ? "text-amber-200" : "text-red-200";
  const bg =
    score >= 80
      ? "border-emerald-400/25 bg-emerald-500/[0.08]"
      : score >= 50
        ? "border-amber-400/25 bg-amber-500/[0.08]"
        : "border-red-400/25 bg-red-500/[0.08]";

  return (
    <div className={`rounded-md border px-5 py-4 shadow-[0_16px_36px_rgba(0,0,0,0.16)] ${bg}`}>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-black/20">
          <Gauge size={20} className={color} />
        </div>
        <div>
          <div className={`text-3xl font-bold tabular-nums ${color}`}>{score}</div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-white/40">Health Score</div>
        </div>
      </div>
      <div className="mt-3 text-xs text-white/45">{summary}</div>
    </div>
  );
}

function ResourceCard({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-white/8 bg-black/20 p-4 shadow-[0_16px_36px_rgba(0,0,0,0.16)]">
      <div className="flex items-center gap-2 text-[11px] text-white/40 uppercase tracking-[0.14em]">
        <Icon size={12} />
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold text-white tabular-nums">{value}</div>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function ProgressBar({
  value,
  max,
  color = "bg-primary",
  label,
}: {
  value: number;
  max: number;
  color?: string;
  label?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="space-y-1">
      {label ? (
        <div className="flex justify-between text-[11px]">
          <span className="text-white/40">{label}</span>
          <span className="text-white/60 tabular-nums">{pct.toFixed(0)}%</span>
        </div>
      ) : null}
      <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function MetricChart({
  title,
  data,
  yLabel,
  series,
}: {
  title: string;
  data: TimeseriesPoint[];
  yLabel: string;
  series?: { id: string; field: keyof TimeseriesPoint }[];
}) {
  const { chartData, tickValues } = useMemo(() => {
    if (!data?.length) return { chartData: [], tickValues: [] as string[] };
    const labels = data.map((point) =>
      new Date(point.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    );
    const maxTicks = 6;
    const step = Math.max(1, Math.floor(labels.length / maxTicks));
    const picks: string[] = [];
    for (let i = 0; i < labels.length; i += step) {
      const label = labels[i];
      if (label) picks.push(label);
    }

    const lines = series ?? [
      { id: "avg", field: "avg" as const },
      { id: "max", field: "max" as const },
    ];

    return {
      chartData: lines.map((line) => ({
        id: line.id,
        data: data.map((point, index) => ({
          x: labels[index] ?? "",
          y: (point[line.field] as number) ?? 0,
        })),
      })),
      tickValues: picks,
    };
  }, [data, series]);

  if (!chartData.length) {
    return (
      <div className="rounded-md border border-white/8 bg-black/20 p-4 shadow-[0_16px_36px_rgba(0,0,0,0.16)]">
        <div className="mb-2 text-sm font-medium text-white">{title}</div>
        <div className="flex h-48 items-center justify-center text-sm text-white/30">No data yet</div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-white/8 bg-black/20 p-4 shadow-[0_16px_36px_rgba(0,0,0,0.16)]">
      <div className="mb-2 text-sm font-medium text-white">{title}</div>
      <div className="h-48">
        <ResponsiveLine
          data={chartData}
          margin={{ top: 8, right: 16, bottom: 32, left: 48 }}
          xScale={{ type: "point" }}
          yScale={{ type: "linear", min: 0, max: "auto" }}
          curve="monotoneX"
          colors={["#06b6d4", "rgba(6,182,212,0.3)", "#f59e0b", "rgba(245,158,11,0.3)"]}
          lineWidth={2}
          pointSize={0}
          enableArea={true}
          areaOpacity={0.08}
          enableGridX={false}
          gridYValues={4}
          theme={{
            text: { fill: "rgba(255,255,255,0.4)", fontSize: 10 },
            grid: { line: { stroke: "rgba(255,255,255,0.06)" } },
            crosshair: { line: { stroke: "#06b6d4", strokeWidth: 1 } },
            tooltip: {
              container: {
                background: "transparent",
                border: "none",
                boxShadow: "none",
                padding: 0,
              },
            },
          }}
          axisBottom={{ tickSize: 0, tickPadding: 8, tickValues }}
          axisLeft={{
            tickSize: 0,
            tickPadding: 8,
            tickValues: 4,
            legend: yLabel,
            legendPosition: "middle",
            legendOffset: -40,
          }}
          enableSlices="x"
          sliceTooltip={({ slice }) => (
            <ChartTooltip
              title={String(slice.points[0]?.data.x ?? "")}
              items={slice.points.map((point) => ({
                label: String(point.seriesId),
                value:
                  typeof point.data.y === "number"
                    ? (point.data.y as number).toFixed(1)
                    : String(point.data.y ?? "0"),
              }))}
            />
          )}
        />
      </div>
    </div>
  );
}

export function SystemHealth() {
  const [period, setPeriod] = useState<Period>("minute");
  const minutes = period === "minute" ? 60 : 1440;

  const { data: summary, refetch: refetchSummary } = useApi<MetricsSummaryResponse>(
    "/api/admin/metrics/summary",
  );
  const { data: system } = useApi<SystemMetrics>("/api/admin/metrics/system");
  const { data: latencyTs } = useApi<TimeseriesResponse>(
    `/api/admin/metrics/timeseries?name=api.latency&period=${period}&minutes=${minutes}`,
  );
  const { data: requestsTs } = useApi<TimeseriesResponse>(
    `/api/admin/metrics/timeseries?name=api.requests&period=${period}&minutes=${minutes}`,
  );
  const { data: errorsTs } = useApi<TimeseriesResponse>(
    `/api/admin/metrics/timeseries?name=api.errors&period=${period}&minutes=${minutes}`,
  );
  const { data: streamTs } = useApi<TimeseriesResponse>(
    `/api/admin/metrics/timeseries?name=stream.requests&period=${period}&minutes=${minutes}`,
  );
  const { data: queueTs } = useApi<TimeseriesResponse>(
    `/api/admin/metrics/timeseries?name=worker.queue.depth&period=${period}&minutes=${minutes}`,
  );
  const { data: taskDurationTs } = useApi<TimeseriesResponse>(
    `/api/admin/metrics/timeseries?name=worker.task.duration&period=${period}&minutes=${minutes}`,
  );
  const { data: queueWaitTs } = useApi<TimeseriesResponse>(
    `/api/admin/metrics/timeseries?name=worker.queue.wait&period=${period}&minutes=${minutes}`,
  );
  const { data: tasks } = useApi<ActiveTask[]>("/api/tasks?status=running&limit=10");

  const score = useMemo(() => {
    if (!summary) return 100;
    let next = 100;
    if (summary.api_latency.max > 3000) next -= 15;
    if (summary.api_errors.count > 0 && summary.api_requests.count > 0) {
      const errRate = summary.api_errors.count / summary.api_requests.count;
      if (errRate > 0.05) next -= 20;
      else if (errRate > 0.01) next -= 5;
    }
    if (system?.load?.load_percent && system.load.load_percent > 80) next -= 10;
    if (system?.db_pool?.checked_out && system.db_pool.checked_out >= (system.db_pool.size || 8)) next -= 10;
    return Math.max(0, next);
  }, [summary, system]);

  const errorRate =
    summary && summary.api_requests.count > 0
      ? (summary.api_errors.count / summary.api_requests.count * 100).toFixed(2)
      : "0";

  const scoreSummary =
    score >= 80
      ? "Core services look stable and current pressure is within healthy bounds."
      : score >= 50
        ? "The system is usable, but latency or load deserve attention before they become user-facing."
        : "Health is degraded enough to warrant immediate triage on latency, queue pressure or database usage.";

  const runningTasks = tasks?.length ?? 0;
  const queueDepth =
    queueTs?.data.length
      ? queueTs.data[queueTs.data.length - 1]?.max ?? 0
      : 0;

  return (
    <div className="space-y-6">
      <OpsPageHero
        icon={Activity}
        title="System Health"
        description="Runtime pressure, API performance, queue behavior and infrastructure saturation across the stack."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-md border border-white/10 bg-black/20 p-0.5 text-xs shadow-[0_12px_28px_rgba(0,0,0,0.18)]">
              <button
                type="button"
                onClick={() => setPeriod("minute")}
                className={`rounded-sm px-3 py-1.5 transition-colors ${period === "minute" ? "bg-primary text-primary-foreground" : "text-white/50 hover:text-white"}`}
              >
                1h
              </button>
              <button
                type="button"
                onClick={() => setPeriod("hour")}
                className={`rounded-sm px-3 py-1.5 transition-colors ${period === "hour" ? "bg-primary text-primary-foreground" : "text-white/50 hover:text-white"}`}
              >
                24h
              </button>
            </div>
            <ActionIconButton variant="card" onClick={() => refetchSummary()} title="Refresh metrics">
              <RefreshCw size={15} />
            </ActionIconButton>
          </div>
        }
      >
        <CrateChip icon={Activity}>{summary ? `${summary.api_requests.count} requests` : "Metrics loading"}</CrateChip>
        <CrateChip icon={Zap}>{runningTasks} running tasks</CrateChip>
        <CrateChip icon={Clock}>{queueDepth} queued depth</CrateChip>
        {summary ? (
          <CrateChip className={Number(errorRate) > 1 ? "border-red-500/25 bg-red-500/10 text-red-100" : undefined}>
            {errorRate}% error rate
          </CrateChip>
        ) : null}
      </OpsPageHero>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))]">
        <HealthSignal score={score} summary={scoreSummary} />
        <OpsStatTile
          icon={Activity}
          label="API p95"
          value={summary ? `${summary.api_latency.max.toFixed(0)}ms` : "—"}
          caption={summary ? `avg ${summary.api_latency.avg.toFixed(0)}ms` : "Waiting for metrics"}
          tone={summary && summary.api_latency.max > 3000 ? "warning" : "default"}
        />
        <OpsStatTile
          icon={AlertTriangle}
          label="Error Rate"
          value={`${errorRate}%`}
          caption={summary ? `${summary.api_errors.count} / ${summary.api_requests.count} requests` : "Waiting for metrics"}
          tone={Number(errorRate) > 1 ? "danger" : "default"}
        />
        <OpsStatTile
          icon={Radio}
          label="Stream Volume"
          value={summary ? `${summary.stream_requests.count}` : "—"}
          caption="Requests sampled in the current window"
          tone="default"
        />
        <OpsStatTile
          icon={Cpu}
          label="Load"
          value={system?.load ? `${system.load.load_1m}` : "—"}
          caption={
            system?.load
              ? `${system.load.load_percent}% of ${system.load.cpu_count} cores`
              : "Waiting for system metrics"
          }
          tone={system?.load && system.load.load_percent > 80 ? "warning" : "default"}
        />
      </div>

      {system ? (
        <OpsPanel
          icon={HardDrive}
          title="Resources"
          description="Storage pressure, database pool use and analysis backlog surfaced as operational cards."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {system.disk?.music ? (
              <ResourceCard
                icon={HardDrive}
                label="Music Volume"
                value={`${system.disk.music.used_gb} / ${system.disk.music.total_gb} GB`}
              >
                <ProgressBar
                  value={system.disk.music.used_gb}
                  max={system.disk.music.total_gb}
                  color={
                    system.disk.music.percent > 90
                      ? "bg-red-500"
                      : system.disk.music.percent > 75
                        ? "bg-amber-500"
                        : "bg-primary"
                  }
                  label={`${system.disk.music.free_gb} GB free`}
                />
              </ResourceCard>
            ) : null}

            {system.disk?.data ? (
              <ResourceCard
                icon={Database}
                label="Data Volume"
                value={`${system.disk.data.used_gb} / ${system.disk.data.total_gb} GB`}
              >
                <ProgressBar
                  value={system.disk.data.used_gb}
                  max={system.disk.data.total_gb}
                  color={
                    system.disk.data.percent > 90
                      ? "bg-red-500"
                      : system.disk.data.percent > 75
                        ? "bg-amber-500"
                        : "bg-primary"
                  }
                  label={`${system.disk.data.free_gb} GB free`}
                />
              </ResourceCard>
            ) : null}

            {system.db_pool?.size > 0 ? (
              <ResourceCard
                icon={Database}
                label="DB Pool"
                value={`${system.db_pool.checked_out} / ${system.db_pool.size + (system.db_pool.overflow > 0 ? system.db_pool.overflow : 0)}`}
              >
                <ProgressBar
                  value={system.db_pool.checked_out}
                  max={system.db_pool.size}
                  color={system.db_pool.checked_out >= system.db_pool.size ? "bg-red-500" : "bg-primary"}
                  label={`${system.db_pool.checked_in} idle, ${system.db_pool.checked_out} active`}
                />
              </ResourceCard>
            ) : null}

            {system.analysis?.analysis ? (
              <ResourceCard
                icon={Disc3}
                label="Analysis"
                value={`${system.analysis.analysis.done} / ${system.analysis.analysis.done + system.analysis.analysis.pending}`}
              >
                <ProgressBar
                  value={system.analysis.analysis.done}
                  max={system.analysis.analysis.done + system.analysis.analysis.pending}
                  label={`${system.analysis.analysis.pending} pending${system.analysis.analysis.failed > 0 ? `, ${system.analysis.analysis.failed} failed` : ""}`}
                />
                {system.analysis.bliss && system.analysis.bliss.pending > 0 ? (
                  <div className="text-[10px] text-white/30">
                    Bliss: {system.analysis.bliss.done} done, {system.analysis.bliss.pending} pending
                  </div>
                ) : null}
              </ResourceCard>
            ) : null}
          </div>
        </OpsPanel>
      ) : null}

      <OpsPanel
        icon={Gauge}
        title="Metric Streams"
        description="Latency, request volume, queue pressure and task execution trends over the selected time window."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <MetricChart title="API Latency" data={latencyTs?.data ?? []} yLabel="ms" />
          <MetricChart title="Request Volume" data={requestsTs?.data ?? []} yLabel="req" />
          <MetricChart
            title="Error Rate"
            data={errorsTs?.data ?? []}
            yLabel="errors"
            series={[{ id: "errors", field: "count" }]}
          />
          <MetricChart title="Stream Activity" data={streamTs?.data ?? []} yLabel="streams" />
          <MetricChart title="Task Duration" data={taskDurationTs?.data ?? []} yLabel="sec" />
          <MetricChart title="Queue Wait Time" data={queueWaitTs?.data ?? []} yLabel="sec" />
          <MetricChart title="Queue Depth" data={queueTs?.data ?? []} yLabel="tasks" />
        </div>
      </OpsPanel>

      {tasks && tasks.length > 0 ? (
        <OpsPanel
          icon={Zap}
          title="Running Tasks"
          description="The worker jobs currently in flight, with elapsed time and live progress where available."
        >
          <div className="space-y-2">
            {tasks.map((task) => {
              let progress: Record<string, unknown> | null = null;
              try {
                progress =
                  typeof task.progress === "string"
                    ? JSON.parse(task.progress)
                    : task.progress
                      ? (task.progress as Record<string, unknown>)
                      : null;
              } catch {
                progress = null;
              }
              const pct =
                Number(progress?.percent ?? 0)
                || (progress?.done && progress?.total
                  ? (Number(progress.done) / Number(progress.total)) * 100
                  : 0);
              const elapsed = task.created_at
                ? Math.round((Date.now() - new Date(task.created_at).getTime()) / 1000)
                : 0;
              const elapsedStr =
                elapsed > 3600
                  ? `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`
                  : elapsed > 60
                    ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
                    : `${elapsed}s`;

              return (
                <div
                  key={task.id}
                  className="flex items-center gap-3 rounded-md border border-white/8 bg-black/20 px-4 py-3 shadow-[0_12px_28px_rgba(0,0,0,0.12)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-white">
                      {task.label || taskLabel(task.type)}
                    </div>
                    <div className="mt-0.5 text-xs text-white/40">
                      {progress?.phase ? <span>{String(progress.phase)}</span> : null}
                      {progress?.item ? <span> — {String(progress.item)}</span> : null}
                    </div>
                  </div>
                  {pct > 0 ? (
                    <div className="flex w-32 items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-8 text-right text-[10px] tabular-nums text-white/40">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-1 text-[10px] text-white/30">
                    <Clock size={10} />
                    <span className="tabular-nums">{elapsedStr}</span>
                  </div>
                  <span className="font-mono text-[10px] text-white/20">{task.id.slice(0, 8)}</span>
                </div>
              );
            })}
          </div>
        </OpsPanel>
      ) : null}
    </div>
  );
}
