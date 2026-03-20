import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
  RefreshCw,
} from "lucide-react";

interface TaskProgress {
  artist?: string;
  done?: number;
  total?: number;
  enriched?: number;
  skipped?: number;
  scanner?: string;
  phase?: string;
  message?: string;
  artists_done?: number;
  artists_total?: number;
  tracks_processed?: number;
  issues_found?: number;
  scanners_done?: string[];
  scanners_total?: number;
  [key: string]: unknown;
}

interface Task {
  id: string;
  type: string;
  status: string;
  progress: TaskProgress | string;
  error: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_STATUS = { icon: Clock, color: "text-muted-foreground", label: "Unknown" } as const;

const STATUS_MAP = new Map([
  ["running", { icon: Loader2, color: "text-blue-500", label: "Running" }],
  ["pending", { icon: Clock, color: "text-yellow-500", label: "Pending" }],
  ["completed", { icon: CheckCircle2, color: "text-green-500", label: "Completed" }],
  ["failed", { icon: XCircle, color: "text-red-500", label: "Failed" }],
  ["cancelled", { icon: Ban, color: "text-muted-foreground", label: "Cancelled" }],
]);

function getStatus(status: string) {
  return STATUS_MAP.get(status) ?? DEFAULT_STATUS;
}

const TYPE_LABELS: Record<string, string> = {
  scan: "Library Scan",
  compute_analytics: "Compute Analytics",
  enrich_artists: "Artist Enrichment",
  fetch_artwork_all: "Fetch All Artwork",
  batch_retag: "Batch Retag",
  batch_covers: "Batch Fetch Covers",
};

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h ${min % 60}m`;
}

function TaskProgressDisplay({ progress }: { progress: TaskProgress | string }) {
  if (typeof progress === "string") {
    return progress ? <span className="text-xs text-muted-foreground">{progress}</span> : null;
  }

  // Enrichment progress
  if (progress.done != null && progress.total != null) {
    const pct = Math.round((progress.done / progress.total) * 100);
    return (
      <div className="space-y-1">
        <Progress value={pct} className="h-1.5" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {progress.artist && <span className="text-foreground">{progress.artist}</span>}
          </span>
          <span>
            {progress.done}/{progress.total} ({pct}%)
            {progress.enriched != null && ` · ${progress.enriched} enriched`}
          </span>
        </div>
      </div>
    );
  }

  // Scan / analytics progress (has artists_done/artists_total)
  if (progress.artists_done != null && progress.artists_total != null && progress.artists_total > 0) {
    const pct = Math.round((progress.artists_done / progress.artists_total) * 100);
    return (
      <div className="space-y-1">
        <Progress value={pct} className="h-1.5" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {progress.phase && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 mr-1">
                {String(progress.phase)}
              </Badge>
            )}
            {progress.scanner && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 mr-1">
                {String(progress.scanner)}
              </Badge>
            )}
            {progress.artist && <span className="text-foreground">{String(progress.artist)}</span>}
          </span>
          <span>
            {progress.artists_done}/{progress.artists_total} ({pct}%)
            {progress.tracks_processed != null && ` · ${progress.tracks_processed} tracks`}
            {progress.issues_found != null && ` · ${progress.issues_found} issues`}
          </span>
        </div>
      </div>
    );
  }

  // Generic message progress
  if (progress.message) {
    return <span className="text-xs text-muted-foreground">{String(progress.message)}</span>;
  }

  return null;
}

export function Tasks() {
  const { data: tasks, loading, refetch } = useApi<Task[]>("/api/tasks?limit=50");
  const [cancelId, setCancelId] = useState<string | null>(null);

  // Auto-refresh every 3s if there are running tasks
  useEffect(() => {
    const hasRunning = tasks?.some((t) => t.status === "running" || t.status === "pending");
    if (!hasRunning) return;
    const timer = setInterval(refetch, 3000);
    return () => clearInterval(timer);
  }, [tasks, refetch]);

  const handleCancel = async (id: string) => {
    try {
      await api(`/api/tasks/${id}/cancel`, "POST");
      toast.success("Task cancelled");
      refetch();
    } catch (e) {
      toast.error(`Failed to cancel: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
    setCancelId(null);
  };

  const running = tasks?.filter((t) => t.status === "running") ?? [];
  const pending = tasks?.filter((t) => t.status === "pending") ?? [];
  const completed = tasks?.filter((t) => !["running", "pending"].includes(t.status)) ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold flex items-center gap-3">
        Tasks
        <Button variant="ghost" size="sm" onClick={refetch}>
          <RefreshCw size={14} />
        </Button>
      </h1>

      {/* Worker Status */}
      <WorkerStatus running={running.length} pending={pending.length} />

      {/* Active tasks */}
      {(running.length > 0 || pending.length > 0) && (
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-sm">Active Tasks ({running.length + pending.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[...running, ...pending].map((task) => {
              const cfg = getStatus(task.status);
              const Icon = cfg.icon;
              return (
                <div
                  key={task.id}
                  className="border border-border rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Icon
                        size={16}
                        className={`${cfg.color} ${task.status === "running" ? "animate-spin" : ""}`}
                      />
                      <div>
                        <div className="font-medium text-sm">
                          {TYPE_LABELS[task.type] ?? task.type}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {task.id} · Started{" "}
                          {new Date(task.created_at).toLocaleString()}
                          {task.status === "running" && (
                            <> · Running for {formatDuration(task.created_at, task.updated_at)}</>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-500 border-red-500/30 hover:bg-red-500/10"
                      onClick={() => setCancelId(task.id)}
                    >
                      <Ban size={12} className="mr-1" />
                      Cancel
                    </Button>
                  </div>
                  <TaskProgressDisplay progress={task.progress} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* History */}
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-sm">Task History</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : completed.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No completed tasks
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="text-right">Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {completed.map((task) => {
                  const cfg = getStatus(task.status);
                  const Icon = cfg.icon;
                  const result = task.result;
                  let resultText = "";
                  if (task.error) {
                    resultText = task.error;
                  } else if (result) {
                    if ("issue_count" in result) resultText = `${result.issue_count} issues`;
                    else if ("enriched" in result) resultText = `${result.enriched} enriched, ${result.skipped} skipped`;
                    else resultText = JSON.stringify(result).slice(0, 60);
                  }

                  return (
                    <TableRow key={task.id}>
                      <TableCell className="text-sm font-medium">
                        {TYPE_LABELS[task.type] ?? task.type}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Icon size={14} className={cfg.color} />
                          <span className={`text-xs ${cfg.color}`}>{cfg.label}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDuration(task.created_at, task.updated_at)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {resultText}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {new Date(task.updated_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={cancelId !== null}
        onOpenChange={(open) => { if (!open) setCancelId(null); }}
        title="Cancel Task"
        description="Are you sure you want to cancel this task? It will stop processing."
        confirmLabel="Cancel Task"
        variant="destructive"
        onConfirm={() => { if (cancelId) handleCancel(cancelId); }}
      />
    </div>
  );
}

interface WorkerInfo {
  max_slots: number;
  running: number;
  pending: number;
  running_tasks: { id: string; type: string }[];
  pending_tasks: { id: string; type: string }[];
}

function WorkerStatus({ running, pending }: { running: number; pending: number }) {
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [workerInfo, setWorkerInfo] = useState<WorkerInfo | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    api<WorkerInfo>("/api/worker/status")
      .then(setWorkerInfo)
      .catch(() => {});
    const timer = setInterval(() => {
      api<WorkerInfo>("/api/worker/status")
        .then(setWorkerInfo)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const maxSlots = workerInfo?.max_slots ?? 3;

  async function toggleLogs() {
    if (showLogs) { setShowLogs(false); return; }
    setShowLogs(true);
    setLogsLoading(true);
    try {
      const d = await api<{ name: string; logs: string }>("/api/stack/container/musicdock-worker/logs?tail=40");
      setLogs(d.logs);
    } catch {
      setLogs("Failed to load logs");
    } finally {
      setLogsLoading(false);
    }
  }

  async function setSlots(n: number) {
    try {
      await api("/api/worker/slots", "POST", { slots: n });
      setWorkerInfo((prev) => prev ? { ...prev, max_slots: n } : prev);
      toast.success(`Worker slots set to ${n}`);
    } catch {
      toast.error("Failed to set slots");
    }
  }

  async function restartWorker() {
    setRestarting(true);
    try {
      await api("/api/worker/restart", "POST");
      toast.success("Worker restarting...");
    } catch {
      toast.error("Restart failed");
    } finally {
      setTimeout(() => setRestarting(false), 5000);
    }
  }

  async function cancelAll() {
    try {
      const res = await api<{ cancelled: number }>("/api/worker/cancel-all", "POST");
      toast.success(`Cancelled ${res.cancelled} tasks`);
    } catch {
      toast.error("Failed to cancel tasks");
    }
  }

  return (
    <Card className="bg-card">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="text-sm font-medium">Worker</div>
            <div className="flex gap-1">
              {Array.from({ length: maxSlots }, (_, i) => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-full transition-colors ${
                    i < running ? "bg-blue-500 animate-pulse" : "bg-border"
                  }`}
                  title={i < running ? "Active" : "Idle"}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {running}/{maxSlots} active
              {pending > 0 && ` · ${pending} queued`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* Slot controls */}
            <div className="flex items-center gap-0.5 mr-2 border border-border rounded-md">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setSlots(n)}
                  className={`px-2 py-1 text-[10px] font-mono transition-colors ${
                    n === maxSlots
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  } ${n === 1 ? "rounded-l-md" : ""} ${n === 5 ? "rounded-r-md" : ""}`}
                  title={`Set to ${n} slots`}
                >
                  {n}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={cancelAll} className="text-xs text-red-500 hover:text-red-400" title="Cancel all tasks">
              <Ban size={12} className="mr-1" /> Cancel all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={restartWorker}
              disabled={restarting}
              className="text-xs text-yellow-500 hover:text-yellow-400"
              title="Restart worker"
            >
              {restarting ? <Loader2 size={12} className="animate-spin mr-1" /> : <RefreshCw size={12} className="mr-1" />}
              Restart
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleLogs} className="text-xs text-muted-foreground">
              {showLogs ? "Hide logs" : "Logs"}
            </Button>
          </div>
        </div>
        {showLogs && (
          <div className="bg-[#060608] rounded-lg p-3 max-h-[250px] overflow-auto mt-2">
            {logsLoading ? (
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" /> Loading...
              </div>
            ) : (
              <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {logs || "No logs"}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
