import { useMemo, useState } from "react";
import { ResponsiveLine } from "@nivo/line";
import { Activity, HardDrive, Cpu, Radio, Gauge, RefreshCw } from "lucide-react";

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

type Period = "minute" | "hour";

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 80 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-red-400";
  const bg = score >= 80 ? "border-emerald-400/30" : score >= 50 ? "border-amber-400/30" : "border-red-400/30";
  return (
    <div className={`flex items-center gap-3 rounded-xl border ${bg} bg-white/[0.02] px-5 py-4`}>
      <Gauge size={24} className={color} />
      <div>
        <div className={`text-3xl font-bold tabular-nums ${color}`}>{score}</div>
        <div className="text-[11px] text-white/40 uppercase tracking-wider">Health Score</div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub }: {
  icon: typeof Activity; label: string; value: string; sub?: string;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] text-white/40 uppercase tracking-wider mb-1">
        <Icon size={12} />
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
      {sub && <div className="text-[11px] text-white/40 mt-0.5">{sub}</div>}
    </div>
  );
}

function MetricChart({ title, data, yLabel }: { title: string; data: TimeseriesPoint[]; yLabel: string }) {
  const chartData = useMemo(() => {
    if (!data?.length) return [];
    return [{
      id: "avg",
      data: data.map((p) => ({
        x: new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        y: p.avg,
      })),
    }, {
      id: "max",
      data: data.map((p) => ({
        x: new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        y: p.max,
      })),
    }];
  }, [data]);

  if (!chartData.length) {
    return (
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
        <div className="text-sm font-medium text-foreground mb-2">{title}</div>
        <div className="flex h-48 items-center justify-center text-sm text-white/30">No data yet</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
      <div className="text-sm font-medium text-foreground mb-2">{title}</div>
      <div className="h-48">
        <ResponsiveLine
          data={chartData}
          margin={{ top: 8, right: 16, bottom: 32, left: 48 }}
          xScale={{ type: "point" }}
          yScale={{ type: "linear", min: 0, max: "auto" }}
          curve="monotoneX"
          colors={["#06b6d4", "rgba(6,182,212,0.3)"]}
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
          }}
          axisBottom={{
            tickSize: 0,
            tickPadding: 8,
            tickValues: 6,
          }}
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
            <div className="rounded-lg bg-black/90 border border-white/10 px-3 py-2 text-xs">
              {slice.points.map((p) => (
                <div key={p.id} className="text-white/80">
                  {p.seriesId}: <span className="font-semibold text-cyan-300">{typeof p.data.y === 'number' ? (p.data.y as number).toFixed(1) : p.data.y}</span>
                </div>
              ))}
            </div>
          )}
        />
      </div>
    </div>
  );
}

export function SystemHealth() {
  const [period, setPeriod] = useState<Period>("minute");
  const minutes = period === "minute" ? 60 : 1440;

  const { data: summary, refetch: refetchSummary } = useApi<MetricsSummaryResponse>("/api/admin/metrics/summary");
  const { data: latencyTs } = useApi<TimeseriesResponse>(`/api/admin/metrics/timeseries?name=api.latency&period=${period}&minutes=${minutes}`);
  const { data: requestsTs } = useApi<TimeseriesResponse>(`/api/admin/metrics/timeseries?name=api.requests&period=${period}&minutes=${minutes}`);
  const { data: streamTs } = useApi<TimeseriesResponse>(`/api/admin/metrics/timeseries?name=stream.requests&period=${period}&minutes=${minutes}`);
  const { data: queueTs } = useApi<TimeseriesResponse>(`/api/admin/metrics/timeseries?name=worker.queue.depth&period=${period}&minutes=${minutes}`);
  const { data: tasks } = useApi<ActiveTask[]>("/api/tasks?status=running&limit=10");

  const score = useMemo(() => {
    if (!summary) return 100;
    let s = 100;
    if (summary.api_latency.max > 3000) s -= 15;
    if (summary.api_errors.count > 0 && summary.api_requests.count > 0) {
      const errRate = summary.api_errors.count / summary.api_requests.count;
      if (errRate > 0.05) s -= 20;
      else if (errRate > 0.01) s -= 5;
    }
    return Math.max(0, s);
  }, [summary]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity size={24} className="text-primary" />
          <h1 className="text-2xl font-bold">System Health</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-card p-0.5 text-xs">
            <button
              onClick={() => setPeriod("minute")}
              className={`rounded-md px-3 py-1.5 transition-colors ${period === "minute" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              1h
            </button>
            <button
              onClick={() => setPeriod("hour")}
              className={`rounded-md px-3 py-1.5 transition-colors ${period === "hour" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              24h
            </button>
          </div>
          <button
            onClick={() => refetchSummary()}
            className="rounded-lg border border-border bg-card p-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Score + Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <ScoreGauge score={score} />
        <StatCard
          icon={Activity}
          label="API p95"
          value={summary ? `${summary.api_latency.max.toFixed(0)}ms` : "—"}
          sub={summary ? `avg ${summary.api_latency.avg.toFixed(0)}ms` : undefined}
        />
        <StatCard
          icon={Radio}
          label="Streams"
          value={summary ? `${summary.stream_requests.count}` : "—"}
          sub="last 5 min"
        />
        <StatCard
          icon={Cpu}
          label="Queue"
          value={summary ? `${summary.api_requests.count} req` : "—"}
          sub={summary?.api_errors.count ? `${summary.api_errors.count} errors` : "no errors"}
        />
        <StatCard
          icon={HardDrive}
          label="Tasks"
          value={tasks ? `${tasks.length} running` : "—"}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <MetricChart title="API Latency" data={latencyTs?.data ?? []} yLabel="ms" />
        <MetricChart title="Request Volume" data={requestsTs?.data ?? []} yLabel="req" />
        <MetricChart title="Stream Activity" data={streamTs?.data ?? []} yLabel="streams" />
        <MetricChart title="Queue Depth" data={queueTs?.data ?? []} yLabel="tasks" />
      </div>

      {/* Running Tasks */}
      {tasks && tasks.length > 0 && (
        <div>
          <h2 className="font-semibold mb-3">Running Tasks</h2>
          <div className="space-y-2">
            {tasks.map((t) => {
              let progress = null;
              try {
                progress = typeof t.progress === "string" ? JSON.parse(t.progress) : t.progress;
              } catch { /* ignore */ }
              const pct = progress?.percent ?? (progress?.done && progress?.total ? (progress.done / progress.total * 100) : 0);

              return (
                <div key={t.id} className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/[0.02] px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground">{t.label || taskLabel(t.type)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {progress?.phase && <span>{progress.phase}</span>}
                      {progress?.item && <span> — {progress.item}</span>}
                    </div>
                  </div>
                  {pct > 0 && (
                    <div className="w-32 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] tabular-nums text-white/40 w-8 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  )}
                  <span className="text-[10px] font-mono text-white/30">{t.id.slice(0, 8)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
