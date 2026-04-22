import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  Activity,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  Filter,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Zap,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { OpsPageHero, OpsPanel, OpsStatTile } from "@/components/admin/ops-surfaces";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CrateChip, CratePill } from "@crate/ui/primitives/CrateBadge";
import { Button } from "@crate/ui/shadcn/button";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { Input } from "@crate/ui/shadcn/input";
import { Progress } from "@crate/ui/shadcn/progress";
import { useApi } from "@/hooks/use-api";
import { useTaskEvents } from "@/hooks/use-task-events";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import { taskLabel } from "@/lib/task-labels";

interface TaskProgress {
  phase?: string;
  phase_index?: number;
  phase_count?: number;
  item?: string;
  done?: number;
  total?: number;
  percent?: number;
  rate?: number;
  eta_sec?: number;
  errors?: number;
  warnings?: number;
  artist?: string;
  album?: string;
  step?: string;
  message?: string;
  track?: string;
  [key: string]: unknown;
}

interface Task {
  id: string;
  type: string;
  status: string;
  label?: string;
  progress: TaskProgress | string;
  error: string | null;
  params: Record<string, string> | null;
  result: Record<string, unknown> | null;
  priority?: number | null;
  pool?: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
}

interface WorkerStatusResponse {
  engine: string;
  running: number;
  pending: number;
  running_tasks: { id: string; type: string; pool?: string | null }[];
  pending_tasks: { id: string; type: string; pool?: string | null }[];
}

interface SettingsSnapshot {
  worker?: {
    max_workers: number;
  };
}

const STATUS_META: Record<string, { icon: typeof Clock; label: string; pill: string; iconClass: string; cardClass: string }> = {
  running: {
    icon: Loader2,
    label: "Running",
    pill: "border-cyan-400/25 bg-cyan-400/10 text-cyan-100",
    iconClass: "text-primary",
    cardClass: "border-cyan-400/12 bg-cyan-400/[0.04]",
  },
  pending: {
    icon: Clock,
    label: "Pending",
    pill: "border-amber-500/25 bg-amber-500/10 text-amber-100",
    iconClass: "text-amber-200",
    cardClass: "border-amber-500/12 bg-amber-500/[0.04]",
  },
  completed: {
    icon: CheckCircle2,
    label: "Completed",
    pill: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
    iconClass: "text-emerald-200",
    cardClass: "border-white/8 bg-black/15",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    pill: "border-red-500/25 bg-red-500/10 text-red-100",
    iconClass: "text-red-200",
    cardClass: "border-red-500/12 bg-red-500/[0.04]",
  },
  cancelled: {
    icon: Ban,
    label: "Cancelled",
    pill: "border-white/10 bg-white/[0.04] text-white/55",
    iconClass: "text-white/45",
    cardClass: "border-white/8 bg-black/15",
  },
};

function getStatusMeta(status: string) {
  return STATUS_META[status] ?? {
    icon: Clock,
    label: status,
    pill: "border-white/10 bg-white/[0.04] text-white/60",
    iconClass: "text-white/50",
    cardClass: "border-white/8 bg-black/15",
  };
}

function getTaskLabel(task: Task): string {
  const base = task.label || taskLabel(task.type);
  const params = task.params;
  if (!params) return base;
  if (params.artist && params.album) return `${base}: ${params.artist} / ${params.album}`;
  if (params.artist) return `${base}: ${params.artist}`;
  if (params.name) return `${base}: ${params.name}`;
  if (params.artist_folder && params.album_folder) return `${base}: ${params.artist_folder} / ${params.album_folder}`;
  return base;
}

function describeResult(task: Task): string {
  if (task.error) return task.error.length > 120 ? `${task.error.slice(0, 120)}…` : task.error;
  const result = task.result;
  if (!result) return task.status === "completed" ? "Completed" : "";

  const type = task.type;

  if (type === "process_new_content") {
    const steps = result.steps as Record<string, unknown> | undefined;
    if (steps) {
      const done = Object.entries(steps).filter(([, value]) => value !== "failed" && value !== false).length;
      const failed = Object.entries(steps).filter(([, value]) => value === "failed").length;
      return `${done} steps done${failed ? `, ${failed} failed` : ""}`;
    }
  }

  if (type === "enrich_artist") {
    if (result.skipped) return "Skipped (recently enriched)";
    return "Artist enriched";
  }

  if (type === "enrich_artists" || type === "enrich_mbids") {
    const parts: string[] = [];
    if (result.enriched) parts.push(`${result.enriched} enriched`);
    if (result.skipped) parts.push(`${result.skipped} skipped`);
    if (result.failed) parts.push(`${result.failed} failed`);
    return parts.join(", ") || "Done";
  }

  if (type === "analyze_tracks" || type === "analyze_all") {
    return `${result.analyzed ?? 0} tracks analyzed${result.failed ? `, ${result.failed} failed` : ""}`;
  }

  if (type === "compute_bliss") {
    return `${result.analyzed ?? 0} tracks vectorized${result.failed ? `, ${result.failed} failed` : ""}`;
  }

  if (type === "compute_popularity") {
    const parts: string[] = [];
    if (result.albums) parts.push(`${result.albums} albums`);
    if (result.tracks) parts.push(`${result.tracks} tracks`);
    return parts.join(", ") || "Done";
  }

  if (type === "health_check") return `${result.issue_count ?? 0} issues found`;
  if (type === "repair") {
    const actions = (result.actions as unknown[])?.length ?? 0;
    return `${actions} actions${result.fs_changed ? " (filesystem modified)" : ""}`;
  }

  if (type === "library_sync" || type === "library_pipeline") {
    const parts: string[] = [];
    if (result.artists_added) parts.push(`+${result.artists_added} artists`);
    if (result.tracks_total) parts.push(`${result.tracks_total} tracks`);
    return parts.join(", ") || "Synced";
  }

  if (type === "match_apply") return `${result.updated ?? 0}/${result.total ?? "?"} tracks tagged`;
  if (type === "delete_artist" || type === "delete_album") return "Deleted";
  if (type === "compute_analytics") return "Analytics computed";
  if (type === "tidal_download") return result.error ? String(result.error) : "Downloaded";

  const keys = Object.keys(result);
  if (keys.length === 0) return "Done";
  if (keys.length <= 3) return keys.map((key) => `${key}: ${JSON.stringify(result[key])}`).join(", ");
  return `${keys.length} fields`;
}

function formatDuration(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function ProgressSummary({ progress }: { progress: TaskProgress | string }) {
  if (typeof progress === "string") {
    return progress ? <div className="text-xs text-white/40">{progress}</div> : null;
  }

  const done = Number(progress.done ?? 0);
  const total = Number(progress.total ?? 0);
  const percent = progress.percent != null ? Number(progress.percent) : total > 0 ? Math.round((done / total) * 100) : 0;

  if (total > 0) {
    return (
      <div className="space-y-2">
        <Progress value={percent} className="h-1.5" />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/40">
          <div className="flex flex-wrap items-center gap-2">
            {progress.phase ? <CrateChip>{String(progress.phase)}</CrateChip> : null}
            {progress.item ? <span className="text-white/65">{String(progress.item)}</span> : null}
            {!progress.item && progress.artist ? <span className="text-white/65">{String(progress.artist)}</span> : null}
          </div>
          <div className="tabular-nums">
            {done}/{total} ({percent}%)
            {progress.rate != null && Number(progress.rate) > 0 ? <span className="ml-2 text-white/25">{Number(progress.rate).toFixed(1)}/s</span> : null}
            {progress.eta_sec != null && Number(progress.eta_sec) > 0 ? <span className="ml-2 text-white/25">ETA {Number(progress.eta_sec)}s</span> : null}
          </div>
        </div>
      </div>
    );
  }

  if (progress.step) return <div className="text-xs text-white/40">Step: {String(progress.step).replace(/_/g, " ")}</div>;
  if (progress.message) return <div className="text-xs text-white/40">{String(progress.message)}</div>;
  return null;
}

const EVENT_BADGE_COLORS: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  warning: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  error: "bg-red-500/10 text-red-400 border-red-500/30",
  artist_enriched: "bg-green-500/10 text-green-400 border-green-500/30",
  artist_skipped: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  track_analyzed: "bg-primary/10 text-primary border-primary/30",
  album_matched: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  cover_found: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  cover_applied: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  new_release_found: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  step_done: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
};

function eventMessage(event: { type: string; data?: Record<string, unknown> }) {
  if (event.data?.message) return String(event.data.message);
  if (event.data?.step) return String(event.data.step).replace(/_/g, " ");
  if (event.data) {
    const keys = Object.keys(event.data);
    if (keys.length <= 3) return keys.map((key) => `${key}: ${event.data![key]}`).join(", ");
  }
  return event.type.replace(/_/g, " ");
}

function LiveTaskEvents({ taskId }: { taskId: string }) {
  const { events, connected } = useTaskEvents(taskId);

  if (events.length === 0) {
    return <div className="py-3 text-xs text-white/40">{connected ? "Waiting for live events…" : "Connecting to task stream…"}</div>;
  }

  return (
    <div className="max-h-[280px] space-y-1 overflow-y-auto py-3 font-mono">
      {events.map((event, index) => (
        <div key={`${taskId}-${index}`} className="flex items-start gap-2 text-xs">
          <span className="w-16 shrink-0 text-[10px] text-white/20">
            {new Date(event.timestamp || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <CrateChip className={EVENT_BADGE_COLORS[event.type] || "border-white/10 bg-white/[0.04] text-white/60"}>{event.type.replace(/_/g, " ")}</CrateChip>
          <span className="text-white/70">{eventMessage(event)}</span>
        </div>
      ))}
    </div>
  );
}

function WorkerControlPanel({
  running,
  pending,
}: {
  running: number;
  pending: number;
}) {
  const [workerInfo, setWorkerInfo] = useState<WorkerStatusResponse | null>(null);
  const [slotLimit, setSlotLimit] = useState(3);
  const [restarting, setRestarting] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchWorker() {
      try {
        const [status, settings] = await Promise.all([
          api<WorkerStatusResponse>("/api/worker/status"),
          api<SettingsSnapshot>("/api/settings").catch(() => ({} as SettingsSnapshot)),
        ]);
        if (cancelled) return;
        setWorkerInfo(status);
        if (settings.worker?.max_workers) setSlotLimit(settings.worker.max_workers);
      } catch {
        // ignore transient worker polling failures
      }
    }

    fetchWorker();
    const timer = setInterval(fetchWorker, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function setSlots(next: number) {
    try {
      await api("/api/worker/slots", "POST", { slots: next });
      setSlotLimit(next);
      toast.success(`Worker slots set to ${next}`);
    } catch {
      toast.error("Failed to update worker slots");
    }
  }

  async function restartWorker() {
    setRestarting(true);
    try {
      await api("/api/worker/restart", "POST");
      toast.success("Worker restarting…");
    } catch {
      toast.error("Worker restart failed");
    } finally {
      setTimeout(() => setRestarting(false), 5000);
    }
  }

  async function cancelAll() {
    try {
      const response = await api<{ cancelled: number }>("/api/worker/cancel-all", "POST");
      toast.success(`Cancelled ${response.cancelled} tasks`);
    } catch {
      toast.error("Failed to cancel tasks");
    }
  }

  async function toggleLogs() {
    if (showLogs) {
      setShowLogs(false);
      return;
    }
    setShowLogs(true);
    setLogsLoading(true);
    try {
      const response = await api<{ name: string; logs: string }>("/api/stack/container/crate-worker/logs?tail=40");
      setLogs(response.logs);
    } catch {
      setLogs("Failed to load worker logs");
    } finally {
      setLogsLoading(false);
    }
  }

  const activeTasks = workerInfo?.running_tasks ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CrateChip active>{workerInfo?.engine || "dramatiq"}</CrateChip>
          <CrateChip>{running} running</CrateChip>
          <CrateChip>{pending} pending</CrateChip>
          <CrateChip>{slotLimit} slots</CrateChip>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-white/10 bg-black/20 p-1">
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setSlots(Math.max(1, slotLimit - 1))} disabled={slotLimit <= 1}>
              <Minus size={12} />
            </Button>
            <span className="w-8 text-center text-sm font-medium text-white/80">{slotLimit}</span>
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setSlots(Math.min(10, slotLimit + 1))} disabled={slotLimit >= 10}>
              <Plus size={12} />
            </Button>
          </div>
          <Button size="sm" variant="outline" className="gap-2" onClick={toggleLogs}>
            <Cpu size={14} />
            {showLogs ? "Hide logs" : "Worker logs"}
          </Button>
          <Button size="sm" variant="outline" className="gap-2 text-red-200" onClick={cancelAll}>
            <Ban size={14} />
            Cancel all
          </Button>
          <Button size="sm" variant="outline" className="gap-2" onClick={restartWorker} disabled={restarting}>
            {restarting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            Restart
          </Button>
        </div>
      </div>

      <div className="flex gap-1">
        {Array.from({ length: slotLimit }, (_, index) => {
          const task = activeTasks[index];
          return (
            <div
              key={`slot-${index}`}
              className={cn(
                "flex h-9 flex-1 items-center justify-center rounded-sm border px-2 text-[11px] transition-colors",
                task
                  ? "border-primary/25 bg-primary/10 text-primary"
                  : "border-white/8 bg-black/15 text-white/30",
              )}
              title={task ? `${taskLabel(task.type)}${task.pool ? ` · ${task.pool}` : ""}` : "Idle slot"}
            >
              <span className="truncate">{task ? taskLabel(task.type) : "idle"}</span>
            </div>
          );
        })}
      </div>

      {showLogs ? (
        <div className="rounded-md border border-white/8 bg-[#06080c] px-4 py-4">
          {logsLoading ? (
            <div className="flex items-center gap-2 text-sm text-white/45">
              <Loader2 size={14} className="animate-spin text-primary" />
              Loading worker logs…
            </div>
          ) : (
            <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-white/55">
              {logs || "No logs available"}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ActiveTaskCard({
  task,
  expanded,
  onExpand,
  onCancel,
}: {
  task: Task;
  expanded: boolean;
  onExpand: () => void;
  onCancel: () => void;
}) {
  const status = getStatusMeta(task.status);
  const Icon = status.icon;

  return (
    <div className={cn("overflow-hidden rounded-md border p-4", status.cardClass)}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04]">
              <Icon size={16} className={cn(status.iconClass, task.status === "running" && "animate-spin")} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">{getTaskLabel(task)}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/40">
                <CrateChip className={status.pill}>{status.label}</CrateChip>
                {task.pool ? <CrateChip>{task.pool}</CrateChip> : null}
                <span>{task.status === "running" && task.started_at ? `Running for ${formatDuration(task.started_at, new Date().toISOString())}` : `Queued ${timeAgo(task.created_at)}`}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {task.status === "running" ? (
              <Button size="sm" variant="outline" className="gap-2" onClick={onExpand}>
                <Zap size={13} />
                {expanded ? "Hide live" : "Live events"}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" className="gap-2 text-red-200" onClick={onCancel}>
              <Ban size={13} />
              Cancel
            </Button>
          </div>
        </div>

        <ProgressSummary progress={task.progress} />
      </div>

      {expanded && task.status === "running" ? (
        <div className="mt-4 border-t border-white/8 pt-3">
          <LiveTaskEvents taskId={task.id} />
        </div>
      ) : null}
    </div>
  );
}

function HistoryTaskRow({
  task,
  expanded,
  onToggle,
  onRetry,
}: {
  task: Task;
  expanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
}) {
  const status = getStatusMeta(task.status);
  const Icon = status.icon;
  const summary = describeResult(task);

  return (
    <div className={cn("overflow-hidden rounded-md border", status.cardClass)}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
      >
        <Icon size={14} className={status.iconClass} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-white">{getTaskLabel(task)}</span>
            <CrateChip className={status.pill}>{status.label}</CrateChip>
          </div>
          <div className="mt-1 truncate text-xs text-white/40">{summary || "No summary available"}</div>
        </div>
        <div className="hidden text-xs text-white/35 sm:block">
          {formatDuration(task.started_at || task.created_at, task.updated_at)}
        </div>
        <div className="hidden text-xs text-white/35 xl:block">{timeAgo(task.updated_at)}</div>
        {task.status === "failed" ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-white/45 hover:text-white"
            onClick={(event) => {
              event.stopPropagation();
              onRetry();
            }}
            title="Retry task"
          >
            <RotateCcw size={12} />
          </Button>
        ) : null}
        {expanded ? <ChevronUp size={14} className="text-white/35" /> : <ChevronDown size={14} className="text-white/35" />}
      </button>

      {expanded ? (
        <div className="space-y-3 border-t border-white/8 bg-black/15 px-4 py-4">
          <div className="grid gap-2 text-xs text-white/45 sm:grid-cols-2 xl:grid-cols-4">
            <div><span className="text-white/28">ID:</span> <span className="font-mono text-white/70">{task.id}</span></div>
            <div><span className="text-white/28">Type:</span> <span className="font-mono text-white/70">{task.type}</span></div>
            <div><span className="text-white/28">Created:</span> <span className="text-white/70">{new Date(task.created_at).toLocaleString()}</span></div>
            <div><span className="text-white/28">Duration:</span> <span className="text-white/70">{formatDuration(task.started_at || task.created_at, task.updated_at)}</span></div>
          </div>

          {task.params && Object.keys(task.params).length > 0 ? (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-white/35">Params</div>
              <pre className="overflow-x-auto rounded-sm border border-white/6 bg-black/20 p-3 text-xs text-white/60">{JSON.stringify(task.params, null, 2)}</pre>
            </div>
          ) : null}

          {task.error ? (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-red-200">Error</div>
              <pre className="overflow-x-auto rounded-sm border border-red-500/12 bg-red-500/[0.05] p-3 text-xs text-red-100">{task.error}</pre>
            </div>
          ) : null}

          {task.result ? (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-white/35">Result</div>
              <pre className="max-h-[320px] overflow-auto rounded-sm border border-white/6 bg-black/20 p-3 text-xs text-white/60">{JSON.stringify(task.result, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Tasks() {
  const { data: tasks, loading, error, refetch } = useApi<Task[]>("/api/tasks?limit=100");
  const [searchParams] = useSearchParams();
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const hasActive = tasks?.some((task) => task.status === "running" || task.status === "pending");
    const interval = hasActive ? 2000 : 5000;
    const timer = setInterval(refetch, interval);
    return () => clearInterval(timer);
  }, [tasks, refetch]);

  useEffect(() => {
    const highlightedTask = searchParams.get("task");
    if (highlightedTask && tasks?.some((task) => task.id === highlightedTask)) {
      setExpandedId(highlightedTask);
      setFilterStatus("all");
    }
  }, [searchParams, tasks]);

  async function handleCancel(id: string) {
    try {
      await api(`/api/tasks/${id}/cancel`, "POST");
      toast.success("Task cancelled");
      refetch();
    } catch {
      toast.error("Failed to cancel task");
    } finally {
      setCancelId(null);
    }
  }

  async function handleRetry(task: Task) {
    try {
      await api("/api/tasks/retry", "POST", { task_id: task.id });
      toast.success(`Retrying ${getTaskLabel(task)}`);
      refetch();
    } catch {
      toast.error("Failed to retry task");
    }
  }

  async function cleanupOlder() {
    try {
      const response = await api<{ deleted: number }>("/api/tasks/cleanup", "POST", { older_than_days: 7 });
      toast.success(`Cleaned up ${response.deleted} old tasks`);
      refetch();
    } catch {
      toast.error("Cleanup failed");
    }
  }

  async function cleanStatus(status: "completed" | "failed" | "cancelled") {
    try {
      const response = await api<{ deleted: number }>(`/api/tasks/clean/${status}`, "POST");
      toast.success(`Cleaned ${response.deleted} ${status} tasks`);
      refetch();
    } catch {
      toast.error(`Failed to clean ${status} tasks`);
    }
  }

  const taskTypes = useMemo(() => {
    if (!tasks) return [];
    return Array.from(new Set(tasks.map((task) => task.type))).sort().map((type) => ({
      value: type,
      label: taskLabel(type),
    }));
  }, [tasks]);

  const activeTasks = useMemo(
    () => (tasks ?? []).filter((task) => task.status === "running" || task.status === "pending"),
    [tasks],
  );

  const completedTasks = useMemo(
    () => (tasks ?? []).filter((task) => task.status !== "running" && task.status !== "pending"),
    [tasks],
  );

  const filteredHistory = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return completedTasks.filter((task) => {
      if (filterType !== "all" && task.type !== filterType) return false;
      if (filterStatus !== "all" && task.status !== filterStatus) return false;
      if (!normalized) return true;
      const haystack = `${getTaskLabel(task)} ${task.id} ${task.type} ${JSON.stringify(task.params || {})}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [completedTasks, filterStatus, filterType, search]);

  const visibleActive = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return activeTasks.filter((task) => {
      if (filterType !== "all" && task.type !== filterType) return false;
      if (!normalized) return true;
      const haystack = `${getTaskLabel(task)} ${task.id} ${task.type} ${JSON.stringify(task.params || {})}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [activeTasks, filterType, search]);

  const stats = useMemo(() => {
    if (!tasks) return null;
    const today = new Date().toDateString();
    const todayTasks = tasks.filter((task) => new Date(task.created_at).toDateString() === today);
    const todayCompleted = todayTasks.filter((task) => task.status === "completed").length;
    const todayFailed = todayTasks.filter((task) => task.status === "failed").length;
    const completed = tasks.filter((task) => task.status === "completed").slice(0, 20);
    const avgDurationMs = completed.reduce((sum, task) => (
      sum + (new Date(task.updated_at).getTime() - new Date(task.started_at || task.created_at).getTime())
    ), 0);

    return {
      todayTotal: todayTasks.length,
      todayCompleted,
      todayFailed,
      successRate: todayTasks.length > 0 ? Math.round((todayCompleted / Math.max(todayCompleted + todayFailed, 1)) * 100) : 100,
      avgDurationSec: completed.length > 0 ? Math.round(avgDurationMs / completed.length / 1000) : 0,
    };
  }, [tasks]);

  if (loading && !tasks) {
    return (
      <div className="flex justify-center py-16 text-white/45">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !tasks) {
    return <ErrorState message="Failed to load task orchestration" onRetry={refetch} />;
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        icon={Activity}
        title="Tasks"
        description="Background orchestration for enrichment, analysis, sync, repair and acquisition jobs across the whole stack."
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-2" onClick={cleanupOlder}>
              <Trash2 size={14} />
              Cleanup old
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={refetch}>
              <RefreshCw size={14} />
              Refresh
            </Button>
          </>
        }
      >
        <CratePill active icon={Activity}>{tasks?.length ?? 0} tasks</CratePill>
        <CratePill icon={Loader2}>{activeTasks.length} active</CratePill>
        <CratePill icon={Clock}>{activeTasks.filter((task) => task.status === "pending").length} queued</CratePill>
        <CratePill icon={CheckCircle2}>{tasks?.filter((task) => task.status === "completed").length ?? 0} completed</CratePill>
        <CratePill className="border-red-500/25 bg-red-500/10 text-red-100">{tasks?.filter((task) => task.status === "failed").length ?? 0} failed</CratePill>
      </OpsPageHero>

      {stats ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <OpsStatTile icon={Activity} label="Today" value={stats.todayTotal.toLocaleString()} caption="Tasks created today" />
          <OpsStatTile icon={CheckCircle2} label="Completed today" value={stats.todayCompleted.toLocaleString()} caption="Successful jobs in the current day" tone={stats.todayCompleted > 0 ? "success" : "default"} />
          <OpsStatTile icon={XCircle} label="Failed today" value={stats.todayFailed.toLocaleString()} caption="Tasks that need operator attention" tone={stats.todayFailed > 0 ? "danger" : "default"} />
          <OpsStatTile icon={Zap} label="Success rate" value={`${stats.successRate}%`} caption="Completed vs failed, same-day only" tone={stats.successRate >= 90 ? "success" : "warning"} />
          <OpsStatTile icon={Clock} label="Avg duration" value={`${stats.avgDurationSec}s`} caption="Last 20 completed tasks" />
        </div>
      ) : null}

      <OpsPanel
        icon={Filter}
        title="Task filters"
        description="Slice active and historical tasks by type, final status or free-text search on labels, ids and params."
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-2" onClick={() => cleanStatus("completed")}>
              <Trash2 size={13} />
              Clean completed
            </Button>
            <Button size="sm" variant="outline" className="gap-2" onClick={() => cleanStatus("failed")}>
              <Trash2 size={13} />
              Clean failed
            </Button>
            <Button size="sm" variant="outline" className="gap-2" onClick={() => cleanStatus("cancelled")}>
              <Trash2 size={13} />
              Clean cancelled
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-[260px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search labels, ids or params..."
              className="pl-9"
            />
          </div>
          <AdminSelect
            value={filterType === "all" ? "" : filterType}
            onChange={(value) => setFilterType(value || "all")}
            options={taskTypes}
            placeholder="All task types"
            searchable
            searchPlaceholder="Filter task types..."
            triggerClassName="min-w-[200px]"
          />
          <AdminSelect
            value={filterStatus === "all" ? "" : filterStatus}
            onChange={(value) => setFilterStatus(value || "all")}
            options={[
              { value: "completed", label: "Completed" },
              { value: "failed", label: "Failed" },
              { value: "cancelled", label: "Cancelled" },
            ]}
            placeholder="All final states"
            triggerClassName="min-w-[170px]"
          />
        </div>
      </OpsPanel>

      <OpsPanel
        icon={Cpu}
        title="Worker control"
        description="Queue depth, concurrency slots and quick access to worker logs when orchestration starts to stall."
      >
        <WorkerControlPanel
          running={activeTasks.filter((task) => task.status === "running").length}
          pending={activeTasks.filter((task) => task.status === "pending").length}
        />
      </OpsPanel>

      <OpsPanel
        icon={Zap}
        title="Running and queued"
        description="Current work in flight, with live event streams for long-running tasks."
      >
        {visibleActive.length > 0 ? (
          <div className="space-y-3">
            {visibleActive.map((task) => (
              <ActiveTaskCard
                key={task.id}
                task={task}
                expanded={expandedId === task.id}
                onExpand={() => setExpandedId((current) => current === task.id ? null : task.id)}
                onCancel={() => setCancelId(task.id)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-white/10 bg-black/15 px-4 py-12 text-center text-sm text-white/35">
            No active tasks match the current filters.
          </div>
        )}
      </OpsPanel>

      <OpsPanel
        icon={Clock}
        title="Task history"
        description="Recent finished jobs, with drill-down access to payloads, results and failure traces."
      >
        {filteredHistory.length > 0 ? (
          <div className="space-y-2">
            {filteredHistory.map((task) => (
              <HistoryTaskRow
                key={task.id}
                task={task}
                expanded={expandedId === task.id}
                onToggle={() => setExpandedId((current) => current === task.id ? null : task.id)}
                onRetry={() => handleRetry(task)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-white/10 bg-black/15 px-4 py-12 text-center text-sm text-white/35">
            No historical tasks match the current filters.
          </div>
        )}
      </OpsPanel>

      <ConfirmDialog
        open={cancelId !== null}
        onOpenChange={(open) => {
          if (!open) setCancelId(null);
        }}
        title="Cancel task"
        description="Cancel this background task? Running jobs may stop mid-operation depending on the worker handler."
        confirmLabel="Cancel task"
        variant="destructive"
        onConfirm={() => cancelId && handleCancel(cancelId)}
      />
    </div>
  );
}
