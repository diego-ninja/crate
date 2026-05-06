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
  Headphones,
  Radio,
  RefreshCw,
  Route,
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
  api_slow: MetricSummary;
  stream_requests: MetricSummary;
  stream_latency: MetricSummary;
  stream_concurrent: MetricSummary;
  stream_transcode_duration: MetricSummary;
  stream_transcode_completed: MetricSummary;
  stream_transcode_failed: MetricSummary;
  home_cache_hit: MetricSummary;
  home_cache_miss: MetricSummary;
  home_cache_waited: MetricSummary;
  home_cache_coalesced: MetricSummary;
  home_cache_stale_fallback: MetricSummary;
  home_compute_ms: MetricSummary;
  home_endpoint_cache_hit: MetricSummary;
  home_endpoint_cache_miss: MetricSummary;
  home_endpoint_compute_ms: MetricSummary;
  worker_resource_deferred: MetricSummary;
  worker_resource_defer_seconds: MetricSummary;
  worker_resource_load_ratio: MetricSummary;
  worker_resource_iowait_percent: MetricSummary;
  worker_resource_swap_used_percent: MetricSummary;
  media_worker_completed?: MetricSummary;
  media_worker_failed?: MetricSummary;
  media_worker_duration?: MetricSummary;
  media_worker_bytes?: MetricSummary;
  media_worker_admission_denied?: MetricSummary;
  media_worker_cache_pruned?: MetricSummary;
  media_worker_cache_bytes_removed?: MetricSummary;
}

interface TimeseriesPoint {
  timestamp: string;
  count: number;
  avg: number;
  min: number;
  max: number;
  sum: number;
}

interface SystemHealthDashboardResponse {
  summary: MetricsSummaryResponse;
  system: SystemMetrics;
  tasks: ActiveTask[];
  playback_delivery?: PlaybackDeliverySnapshot;
  route_latency?: RouteLatencyRow[];
  timeseries: Record<string, TimeseriesPoint[]>;
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

interface DbPoolState {
  size: number;
  checked_in: number;
  checked_out: number;
  overflow: number;
  total: number;
  minconn?: number;
  maxconn?: number;
}

interface SystemMetrics {
  disk: Record<string, DiskUsage | null>;
  db_pool: DbPoolState;
  db_pools?: {
    combined?: DbPoolState;
    sqlalchemy?: DbPoolState;
    legacy?: DbPoolState;
  };
  analysis: {
    analysis?: { pending: number; done: number; failed: number };
    bliss?: { pending: number; done: number; failed: number };
  };
  load: { load_1m: number; load_5m: number; load_15m: number; cpu_count: number; load_percent: number };
  resource_pressure?: ResourcePressure;
  media_worker?: MediaWorkerRuntime;
}

interface MediaWorkerRuntime {
  redis_connected: boolean;
  stream_key: string;
  consumer_group: string;
  stream_length: number;
  pending: number;
  max_active: number;
  active_slots: Array<{ slot: number; key: string; job_id: string; ttl_ms: number }>;
  recent_events?: Array<{
    id: string;
    job_id?: string | null;
    event?: string | null;
    status?: string | null;
    kind?: string | null;
    updated_at_ms?: number | string | null;
  }>;
}

interface ResourceSnapshot {
  cpu_count: number;
  load_1m?: number | null;
  load_ratio?: number | null;
  iowait_percent?: number | null;
  swap_used_percent?: number | null;
  active_users?: number | null;
  active_streams?: number | null;
}

interface ResourcePressure {
  allowed: boolean;
  reason?: string;
  defer_seconds?: number;
  snapshot?: ResourceSnapshot | null;
  window?: {
    enabled?: boolean;
    start?: string;
    end?: string;
    now?: string;
    in_window?: boolean;
    seconds_until_start?: number;
  } | null;
  last_defer?: ResourcePressure | null;
}

type Period = "minute" | "hour";

interface PlaybackDeliveryStats {
  tracks: number;
  lossless_tracks: number;
  hires_tracks: number;
  variants: number;
  variant_tracks: number;
  ready: number;
  pending: number;
  running: number;
  failed: number;
  missing: number;
  ready_tracks: number;
  cached_bytes: number;
  ready_source_bytes: number;
  estimated_saved_bytes: number;
  coverage_percent: number;
  avg_prepare_seconds: number | null;
}

interface PlaybackTranscodeRuntime {
  active: number;
  limit: number;
}

interface PlaybackVariant {
  id: string;
  status: string;
  preset: string;
  delivery_format: string;
  delivery_bitrate: number;
  bytes: number | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  updated_at?: string | null;
}

interface PlaybackDeliverySnapshot {
  stats: PlaybackDeliveryStats;
  runtime: PlaybackTranscodeRuntime;
  recent_variants: PlaybackVariant[];
}

interface RouteLatencyRow {
  route_id: string;
  target: string;
  method: string;
  path: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p95: number;
  p99: number;
  status_2xx: number;
  status_3xx: number;
  status_4xx: number;
  status_5xx: number;
  status_other: number;
  error_rate: number;
}

function formatBytes(bytes: number | null | undefined) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function formatMs(value: number | null | undefined) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`;
  return `${ms >= 100 ? ms.toFixed(0) : ms.toFixed(1)}ms`;
}

function formatRouteErrorRate(value: number | null | undefined) {
  const pct = Number(value || 0) * 100;
  if (!Number.isFinite(pct) || pct <= 0) return "0%";
  return `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

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
        <div className="flex min-w-0 justify-between gap-2 text-[11px]">
          <span className="min-w-0 truncate text-white/40">{label}</span>
          <span className="shrink-0 text-white/60 tabular-nums">{pct.toFixed(0)}%</span>
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

function RouteLatencyOverview({ routes }: { routes: RouteLatencyRow[] }) {
  const visibleRoutes = routes.slice(0, 8);
  const maxP95 = Math.max(1, ...visibleRoutes.map((route) => route.p95 || 0));
  const totalRequests = routes.reduce((acc, route) => acc + (route.count || 0), 0);
  const slowest = visibleRoutes[0];
  const highestP99 = visibleRoutes.reduce<RouteLatencyRow | null>(
    (current, route) => (!current || route.p99 > current.p99 ? route : current),
    null,
  );
  const failing = routes.reduce((acc, route) => acc + (route.status_5xx || 0), 0);

  return (
    <OpsPanel
      icon={Route}
      title="API Route Latency"
      description="Recent endpoint latency ranked by p95, useful for finding the routes hurting admin and Listen first."
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OpsStatTile
            icon={Route}
            label="Measured Routes"
            value={routes.length.toLocaleString()}
            caption={`${totalRequests.toLocaleString()} sampled requests`}
            tone={routes.length > 0 ? "primary" : "default"}
          />
          <OpsStatTile
            icon={Clock}
            label="Slowest p95"
            value={formatMs(slowest?.p95)}
            caption={slowest ? `${slowest.method} ${slowest.path}` : "Waiting for route samples"}
            tone={slowest && slowest.p95 > 1000 ? "warning" : "default"}
          />
          <OpsStatTile
            icon={Gauge}
            label="Highest p99"
            value={formatMs(highestP99?.p99)}
            caption={highestP99 ? `${highestP99.method} ${highestP99.path}` : "Waiting for route samples"}
            tone={highestP99 && highestP99.p99 > 3000 ? "warning" : "default"}
          />
          <OpsStatTile
            icon={AlertTriangle}
            label="Route 5xx"
            value={failing.toLocaleString()}
            caption="Server errors in the sampled window"
            tone={failing > 0 ? "danger" : "default"}
          />
        </div>

        <div className="overflow-hidden rounded-md border border-white/8 bg-black/20 shadow-[0_16px_36px_rgba(0,0,0,0.16)]">
          {visibleRoutes.length > 0 ? (
            <div className="divide-y divide-white/6">
              {visibleRoutes.map((route) => {
                const isSlow = route.p95 >= 1000;
                const isVerySlow = route.p95 >= 3000 || route.error_rate > 0.01;
                const barColor = isVerySlow ? "bg-red-400" : isSlow ? "bg-amber-400" : "bg-cyan-400";

                return (
                  <div key={route.route_id} className="grid gap-3 px-4 py-3 xl:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem_6rem] xl:items-center">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <CrateChip className="shrink-0 font-mono">{route.method}</CrateChip>
                        <span className="min-w-0 truncate font-mono text-sm text-white/85">{route.path}</span>
                      </div>
                      <div className="mt-2 max-w-xl">
                        <ProgressBar value={route.p95} max={maxP95} color={barColor} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 xl:block">
                      <span className="text-[10px] uppercase tracking-[0.12em] text-white/30 xl:block">Count</span>
                      <span className="text-sm font-medium tabular-nums text-white/75">{route.count.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 xl:block">
                      <span className="text-[10px] uppercase tracking-[0.12em] text-white/30 xl:block">Avg</span>
                      <span className="text-sm font-medium tabular-nums text-white/75">{formatMs(route.avg)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 xl:block">
                      <span className="text-[10px] uppercase tracking-[0.12em] text-white/30 xl:block">p95 / p99</span>
                      <span className={`text-sm font-medium tabular-nums ${isVerySlow ? "text-red-100" : isSlow ? "text-amber-100" : "text-white/80"}`}>
                        {formatMs(route.p95)} · {formatMs(route.p99)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 xl:block">
                      <span className="text-[10px] uppercase tracking-[0.12em] text-white/30 xl:block">5xx</span>
                      <span className={`text-sm font-medium tabular-nums ${route.error_rate > 0 ? "text-red-100" : "text-white/65"}`}>
                        {formatRouteErrorRate(route.error_rate)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-[132px] items-center justify-center text-sm text-white/30">
              No route latency samples yet
            </div>
          )}
        </div>
      </div>
    </OpsPanel>
  );
}

function PlaybackTranscodingOverview({
  delivery,
  durationSummary,
  completedSummary,
  failedSummary,
}: {
  delivery: PlaybackDeliverySnapshot | undefined;
  durationSummary: MetricSummary | undefined;
  completedSummary: MetricSummary | undefined;
  failedSummary: MetricSummary | undefined;
}) {
  const stats = delivery?.stats;
  const runtime = delivery?.runtime;
  const variantsTotal = Math.max(1, stats?.variants ?? 0);
  const statuses = [
    { label: "Ready", value: stats?.ready ?? 0, color: "bg-emerald-400" },
    { label: "Running", value: stats?.running ?? 0, color: "bg-cyan-400" },
    { label: "Pending", value: stats?.pending ?? 0, color: "bg-amber-400" },
    { label: "Failed", value: stats?.failed ?? 0, color: "bg-red-400" },
    { label: "Missing", value: stats?.missing ?? 0, color: "bg-white/35" },
  ];
  const completed = completedSummary?.count ?? 0;
  const failed = failedSummary?.count ?? 0;
  const failRate = completed + failed > 0 ? (failed / (completed + failed)) * 100 : 0;
  const avgTranscode = durationSummary && durationSummary.count > 0 ? `${durationSummary.avg.toFixed(1)}s` : "—";
  const avgPrepare = stats?.avg_prepare_seconds != null ? `${stats.avg_prepare_seconds.toFixed(1)}s` : "—";

  return (
    <OpsPanel
      icon={Headphones}
      title="Playback Transcoding"
      description="Cached AAC delivery coverage, playback worker slots and recent transcode health for Listen."
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <OpsStatTile
            icon={Headphones}
            label="Lossless Coverage"
            value={stats ? `${stats.coverage_percent}%` : "—"}
            caption={stats ? `${stats.ready_tracks.toLocaleString()} / ${stats.lossless_tracks.toLocaleString()} tracks` : "Waiting for cache stats"}
            tone={stats && stats.coverage_percent > 0 ? "success" : "default"}
          />
          <OpsStatTile
            icon={Activity}
            label="Transcode Slots"
            value={`${runtime?.active ?? 0}/${runtime?.limit ?? 1}`}
            caption="Active playback worker capacity"
            tone={(runtime?.active ?? 0) > 0 ? "primary" : "default"}
          />
          <OpsStatTile
            icon={HardDrive}
            label="Cache Size"
            value={formatBytes(stats?.cached_bytes)}
            caption={`${formatBytes(stats?.estimated_saved_bytes)} avoided vs source`}
          />
          <OpsStatTile
            icon={Clock}
            label="Avg Prepare"
            value={avgPrepare}
            caption={`${avgTranscode} worker avg in current metrics window`}
          />
          <OpsStatTile
            icon={AlertTriangle}
            label="Transcode Failures"
            value={`${failRate.toFixed(0)}%`}
            caption={`${failed} failed / ${completed} completed samples`}
            tone={failRate > 5 || (stats?.failed ?? 0) > 0 ? "warning" : "default"}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="rounded-md border border-white/8 bg-black/20 p-4 shadow-[0_16px_36px_rgba(0,0,0,0.16)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white">Variant Status</div>
                <div className="mt-1 text-xs text-white/35">{(stats?.variants ?? 0).toLocaleString()} cached variant records</div>
              </div>
              <CrateChip>{(stats?.variant_tracks ?? 0).toLocaleString()} tracks</CrateChip>
            </div>
            <div className="space-y-3">
              {statuses.map((status) => (
                <ProgressBar
                  key={status.label}
                  value={status.value}
                  max={variantsTotal}
                  color={status.color}
                  label={`${status.label} ${status.value.toLocaleString()}`}
                />
              ))}
            </div>
          </div>

          <div className="rounded-md border border-white/8 bg-black/20 p-4 shadow-[0_16px_36px_rgba(0,0,0,0.16)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white">Recent Variants</div>
                <div className="mt-1 text-xs text-white/35">Latest playback cache writes and retries.</div>
              </div>
              <CrateChip>{(stats?.hires_tracks ?? 0).toLocaleString()} hi-res sources</CrateChip>
            </div>
            <div className="space-y-2">
              {(delivery?.recent_variants ?? []).length > 0 ? (
                delivery?.recent_variants.map((variant) => (
                  <div key={variant.id} className="flex items-center gap-3 rounded-md border border-white/6 bg-white/[0.03] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-white/80">
                        {[variant.artist, variant.title].filter(Boolean).join(" - ") || variant.id}
                      </div>
                      <div className="mt-0.5 text-xs text-white/35">
                        {variant.preset} · {variant.delivery_format} {variant.delivery_bitrate}k · {formatBytes(variant.bytes)}
                      </div>
                    </div>
                    <CrateChip
                      className={
                        variant.status === "ready"
                          ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-100"
                          : variant.status === "failed"
                            ? "border-red-500/20 bg-red-500/[0.08] text-red-100"
                            : "border-amber-500/20 bg-amber-500/[0.06] text-amber-100"
                      }
                    >
                      {variant.status}
                    </CrateChip>
                  </div>
                ))
              ) : (
                <div className="flex min-h-[118px] items-center justify-center text-sm text-white/30">
                  No playback variants prepared yet
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </OpsPanel>
  );
}

export function SystemHealth() {
  const [period, setPeriod] = useState<Period>("minute");
  const minutes = period === "minute" ? 60 : 1440;

  const { data: dashboard, refetch: refetchDashboard } = useApi<SystemHealthDashboardResponse>(
    `/api/admin/metrics/dashboard?period=${period}&minutes=${minutes}`,
  );

  const summary = dashboard?.summary ?? null;
  const system = dashboard?.system ?? null;
  const tasks = dashboard?.tasks ?? [];
  const latencyTs = dashboard?.timeseries?.["api.latency"] ?? [];
  const requestsTs = dashboard?.timeseries?.["api.requests"] ?? [];
  const errorsTs = dashboard?.timeseries?.["api.errors"] ?? [];
  const apiSlowTs = dashboard?.timeseries?.["api.slow"] ?? [];
  const streamTs = dashboard?.timeseries?.["stream.requests"] ?? [];
  const transcodeDurationTs = dashboard?.timeseries?.["stream.transcode.duration"] ?? [];
  const homeComputeTs = dashboard?.timeseries?.["home.compute.ms"] ?? [];
  const homeEndpointComputeTs = dashboard?.timeseries?.["home.endpoint_compute.ms"] ?? [];
  const queueTs = dashboard?.timeseries?.["worker.queue.depth"] ?? [];
  const taskDurationTs = dashboard?.timeseries?.["worker.task.duration"] ?? [];
  const queueWaitTs = dashboard?.timeseries?.["worker.queue.wait"] ?? [];
  const resourceDeferredTs = dashboard?.timeseries?.["worker.resource.deferred"] ?? [];
  const resourceLoadTs = dashboard?.timeseries?.["worker.resource.load_ratio"] ?? [];
  const playbackDelivery = dashboard?.playback_delivery;
  const routeLatency = dashboard?.route_latency ?? [];

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
    if (system?.resource_pressure && !system.resource_pressure.allowed) next -= 10;
    return Math.max(0, next);
  }, [summary, system]);

  const errorRate =
    summary && summary.api_requests.count > 0
      ? (summary.api_errors.count / summary.api_requests.count * 100).toFixed(2)
      : "0";
  const homeCacheTotal = (summary?.home_cache_hit.count ?? 0) + (summary?.home_cache_miss.count ?? 0);
  const homeCacheHitRate =
    homeCacheTotal > 0 ? ((summary?.home_cache_hit.count ?? 0) / homeCacheTotal) * 100 : 0;
  const homeEndpointCacheTotal =
    (summary?.home_endpoint_cache_hit.count ?? 0) + (summary?.home_endpoint_cache_miss.count ?? 0);
  const homeEndpointCacheHitRate =
    homeEndpointCacheTotal > 0
      ? ((summary?.home_endpoint_cache_hit.count ?? 0) / homeEndpointCacheTotal) * 100
      : 0;

  const scoreSummary =
    score >= 80
      ? "Core services look stable and current pressure is within healthy bounds."
      : score >= 50
        ? "The system is usable, but latency or load deserve attention before they become user-facing."
        : "Health is degraded enough to warrant immediate triage on latency, queue pressure or database usage.";

  const runningTasks = tasks.length;
  const queueDepth =
    queueTs.length
      ? queueTs[queueTs.length - 1]?.max ?? 0
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
            <ActionIconButton variant="card" onClick={() => refetchDashboard()} title="Refresh metrics">
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
        {summary && homeCacheTotal > 0 ? <CrateChip>{homeCacheHitRate.toFixed(0)}% home core hit</CrateChip> : null}
        {summary && homeEndpointCacheTotal > 0 ? (
          <CrateChip>{homeEndpointCacheHitRate.toFixed(0)}% home endpoint hit</CrateChip>
        ) : null}
        {playbackDelivery?.stats ? (
          <CrateChip icon={Headphones}>{playbackDelivery.stats.coverage_percent}% playback coverage</CrateChip>
        ) : null}
        {summary?.worker_resource_deferred?.count ? (
          <CrateChip icon={Gauge}>{summary.worker_resource_deferred.count} batch deferrals</CrateChip>
        ) : null}
        {system?.resource_pressure ? (
          <CrateChip
            icon={Gauge}
            className={
              system.resource_pressure.allowed
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
                : "border-amber-500/25 bg-amber-500/10 text-amber-100"
            }
          >
            {system.resource_pressure.allowed ? "Batch open" : "Batch deferred"}
          </CrateChip>
        ) : null}
      </OpsPageHero>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_repeat(6,minmax(0,1fr))]">
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
          icon={Clock}
          label="Slow Requests"
          value={summary ? `${summary.api_slow.count}` : "—"}
          caption={
            summary
              ? `${summary.api_slow.count} requests over 1s in the current window`
              : "Waiting for metrics"
          }
          tone={summary && summary.api_slow.count > 0 ? "warning" : "default"}
        />
        <OpsStatTile
          icon={Radio}
          label="Home Core Cache"
          value={homeCacheTotal > 0 ? `${homeCacheHitRate.toFixed(0)}%` : "—"}
          caption={
            summary
              ? `${summary.home_cache_hit.count} hits, ${summary.home_cache_miss.count} misses`
              : "Waiting for metrics"
          }
          tone="default"
        />
        <OpsStatTile
          icon={Radio}
          label="Home Endpoint Cache"
          value={homeEndpointCacheTotal > 0 ? `${homeEndpointCacheHitRate.toFixed(0)}%` : "—"}
          caption={
            summary
              ? `${summary.home_endpoint_cache_hit.count} hits, ${summary.home_endpoint_cache_miss.count} misses`
              : "Waiting for metrics"
          }
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

      <RouteLatencyOverview routes={routeLatency} />

      <PlaybackTranscodingOverview
        delivery={playbackDelivery}
        durationSummary={summary?.stream_transcode_duration}
        completedSummary={summary?.stream_transcode_completed}
        failedSummary={summary?.stream_transcode_failed}
      />

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
                label="DB Pools"
                value={`${system.db_pool.checked_out} / ${system.db_pool.size + (system.db_pool.overflow > 0 ? system.db_pool.overflow : 0)}`}
              >
                <ProgressBar
                  value={system.db_pool.checked_out}
                  max={system.db_pool.size}
                  color={system.db_pool.checked_out >= system.db_pool.size ? "bg-red-500" : "bg-primary"}
                  label={`${system.db_pool.checked_in} idle, ${system.db_pool.checked_out} active`}
                />
                {system.db_pools?.sqlalchemy?.size ? (
                  <div className="text-[10px] text-white/30">
                    SQLAlchemy: {system.db_pools.sqlalchemy.checked_out}/{system.db_pools.sqlalchemy.size}
                    {" "}checked out
                  </div>
                ) : null}
                {system.db_pools?.legacy?.size ? (
                  <div className="text-[10px] text-white/30">
                    Legacy: {system.db_pools.legacy.checked_out}/{system.db_pools.legacy.size}
                    {" "}checked out
                  </div>
                ) : null}
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

            {system.resource_pressure ? (
              <ResourceCard
                icon={Gauge}
                label="Resource Governor"
                value={system.resource_pressure.allowed ? "Open" : "Deferring"}
              >
                <ProgressBar
                  value={(system.resource_pressure.snapshot?.load_ratio ?? 0) * 100}
                  max={100}
                  color={system.resource_pressure.allowed ? "bg-primary" : "bg-amber-500"}
                  label={
                    system.resource_pressure.reason
                      ? system.resource_pressure.reason
                      : "No batch pressure detected"
                  }
                />
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-white/35">
                  <span>IO wait: {system.resource_pressure.snapshot?.iowait_percent ?? "—"}%</span>
                  <span>Swap: {system.resource_pressure.snapshot?.swap_used_percent ?? "—"}%</span>
                  <span>Listeners: {system.resource_pressure.snapshot?.active_users ?? "—"}</span>
                  <span>Streams: {system.resource_pressure.snapshot?.active_streams ?? "—"}</span>
                </div>
                {system.resource_pressure.window?.enabled ? (
                  <div className="text-[10px] text-white/30">
                    Window {system.resource_pressure.window.start}-{system.resource_pressure.window.end}
                    {" · "}
                    {system.resource_pressure.window.in_window ? "inside" : "outside"}
                  </div>
                ) : null}
              </ResourceCard>
            ) : null}

            {system.media_worker ? (
              <ResourceCard
                icon={Radio}
                label="Media Worker"
                value={
                  system.media_worker.redis_connected
                    ? `${system.media_worker.active_slots?.length ?? 0} / ${system.media_worker.max_active ?? 1} active`
                    : "Redis offline"
                }
              >
                <ProgressBar
                  value={system.media_worker.active_slots?.length ?? 0}
                  max={Math.max(1, system.media_worker.max_active ?? 1)}
                  color={system.media_worker.pending > 0 ? "bg-amber-500" : "bg-primary"}
                  label={`${system.media_worker.pending ?? 0} pending bridge events`}
                />
                <div className="text-[10px] text-white/30">
                  {system.media_worker.recent_events?.[0]?.event
                    ? `Latest: ${String(system.media_worker.recent_events[0].event).replace(/_/g, " ")}`
                    : system.media_worker.consumer_group}
                </div>
                {summary?.media_worker_completed ? (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-white/35">
                    <span>Done: {summary.media_worker_completed.count}</span>
                    <span>Failed: {summary.media_worker_failed?.count ?? 0}</span>
                    <span>Denied: {summary.media_worker_admission_denied?.count ?? 0}</span>
                    <span>Pruned: {formatBytes(summary.media_worker_cache_bytes_removed?.sum ?? 0)}</span>
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
          <MetricChart title="API Latency" data={latencyTs} yLabel="ms" />
          <MetricChart title="Request Volume" data={requestsTs} yLabel="req" />
          <MetricChart
            title="Error Rate"
            data={errorsTs}
            yLabel="errors"
            series={[{ id: "errors", field: "count" }]}
          />
          <MetricChart
            title="Slow Requests"
            data={apiSlowTs}
            yLabel="slow"
            series={[{ id: "slow", field: "count" }]}
          />
          <MetricChart title="Stream Activity" data={streamTs} yLabel="streams" />
          <MetricChart title="Transcode Duration" data={transcodeDurationTs} yLabel="sec" />
          <MetricChart title="Home Core Compute" data={homeComputeTs} yLabel="ms" />
          <MetricChart title="Home Endpoint Compute" data={homeEndpointComputeTs} yLabel="ms" />
          <MetricChart title="Task Duration" data={taskDurationTs} yLabel="sec" />
          <MetricChart title="Queue Wait Time" data={queueWaitTs} yLabel="sec" />
          <MetricChart title="Queue Depth" data={queueTs} yLabel="tasks" />
          <MetricChart
            title="Resource Deferrals"
            data={resourceDeferredTs}
            yLabel="deferrals"
            series={[{ id: "deferred", field: "count" }]}
          />
          <MetricChart title="Resource Load Ratio" data={resourceLoadTs} yLabel="ratio" />
        </div>
      </OpsPanel>

      {tasks.length > 0 ? (
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
