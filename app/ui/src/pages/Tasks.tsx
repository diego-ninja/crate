import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  Filter,
  HardDrive,
  Headphones,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Wrench,
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
import { useTaskEvents } from "@/hooks/use-task-events";
import { api } from "@/lib/api";
import { isRepairTaskType, taskFamily, taskNeedsAttention, taskRevalidationIssueCount } from "@/lib/task-insights";
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

interface SettledTaskHighlight {
  status: string;
}

interface WorkerPoolBreakdown {
  fast: number;
  default: number;
  heavy: number;
  playback: number;
}

interface WorkerQueueBreakdown {
  running: WorkerPoolBreakdown;
  pending: WorkerPoolBreakdown;
}

interface DbHeavyGate {
  active: number;
  pending: number;
  blocking: boolean;
}

interface TasksSnapshotData {
  live: {
    engine?: string;
    running_tasks: Array<{
      id: string;
      type: string;
      status?: string;
      pool?: string | null;
      progress: TaskProgress | string;
      created_at?: string | null;
      started_at?: string | null;
      updated_at?: string | null;
    }>;
    pending_tasks: Array<{
      id: string;
      type: string;
      status?: string;
      pool?: string | null;
      progress: TaskProgress | string;
      created_at?: string | null;
      started_at?: string | null;
      updated_at?: string | null;
    }>;
    recent_tasks: Array<{ id: string; type: string; status: string; updated_at?: string | null }>;
    worker_slots: { max: number; active: number };
    queue_breakdown: WorkerQueueBreakdown;
    db_heavy_gate: DbHeavyGate;
    systems: { postgres: boolean; watcher: boolean };
  };
  history: Task[];
}

interface PlaybackDeliveryVariant {
  id: string;
  track_id: number | null;
  preset: string;
  status: string;
  delivery_format: string;
  delivery_codec: string;
  delivery_bitrate: number;
  source_format: string | null;
  source_bitrate: number | null;
  source_size: number | null;
  bytes: number | null;
  task_id: string | null;
  task_status: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  updated_at: string | null;
  completed_at: string | null;
  error: string | null;
}

interface PlaybackDeliverySnapshot {
  stats: {
    tracks: number;
    lossless_tracks: number;
    hires_tracks: number;
    variants: number;
    variant_tracks: number;
    ready: number;
    pending: number;
    running: number;
    failed: number;
    ready_tracks: number;
    cached_bytes: number;
    ready_source_bytes: number;
    estimated_saved_bytes: number;
    coverage_percent: number;
    avg_prepare_seconds: number | null;
  };
  runtime: {
    active: number;
    limit: number;
  };
  recent_variants: PlaybackDeliveryVariant[];
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

const POOL_META: Record<keyof WorkerPoolBreakdown, { label: string; tone: string; accent: string }> = {
  fast: {
    label: "Fast",
    tone: "border-emerald-500/20 bg-emerald-500/[0.05]",
    accent: "text-emerald-200",
  },
  default: {
    label: "Default",
    tone: "border-cyan-400/20 bg-cyan-400/[0.05]",
    accent: "text-cyan-100",
  },
  heavy: {
    label: "Heavy",
    tone: "border-amber-500/20 bg-amber-500/[0.05]",
    accent: "text-amber-100",
  },
  playback: {
    label: "Playback",
    tone: "border-sky-400/20 bg-sky-400/[0.05]",
    accent: "text-sky-100",
  },
};

const FAMILY_META: Record<string, { label: string; chip: string }> = {
  repair: { label: "Repair", chip: "border-amber-500/20 bg-amber-500/[0.06] text-amber-100" },
  acquisition: { label: "Acquisition", chip: "border-fuchsia-400/20 bg-fuchsia-400/[0.06] text-fuchsia-100" },
  analysis: { label: "Analysis", chip: "border-cyan-400/20 bg-cyan-400/[0.05] text-cyan-100" },
  sync: { label: "Sync", chip: "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-100" },
  enrichment: { label: "Enrichment", chip: "border-violet-400/20 bg-violet-400/[0.06] text-violet-100" },
  playback: { label: "Playback", chip: "border-sky-400/20 bg-sky-400/[0.05] text-sky-100" },
  other: { label: "Other", chip: "border-white/10 bg-white/[0.04] text-white/55" },
};

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
    const summary = (result.summary as Record<string, unknown> | undefined) ?? {};
    const applied = Number(summary.applied ?? 0);
    const skipped = Number(summary.skipped ?? 0);
    const failed = Number(summary.failed ?? 0);
    const manual = Number(summary.unsupported ?? 0);
    const remaining = taskRevalidationIssueCount(result);
    const parts = [`${applied} applied`];
    if (skipped) parts.push(`${skipped} skipped`);
    if (failed) parts.push(`${failed} failed`);
    if (manual) parts.push(`${manual} manual`);
    if (remaining != null) parts.push(`${remaining} open after revalidation`);
    return `${parts.join(", ")}${result.fs_changed ? " (filesystem modified)" : ""}`;
  }
  if (type === "fix_artist") {
    const albumsFixed = Number(result.albums_fixed ?? 0);
    const syncedTracks = Number(result.synced_tracks ?? 0);
    return `${albumsFixed} albums fixed, ${syncedTracks} tracks synced`;
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

function isRepairTask(task: Task): boolean {
  return isRepairTaskType(task.type);
}

function formatDuration(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
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
  warn: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  error: "bg-red-500/10 text-red-400 border-red-500/30",
  item: "bg-slate-500/10 text-slate-300 border-slate-500/30",
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
  if (event.type === "item" && event.data) {
    const outcome = typeof event.data.outcome === "string" ? event.data.outcome : null;
    const action = typeof event.data.action === "string" ? event.data.action.replace(/_/g, " ") : null;
    const target = typeof event.data.target === "string" ? event.data.target : null;
    if (event.data.message) return String(event.data.message);
    if (outcome && action && target) return `${outcome}: ${action} -> ${target}`;
  }
  if (event.data?.message) return String(event.data.message);
  if (event.data?.step) return String(event.data.step).replace(/_/g, " ");
  if (event.data) {
    const keys = Object.keys(event.data);
    if (keys.length <= 3) return keys.map((key) => `${key}: ${event.data![key]}`).join(", ");
  }
  return event.type.replace(/_/g, " ");
}

function taskDoneMessage(done: { status: string; result?: Record<string, unknown>; error?: string } | null) {
  if (!done) return null;
  if (done.error) return done.error;
  if (done.status === "completed") {
    if (typeof done.result?.message === "string") return done.result.message;
    return "Task completed";
  }
  if (done.status === "failed") return "Task failed";
  if (done.status === "cancelled") return "Task cancelled";
  return done.status;
}

function TaskDoneBanner({ done }: { done: { status: string; result?: Record<string, unknown>; error?: string } | null }) {
  if (!done) return null;
  const status = getStatusMeta(done.status);
  const Icon = status.icon;
  const message = taskDoneMessage(done);
  return (
    <div className={cn("mb-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs", status.cardClass)}>
      <Icon size={14} className={status.iconClass} />
      <span className={cn("font-medium", status.iconClass)}>{status.label}</span>
      {message ? <span className="text-white/70">{message}</span> : null}
    </div>
  );
}

function LiveTaskEvents({ taskId }: { taskId: string }) {
  const { events, connected, done } = useTaskEvents(taskId);

  if (events.length === 0) {
    if (done) {
      return (
        <div className="py-3">
          <TaskDoneBanner done={done} />
        </div>
      );
    }
    return <div className="py-3 text-xs text-white/40">{connected ? "Waiting for live events…" : "Connecting to task stream…"}</div>;
  }

  return (
    <div className="max-h-[280px] space-y-1 overflow-y-auto py-3 font-mono">
      <TaskDoneBanner done={done} />
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

function TaskEventLog({ taskId, emptyMessage = "No task log recorded." }: { taskId: string; emptyMessage?: string }) {
  const { events, connected, done } = useTaskEvents(taskId);

  if (events.length === 0) {
    if (done) {
      return (
        <div className="py-3">
          <TaskDoneBanner done={done} />
        </div>
      );
    }
    if (connected && !done) {
      return <div className="py-3 text-xs text-white/40">Loading task log…</div>;
    }
    return <div className="py-3 text-xs text-white/40">{emptyMessage}</div>;
  }

  return (
    <div className="max-h-[320px] space-y-1 overflow-y-auto py-3 font-mono">
      <TaskDoneBanner done={done} />
      {events.map((event, index) => (
        <div key={`${taskId}-${index}`} className="flex items-start gap-2 text-xs">
          <span className="w-16 shrink-0 text-[10px] text-white/20">
            {new Date(event.timestamp || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <CrateChip className={EVENT_BADGE_COLORS[event.type] || "border-white/10 bg-white/[0.04] text-white/60"}>
            {event.type.replace(/_/g, " ")}
          </CrateChip>
          <span className="text-white/70">{eventMessage(event)}</span>
        </div>
      ))}
    </div>
  );
}

function WorkerControlPanel({
  engine,
  running,
  pending,
  slotLimit,
  queueBreakdown,
  dbHeavyGate,
  activeTasks,
  refreshTasks,
}: {
  engine: string;
  running: number;
  pending: number;
  slotLimit: number;
  queueBreakdown: WorkerQueueBreakdown;
  dbHeavyGate: DbHeavyGate;
  activeTasks: { id: string; type: string; pool?: string | null }[];
  refreshTasks: (fresh?: boolean) => Promise<void>;
}) {
  const [restarting, setRestarting] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);

  async function setSlots(next: number) {
    try {
      await api("/api/worker/slots", "POST", { slots: next });
      await refreshTasks(true);
      toast.success(`Worker slots set to ${next}`);
    } catch {
      toast.error("Failed to update worker slots");
    }
  }

  async function restartWorker() {
    setRestarting(true);
    try {
      await api("/api/worker/restart", "POST");
      await refreshTasks(true);
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
      await refreshTasks(true);
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

  const poolKeys: Array<keyof WorkerPoolBreakdown> = ["fast", "default", "heavy", "playback"];
  const hasQueuedDbHeavy = dbHeavyGate.pending > 0;
  const gateMessage = dbHeavyGate.blocking
    ? `DB-heavy work is serialized right now: ${dbHeavyGate.active} running, ${dbHeavyGate.pending} waiting. Free Dramatiq slots will stay idle until the gate clears.`
    : hasQueuedDbHeavy
      ? `${dbHeavyGate.pending} DB-heavy task${dbHeavyGate.pending === 1 ? "" : "s"} queued. They will run one at a time once a DB-heavy slot is free.`
      : "No DB-heavy serialization pressure right now.";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CrateChip active>{engine}</CrateChip>
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

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
        <div className="grid gap-2 md:grid-cols-4">
          {poolKeys.map((pool) => {
            const meta = POOL_META[pool];
            const runningForPool = queueBreakdown.running[pool] ?? 0;
            const pendingForPool = queueBreakdown.pending[pool] ?? 0;
            return (
              <div key={pool} className={cn("rounded-md border px-3 py-3", meta.tone)}>
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("text-sm font-medium", meta.accent)}>{meta.label}</span>
                  <CratePill className="border-white/10 bg-black/20 text-white/70">{runningForPool} active</CratePill>
                </div>
                <div className="mt-2 text-xs text-white/45">
                  {pendingForPool} queued
                </div>
              </div>
            );
          })}
        </div>

        <div
          className={cn(
            "rounded-md border px-4 py-3 text-sm",
            dbHeavyGate.blocking
              ? "border-amber-500/20 bg-amber-500/[0.06] text-amber-50"
              : hasQueuedDbHeavy
                ? "border-white/10 bg-black/15 text-white/80"
                : "border-white/8 bg-black/15 text-white/65",
          )}
        >
          <div className="flex items-center gap-2">
            <Zap size={14} className={dbHeavyGate.blocking ? "text-amber-200" : "text-white/45"} />
            <span className="font-medium">DB-heavy gate</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-white/75">{gateMessage}</p>
        </div>
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

function variantStatusClass(status: string) {
  if (status === "ready") return "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-100";
  if (status === "failed") return "border-red-500/20 bg-red-500/[0.08] text-red-100";
  if (status === "pending" || status === "running") return "border-amber-500/20 bg-amber-500/[0.06] text-amber-100";
  return "border-white/10 bg-white/[0.04] text-white/60";
}

function PlaybackDeliveryPanel({
  delivery,
  loading,
  error,
  onRefresh,
}: {
  delivery: PlaybackDeliverySnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const stats = delivery?.stats;
  const runtime = delivery?.runtime;
  const variants = delivery?.recent_variants ?? [];
  const avgPrepare = stats?.avg_prepare_seconds != null ? `${stats.avg_prepare_seconds.toFixed(1)}s` : "n/a";

  if (loading && !delivery) {
    return (
      <div className="flex items-center gap-2 text-sm text-white/45">
        <Loader2 size={14} className="animate-spin text-primary" />
        Loading playback delivery…
      </div>
    );
  }

  if (error && !delivery) {
    return (
      <ErrorState message="Failed to load playback delivery" onRetry={onRefresh} />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CrateChip className={(runtime?.active ?? 0) > 0 ? "border-sky-400/25 bg-sky-400/10 text-sky-100" : undefined}>
            {runtime?.active ?? 0}/{runtime?.limit ?? 1} transcodes
          </CrateChip>
          <CrateChip>{stats?.pending ?? 0} pending</CrateChip>
          <CrateChip>{stats?.failed ?? 0} failed</CrateChip>
        </div>
        <Button size="sm" variant="outline" className="gap-2" onClick={onRefresh}>
          <RefreshCw size={13} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <OpsStatTile
          icon={Headphones}
          label="Lossless coverage"
          value={`${stats?.coverage_percent ?? 0}%`}
          caption={`${(stats?.ready_tracks ?? 0).toLocaleString()} of ${(stats?.lossless_tracks ?? 0).toLocaleString()} lossless tracks`}
          tone={(stats?.coverage_percent ?? 0) > 0 ? "success" : "default"}
        />
        <OpsStatTile
          icon={CheckCircle2}
          label="Ready variants"
          value={(stats?.ready ?? 0).toLocaleString()}
          caption={`${(stats?.variants ?? 0).toLocaleString()} variant records`}
          tone={(stats?.ready ?? 0) > 0 ? "success" : "default"}
        />
        <OpsStatTile
          icon={HardDrive}
          label="Cache size"
          value={formatBytes(stats?.cached_bytes)}
          caption={`${formatBytes(stats?.estimated_saved_bytes)} avoided vs source`}
        />
        <OpsStatTile
          icon={Clock}
          label="Avg prepare"
          value={avgPrepare}
          caption={`${(stats?.hires_tracks ?? 0).toLocaleString()} hi-res source tracks`}
        />
      </div>

      <div className="overflow-hidden rounded-md border border-white/8">
        {variants.length > 0 ? (
          variants.map((variant) => {
            const track = [variant.artist, variant.title].filter(Boolean).join(" - ") || `Track ${variant.track_id ?? "unknown"}`;
            const reduction = variant.source_size && variant.bytes
              ? `${Math.max(0, Math.round((1 - variant.bytes / variant.source_size) * 100))}% smaller`
              : null;
            return (
              <div key={variant.id} className="grid gap-3 border-b border-white/6 px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_150px_150px_120px] lg:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white/85">{track}</div>
                  <div className="mt-1 truncate text-xs text-white/35">{variant.album || "No album"} · {variant.source_format || "source"} → {variant.delivery_format} {variant.delivery_bitrate}k</div>
                </div>
                <CrateChip className={variantStatusClass(variant.status)}>{variant.status}</CrateChip>
                <div className="text-xs text-white/45">
                  {formatBytes(variant.bytes)}
                  {reduction ? <span className="text-white/28"> · {reduction}</span> : null}
                </div>
                <div className="text-xs text-white/35">{variant.updated_at ? timeAgo(variant.updated_at) : "n/a"}</div>
              </div>
            );
          })
        ) : (
          <div className="px-4 py-6 text-sm text-white/40">No playback variants prepared yet.</div>
        )}
      </div>
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
  const { events, done } = useTaskEvents(task.id);
  const liveStatus = done?.status || task.status;
  const status = getStatusMeta(liveStatus);
  const Icon = status.icon;
  const latestMessage = useMemo(() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const message = events[index]?.data?.message;
      if (typeof message === "string" && message.trim()) return message;
    }
    return taskDoneMessage(done);
  }, [done, events]);

  return (
    <div className={cn("overflow-hidden rounded-md border p-4", status.cardClass)}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04]">
              <Icon size={16} className={cn(status.iconClass, liveStatus === "running" && "animate-spin")} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">{getTaskLabel(task)}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/40">
                <CrateChip className={status.pill}>{status.label}</CrateChip>
                {task.pool ? <CrateChip>{task.pool}</CrateChip> : null}
                <span>{liveStatus === "running" && task.started_at ? `Running for ${formatDuration(task.started_at, new Date().toISOString())}` : `Queued ${timeAgo(task.created_at)}`}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {liveStatus === "running" || Boolean(done) ? (
              <Button size="sm" variant="outline" className="gap-2" onClick={onExpand}>
                <Zap size={13} />
                {expanded ? "Hide live" : done ? "Task log" : "Live events"}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" className="gap-2 text-red-200" onClick={onCancel} disabled={Boolean(done)}>
              <Ban size={13} />
              Cancel
            </Button>
          </div>
        </div>

        <ProgressSummary progress={task.progress} />
        {latestMessage ? (
          <div className={cn("text-xs", done ? status.iconClass : "text-white/45")}>{latestMessage}</div>
        ) : null}
      </div>

      {expanded && (liveStatus === "running" || Boolean(done)) ? (
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
  highlightStatus,
}: {
  task: Task;
  expanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
  highlightStatus?: string | null;
}) {
  const status = getStatusMeta(task.status);
  const Icon = status.icon;
  const summary = describeResult(task);
  const showHumanLog = task.type === "repair" || task.type === "fix_artist";
  const highlightMeta = highlightStatus ? getStatusMeta(highlightStatus) : null;
  const family = taskFamily(task.type);
  const familyMeta = FAMILY_META[family] || FAMILY_META.other || { label: "Other", chip: "border-white/10 bg-white/[0.04] text-white/55" };
  const needsAttention = taskNeedsAttention(task);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border transition-all duration-700",
        status.cardClass,
        highlightMeta?.cardClass,
        highlightStatus && "ring-1",
        highlightStatus === "completed" && "ring-emerald-500/35",
        highlightStatus === "failed" && "ring-red-500/35",
        highlightStatus === "cancelled" && "ring-white/20",
      )}
    >
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
            <CrateChip className={familyMeta.chip}>{familyMeta.label}</CrateChip>
            {needsAttention ? (
              <CrateChip className="border-amber-500/20 bg-amber-500/[0.06] text-amber-100">Needs attention</CrateChip>
            ) : null}
            {highlightMeta ? <CrateChip className={highlightMeta.pill}>Just finished</CrateChip> : null}
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

          {showHumanLog ? (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-white/35">Task log</div>
              <div className="rounded-sm border border-white/6 bg-black/20 px-3">
                <TaskEventLog taskId={task.id} />
              </div>
            </div>
          ) : task.result ? (
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
  const [tasksSnapshot, setTasksSnapshot] = useState<TasksSnapshotData | null>(null);
  const [playbackDelivery, setPlaybackDelivery] = useState<PlaybackDeliverySnapshot | null>(null);
  const [playbackDeliveryLoading, setPlaybackDeliveryLoading] = useState(true);
  const [playbackDeliveryError, setPlaybackDeliveryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [filterFamily, setFilterFamily] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const autoExpandedRepairRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const previousActiveIdsRef = useRef<Set<string>>(new Set());
  const highlightTimersRef = useRef<Record<string, number>>({});
  const [settledHighlights, setSettledHighlights] = useState<Record<string, SettledTaskHighlight>>({});

  const fetchSnapshot = useCallback(async (fresh = false) => {
    if (!loadedRef.current) {
      setLoading(true);
    }
    try {
      const query = fresh ? "?limit=100&fresh=1" : "?limit=100";
      const snapshot = await api<TasksSnapshotData>(`/api/admin/tasks-snapshot${query}`);
      setTasksSnapshot(snapshot);
      setError(null);
      loadedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load task orchestration");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPlaybackDelivery = useCallback(async () => {
    setPlaybackDeliveryLoading(true);
    try {
      const snapshot = await api<PlaybackDeliverySnapshot>("/api/admin/playback-delivery?limit=8");
      setPlaybackDelivery(snapshot);
      setPlaybackDeliveryError(null);
    } catch (err) {
      setPlaybackDeliveryError(err instanceof Error ? err.message : "Failed to load playback delivery");
    } finally {
      setPlaybackDeliveryLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  useEffect(() => {
    void fetchPlaybackDelivery();
    const timer = window.setInterval(() => {
      void fetchPlaybackDelivery();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [fetchPlaybackDelivery]);

  useEffect(() => {
    let disposed = false;
    let stream: EventSource | null = null;

    function connect() {
      if (disposed) return;
      stream = new EventSource("/api/admin/tasks-stream?limit=100", { withCredentials: true });
      stream.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as TasksSnapshotData;
          setTasksSnapshot(payload);
          setError(null);
          setLoading(false);
          loadedRef.current = true;
        } catch {
          // Ignore malformed snapshots.
        }
      };
      stream.onerror = () => {
        stream?.close();
        stream = null;
        if (!disposed) {
          reconnectTimerRef.current = window.setTimeout(connect, 5000);
        }
      };
    }

    connect();
    return () => {
      disposed = true;
      stream?.close();
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
    };
  }, []);

  const tasks = tasksSnapshot?.history ?? [];
  const live = tasksSnapshot?.live;

  useEffect(() => {
    const highlightedTask = searchParams.get("task");
    if (highlightedTask && tasks.some((task) => task.id === highlightedTask)) {
      setExpandedId(highlightedTask);
      setFilterStatus("all");
    }
  }, [searchParams, tasks]);

  async function handleCancel(id: string) {
    try {
      await api(`/api/tasks/${id}/cancel`, "POST");
      toast.success("Task cancelled");
      await fetchSnapshot(true);
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
      await fetchSnapshot(true);
    } catch {
      toast.error("Failed to retry task");
    }
  }

  async function cleanupOlder() {
    try {
      const response = await api<{ deleted: number }>("/api/tasks/cleanup", "POST", { older_than_days: 7 });
      toast.success(`Cleaned up ${response.deleted} old tasks`);
      await fetchSnapshot(true);
    } catch {
      toast.error("Cleanup failed");
    }
  }

  async function cleanStatus(status: "completed" | "failed" | "cancelled") {
    try {
      const response = await api<{ deleted: number }>(`/api/tasks/clean/${status}`, "POST");
      toast.success(`Cleaned ${response.deleted} ${status} tasks`);
      await fetchSnapshot(true);
    } catch {
      toast.error(`Failed to clean ${status} tasks`);
    }
  }

  const taskTypes = useMemo(() => {
    return Array.from(new Set(tasks.map((task) => task.type))).sort().map((type) => ({
      value: type,
      label: taskLabel(type),
    }));
  }, [tasks]);

  const taskFamilies = useMemo(() => {
    return [
      { value: "repair", label: "Repair" },
      { value: "acquisition", label: "Acquisition" },
      { value: "analysis", label: "Analysis" },
      { value: "sync", label: "Sync" },
      { value: "enrichment", label: "Enrichment" },
      { value: "other", label: "Other" },
    ];
  }, []);

  const activeTasks = useMemo(() => {
    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const snapshotTasks = [
      ...(live?.running_tasks ?? []),
      ...(live?.pending_tasks ?? []),
    ];

    return snapshotTasks.map((task) => {
      const existing = taskMap.get(task.id);
      if (existing) return existing;
      return {
        id: task.id,
        type: task.type,
        status: task.status || "pending",
        progress: task.progress,
        error: null,
        params: null,
        result: null,
        priority: null,
        pool: task.pool ?? null,
        created_at: task.created_at ?? task.updated_at ?? new Date().toISOString(),
        started_at: task.started_at ?? null,
        updated_at: task.updated_at ?? task.created_at ?? new Date().toISOString(),
      } satisfies Task;
    });
  }, [live, tasks]);

  const completedTasks = useMemo(
    () => tasks.filter((task) => task.status !== "running" && task.status !== "pending"),
    [tasks],
  );

  const needsAttentionTasks = useMemo(
    () => completedTasks.filter((task) => taskNeedsAttention(task)).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [completedTasks],
  );
  const recentRepairTasks = useMemo(
    () => completedTasks.filter((task) => isRepairTask(task)).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [completedTasks],
  );

  useEffect(() => {
    const currentActiveIds = new Set(activeTasks.map((task) => task.id));
    const completedById = new Map(completedTasks.map((task) => [task.id, task]));
    const nextHighlights: Array<{ id: string; status: string }> = [];
    const highlightedTask = searchParams.get("task");

    for (const taskId of previousActiveIdsRef.current) {
      if (currentActiveIds.has(taskId)) continue;
      const settledTask = completedById.get(taskId);
      if (!settledTask) continue;
      nextHighlights.push({ id: taskId, status: settledTask.status });
      if (!highlightedTask && isRepairTask(settledTask) && taskNeedsAttention(settledTask)) {
        setExpandedId(settledTask.id);
      }
    }

    if (nextHighlights.length > 0) {
      setSettledHighlights((prev) => {
        const next = { ...prev };
        for (const item of nextHighlights) {
          next[item.id] = { status: item.status };
          const existingTimer = highlightTimersRef.current[item.id];
          if (existingTimer != null) {
            window.clearTimeout(existingTimer);
          }
          highlightTimersRef.current[item.id] = window.setTimeout(() => {
            setSettledHighlights((current) => {
              const updated = { ...current };
              delete updated[item.id];
              return updated;
            });
            delete highlightTimersRef.current[item.id];
          }, 8000);
        }
        return next;
      });
    }

    previousActiveIdsRef.current = currentActiveIds;
  }, [activeTasks, completedTasks, searchParams]);

  useEffect(() => {
    if (searchParams.get("task")) return;
    if (autoExpandedRepairRef.current) return;
    const candidate = recentRepairTasks.find((task) => taskNeedsAttention(task));
    if (!candidate) return;
    autoExpandedRepairRef.current = true;
    setExpandedId((current) => current ?? candidate.id);
  }, [recentRepairTasks, searchParams]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(highlightTimersRef.current)) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const filteredHistory = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return completedTasks.filter((task) => {
      if (filterFamily !== "all" && taskFamily(task.type) !== filterFamily) return false;
      if (filterType !== "all" && task.type !== filterType) return false;
      if (filterStatus === "attention") {
        if (!taskNeedsAttention(task)) return false;
      } else if (filterStatus !== "all" && task.status !== filterStatus) {
        return false;
      }
      if (!normalized) return true;
      const haystack = `${getTaskLabel(task)} ${task.id} ${task.type} ${JSON.stringify(task.params || {})}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [completedTasks, filterFamily, filterStatus, filterType, search]);

  const visibleActive = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return activeTasks.filter((task) => {
      if (filterFamily !== "all" && taskFamily(task.type) !== filterFamily) return false;
      if (filterType !== "all" && task.type !== filterType) return false;
      if (!normalized) return true;
      const haystack = `${getTaskLabel(task)} ${task.id} ${task.type} ${JSON.stringify(task.params || {})}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [activeTasks, filterFamily, filterType, search]);

  const stats = useMemo(() => {
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
      needsAttention: needsAttentionTasks.length,
      successRate: todayTasks.length > 0 ? Math.round((todayCompleted / Math.max(todayCompleted + todayFailed, 1)) * 100) : 100,
      avgDurationSec: completed.length > 0 ? Math.round(avgDurationMs / completed.length / 1000) : 0,
    };
  }, [needsAttentionTasks.length, tasks]);

  if (loading && !tasksSnapshot) {
    return (
      <div className="flex justify-center py-16 text-white/45">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !tasksSnapshot) {
    return <ErrorState message="Failed to load task orchestration" onRetry={() => void fetchSnapshot(true)} />;
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
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => {
                void fetchSnapshot(true);
              }}
            >
              <RefreshCw size={14} />
              Refresh
            </Button>
          </>
        }
      >
        <CratePill active icon={Activity}>{tasks.length} tasks</CratePill>
        <CratePill icon={Loader2}>{activeTasks.length} active</CratePill>
        <CratePill icon={Clock}>{activeTasks.filter((task) => task.status === "pending").length} queued</CratePill>
        <CratePill icon={CheckCircle2}>{tasks.filter((task) => task.status === "completed").length} completed</CratePill>
        <CratePill className="border-red-500/25 bg-red-500/10 text-red-100">{tasks.filter((task) => task.status === "failed").length} failed</CratePill>
        {stats.needsAttention > 0 ? (
          <CratePill className="border-amber-500/25 bg-amber-500/10 text-amber-100">{stats.needsAttention} need attention</CratePill>
        ) : null}
      </OpsPageHero>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <OpsStatTile icon={Activity} label="Today" value={stats.todayTotal.toLocaleString()} caption="Tasks created today" />
        <OpsStatTile icon={CheckCircle2} label="Completed today" value={stats.todayCompleted.toLocaleString()} caption="Successful jobs in the current day" tone={stats.todayCompleted > 0 ? "success" : "default"} />
        <OpsStatTile icon={XCircle} label="Failed today" value={stats.todayFailed.toLocaleString()} caption="Tasks that need operator attention" tone={stats.todayFailed > 0 ? "danger" : "default"} />
        <OpsStatTile icon={AlertTriangle} label="Needs attention" value={stats.needsAttention.toLocaleString()} caption="Recent failed, cancelled or partially-resolved work" tone={stats.needsAttention > 0 ? "warning" : "default"} />
        <OpsStatTile icon={Zap} label="Success rate" value={`${stats.successRate}%`} caption="Completed vs failed, same-day only" tone={stats.successRate >= 90 ? "success" : "warning"} />
        <OpsStatTile icon={Clock} label="Avg duration" value={`${stats.avgDurationSec}s`} caption="Last 20 completed tasks" />
      </div>

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
            value={filterFamily === "all" ? "" : filterFamily}
            onChange={(value) => setFilterFamily(value || "all")}
            options={taskFamilies}
            placeholder="All families"
            triggerClassName="min-w-[180px]"
          />
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
              { value: "attention", label: "Needs attention" },
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
          engine={live?.engine || "dramatiq"}
          running={live?.running_tasks.length ?? 0}
          pending={live?.pending_tasks.length ?? 0}
          slotLimit={live?.worker_slots.max ?? 3}
          queueBreakdown={live?.queue_breakdown ?? { running: { fast: 0, default: 0, heavy: 0, playback: 0 }, pending: { fast: 0, default: 0, heavy: 0, playback: 0 } }}
          dbHeavyGate={live?.db_heavy_gate ?? { active: 0, pending: 0, blocking: false }}
          activeTasks={(live?.running_tasks ?? []).map((task) => ({ id: task.id, type: task.type, pool: task.pool }))}
          refreshTasks={fetchSnapshot}
        />
      </OpsPanel>

      <OpsPanel
        icon={Headphones}
        title="Playback delivery"
        description="Dedicated stream-preparation lane, cached AAC variants and recent transcode outcomes for Listen."
      >
        <PlaybackDeliveryPanel
          delivery={playbackDelivery}
          loading={playbackDeliveryLoading}
          error={playbackDeliveryError}
          onRefresh={() => void fetchPlaybackDelivery()}
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
        icon={AlertTriangle}
        title="Needs attention"
        description="Failures, cancelled jobs, and repairs that completed with manual follow-up or partial problems."
      >
        {needsAttentionTasks.length > 0 ? (
          <div className="space-y-2">
            {needsAttentionTasks.slice(0, 8).map((task) => (
              <HistoryTaskRow
                key={`attention-${task.id}`}
                task={task}
                expanded={expandedId === task.id}
                onToggle={() => setExpandedId((current) => current === task.id ? null : task.id)}
                onRetry={() => handleRetry(task)}
                highlightStatus={settledHighlights[task.id]?.status ?? null}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-white/10 bg-black/15 px-4 py-12 text-center text-sm text-white/35">
            No tasks need attention right now.
          </div>
        )}
      </OpsPanel>

      <OpsPanel
        icon={Wrench}
        title="Recent repair runs"
        description="Latest repair, fix-artist and health-repair jobs, with quick access to item logs and partial failures."
      >
        {recentRepairTasks.length > 0 ? (
          <div className="space-y-2">
            {recentRepairTasks.slice(0, 8).map((task) => (
              <HistoryTaskRow
                key={`repair-${task.id}`}
                task={task}
                expanded={expandedId === task.id}
                onToggle={() => setExpandedId((current) => current === task.id ? null : task.id)}
                onRetry={() => handleRetry(task)}
                highlightStatus={settledHighlights[task.id]?.status ?? null}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-white/10 bg-black/15 px-4 py-12 text-center text-sm text-white/35">
            No repair runs recorded yet.
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
                highlightStatus={settledHighlights[task.id]?.status ?? null}
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
