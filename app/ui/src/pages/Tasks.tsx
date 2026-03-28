import { useState, useEffect, useMemo } from "react";
import { timeAgo, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useApi } from "@/hooks/use-api";
import { useTaskEvents } from "@/hooks/use-task-events";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Loader2, CheckCircle2, XCircle, Clock, Ban, RefreshCw,
  ChevronDown, ChevronUp, RotateCcw, Trash2, Activity,
  Filter, Zap, Cpu, Minus, Plus,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────

interface TaskProgress {
  artist?: string;
  album?: string;
  step?: string;
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
  analyzed?: number;
  track?: string;
  [key: string]: unknown;
}

interface Task {
  id: string;
  type: string;
  status: string;
  progress: TaskProgress | string;
  error: string | null;
  params: Record<string, string> | null;
  result: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
}

// ── Constants ────────────────────────────────────────────────────

const STATUS_CONFIG = {
  running: { icon: Loader2, color: "text-blue-500", label: "Running", bg: "bg-blue-500/10 border-blue-500/20" },
  pending: { icon: Clock, color: "text-yellow-500", label: "Pending", bg: "bg-yellow-500/10 border-yellow-500/20" },
  completed: { icon: CheckCircle2, color: "text-green-500", label: "Completed", bg: "" },
  failed: { icon: XCircle, color: "text-red-500", label: "Failed", bg: "bg-red-500/5" },
  cancelled: { icon: Ban, color: "text-muted-foreground", label: "Cancelled", bg: "" },
} as const;

function getStatus(status: string) {
  return STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? { icon: Clock, color: "text-muted-foreground", label: status, bg: "" };
}

const TYPE_LABELS: Record<string, string> = {
  scan: "Library Scan",
  compute_analytics: "Compute Analytics",
  enrich_artists: "Enrich All Artists",
  enrich_artist: "Enrich Artist",
  enrich_mbids: "Enrich MusicBrainz IDs",
  fetch_artwork_all: "Fetch All Artwork",
  fetch_cover: "Fetch Cover",
  fetch_artist_covers: "Fetch Artist Covers",
  batch_retag: "Batch Retag",
  batch_covers: "Batch Fetch Covers",
  library_sync: "Library Sync",
  library_pipeline: "Library Pipeline",
  health_check: "Health Check",
  repair: "Library Repair",
  delete_artist: "Delete Artist",
  delete_album: "Delete Album",
  move_artist: "Move Artist",
  wipe_library: "Wipe Library",
  rebuild_library: "Rebuild Library",
  reset_enrichment: "Reset Enrichment",
  match_apply: "Apply MusicBrainz Tags",
  update_album_tags: "Update Album Tags",
  update_track_tags: "Update Track Tags",
  resolve_duplicates: "Resolve Duplicates",
  analyze_tracks: "Analyze Audio",
  analyze_all: "Analyze All Audio",
  compute_popularity: "Compute Popularity",
  index_genres: "Index Genres",
  sync_playlist_navidrome: "Sync Playlist",
  process_new_content: "Process New Content",
  compute_bliss: "Compute Bliss Vectors",
  tidal_download: "Tidal Download",
  check_new_releases: "Check New Releases",
  scan_missing_covers: "Scan Missing Covers",
};

function getTaskLabel(task: Task): string {
  const base = TYPE_LABELS[task.type] ?? task.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const p = task.params;
  if (!p) return base;
  if (p.artist && p.album) return `${base}: ${p.artist} / ${p.album}`;
  if (p.artist) return `${base}: ${p.artist}`;
  if (p.name) return `${base}: ${p.name}`;
  if (p.artist_folder && p.album_folder) return `${base}: ${p.artist_folder} / ${p.album_folder}`;
  return base;
}

// ── Human-readable result summaries ──────────────────────────────

function describeResult(task: Task): string {
  if (task.error) return task.error.length > 100 ? task.error.slice(0, 100) + "..." : task.error;
  const r = task.result;
  if (!r) return task.status === "completed" ? "Completed" : "";

  const type = task.type;

  // Process new content
  if (type === "process_new_content") {
    const steps = r.steps as Record<string, unknown> | undefined;
    if (steps) {
      const done = Object.entries(steps).filter(([, v]) => v !== "failed" && v !== false).length;
      const failed = Object.entries(steps).filter(([, v]) => v === "failed").length;
      return `${done} steps done${failed ? `, ${failed} failed` : ""}`;
    }
  }

  // Enrichment
  if (type === "enrich_artist") {
    if (r.skipped) return "Skipped (recently enriched)";
    return "Artist enriched";
  }
  if (type === "enrich_artists" || type === "enrich_mbids") {
    const parts: string[] = [];
    if (r.enriched) parts.push(`${r.enriched} enriched`);
    if (r.skipped) parts.push(`${r.skipped} skipped`);
    if (r.failed) parts.push(`${r.failed} failed`);
    return parts.join(", ") || "Done";
  }

  // Analysis
  if (type === "analyze_tracks" || type === "analyze_all") {
    return `${r.analyzed ?? 0} tracks analyzed${r.failed ? `, ${r.failed} failed` : ""} of ${r.total ?? "?"}`;
  }
  if (type === "compute_bliss") {
    return `${r.analyzed ?? 0} tracks vectorized${r.failed ? `, ${r.failed} failed` : ""}`;
  }

  // Health & repair
  if (type === "health_check") return `${r.issue_count ?? 0} issues found`;
  if (type === "repair") {
    const actions = (r.actions as unknown[])?.length ?? 0;
    return `${actions} actions${r.fs_changed ? " (filesystem modified)" : ""}`;
  }

  // Sync
  if (type === "library_sync" || type === "library_pipeline") {
    const parts: string[] = [];
    if (r.artists_added) parts.push(`+${r.artists_added} artists`);
    if (r.tracks_total) parts.push(`${r.tracks_total} tracks`);
    return parts.join(", ") || "Synced";
  }

  // Match apply
  if (type === "match_apply") return `${r.updated ?? 0}/${r.total ?? "?"} tracks tagged`;

  // Delete
  if (type === "delete_artist" || type === "delete_album") return "Deleted";

  // Popularity
  if (type === "compute_popularity") {
    const parts: string[] = [];
    if (r.albums) parts.push(`${r.albums} albums`);
    if (r.tracks) parts.push(`${r.tracks} tracks`);
    return parts.join(", ") || "Done";
  }

  // Analytics
  if (type === "compute_analytics") return "Analytics computed";

  // Tidal
  if (type === "tidal_download") return r.error ? String(r.error) : "Downloaded";

  // Covers
  if (type === "scan_missing_covers" || type === "fetch_artwork_all") {
    return `${r.found ?? r.fetched ?? 0} covers`;
  }

  // Generic
  const keys = Object.keys(r);
  if (keys.length === 0) return "Done";
  if (keys.length <= 3) return keys.map((k) => `${k}: ${JSON.stringify(r[k])}`).join(", ");
  return `${keys.length} fields`;
}

// ── Formatters ───────────────────────────────────────────────────

function fmtDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}


// ── Progress Display ─────────────────────────────────────────────

function TaskProgressBar({ progress }: { progress: TaskProgress | string }) {
  if (typeof progress === "string") {
    return progress ? <span className="text-xs text-muted-foreground">{progress}</span> : null;
  }

  const done = progress.done ?? progress.artists_done;
  const total = progress.total ?? progress.artists_total;

  if (done != null && total != null && total > 0) {
    const pct = Math.round((done / total) * 100);
    return (
      <div className="space-y-1">
        <Progress value={pct} className="h-1.5" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {progress.step && <Badge variant="outline" className="text-[10px] px-1 py-0 mr-1">{progress.step.replace(/_/g, " ")}</Badge>}
            {progress.phase && <Badge variant="outline" className="text-[10px] px-1 py-0 mr-1">{String(progress.phase)}</Badge>}
            {progress.artist && <span className="text-foreground">{String(progress.artist)}</span>}
            {progress.album && <span className="text-foreground/70">{" / "}{String(progress.album)}</span>}
            {progress.track && <span className="text-foreground/70">{" — "}{String(progress.track)}</span>}
          </span>
          <span>{done}/{total} ({pct}%)</span>
        </div>
      </div>
    );
  }

  if (progress.step) {
    return <span className="text-xs text-muted-foreground">Step: {progress.step.replace(/_/g, " ")}{progress.artist ? ` — ${progress.artist}` : ""}</span>;
  }
  if (progress.message) {
    return <span className="text-xs text-muted-foreground">{String(progress.message)}</span>;
  }
  return null;
}

// ── Live Events for Running Task ─────────────────────────────────

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

function eventMessage(e: { type: string; data?: Record<string, unknown> }): string {
  if (e.data?.message) return String(e.data.message);
  if (e.data?.step) return String(e.data.step).replace(/_/g, " ");
  if (e.data) {
    const keys = Object.keys(e.data);
    if (keys.length <= 3) return keys.map((k) => `${k}: ${e.data![k]}`).join(", ");
  }
  return e.type.replace(/_/g, " ");
}

function LiveTaskEvents({ taskId }: { taskId: string }) {
  const { events, connected } = useTaskEvents(taskId);

  if (events.length === 0) {
    return <div className="text-xs text-muted-foreground py-2">{connected ? "Waiting for events..." : "Connecting..."}</div>;
  }

  return (
    <div className="max-h-[300px] overflow-y-auto space-y-0.5 py-2 font-mono">
      {events.map((e, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <span className="text-[10px] text-muted-foreground flex-shrink-0 w-14">
            {new Date(e.timestamp || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <Badge className={`text-[9px] px-1 py-0 flex-shrink-0 border ${EVENT_BADGE_COLORS[e.type] || "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"}`}>
            {e.type.replace(/_/g, " ")}
          </Badge>
          <span className="text-foreground/80">
            {eventMessage(e)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────

export function Tasks() {
  const { data: tasks, loading, refetch } = useApi<Task[]>("/api/tasks?limit=100");
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Auto-refresh: 2s if running tasks, 5s otherwise (catches new tasks)
  useEffect(() => {
    const hasActive = tasks?.some((t) => t.status === "running" || t.status === "pending");
    const interval = hasActive ? 2000 : 5000;
    const timer = setInterval(refetch, interval);
    return () => clearInterval(timer);
  }, [tasks, refetch]);

  const handleCancel = async (id: string) => {
    try {
      await api(`/api/tasks/${id}/cancel`, "POST");
      toast.success("Task cancelled");
      refetch();
    } catch { toast.error("Failed to cancel"); }
    setCancelId(null);
  };

  const handleRetry = async (task: Task) => {
    try {
      await api("/api/tasks/retry", "POST", { task_id: task.id });
      toast.success(`Retrying: ${getTaskLabel(task)}`);
      refetch();
    } catch {
      toast.error("Failed to retry task");
    }
  };

  const handleCleanup = async () => {
    try {
      const res = await api<{ deleted: number }>("/api/tasks/cleanup", "POST", { older_than_days: 7 });
      toast.success(`Cleaned up ${res.deleted} old tasks`);
      refetch();
    } catch { toast.error("Cleanup failed"); }
  };

  const running = tasks?.filter((t) => t.status === "running") ?? [];
  const pending = tasks?.filter((t) => t.status === "pending") ?? [];
  const completed = tasks?.filter((t) => !["running", "pending"].includes(t.status)) ?? [];

  // Available task types for filter
  const taskTypes = useMemo(() => {
    if (!tasks) return [];
    const types = new Set(tasks.map((t) => t.type));
    return Array.from(types).sort();
  }, [tasks]);

  // Filtered history
  const filteredHistory = useMemo(() => {
    let filtered = completed;
    if (filterType !== "all") filtered = filtered.filter((t) => t.type === filterType);
    if (filterStatus !== "all") filtered = filtered.filter((t) => t.status === filterStatus);
    return filtered;
  }, [completed, filterType, filterStatus]);

  // Stats
  const stats = useMemo(() => {
    if (!tasks) return null;
    const today = new Date().toDateString();
    const todayTasks = tasks.filter((t) => new Date(t.created_at).toDateString() === today);
    const completedToday = todayTasks.filter((t) => t.status === "completed").length;
    const failedToday = todayTasks.filter((t) => t.status === "failed").length;
    const avgDuration = tasks
      .filter((t) => t.status === "completed")
      .slice(0, 20)
      .reduce((sum, t) => sum + (new Date(t.updated_at).getTime() - new Date(t.started_at || t.created_at).getTime()), 0);
    const avgCount = Math.min(20, tasks.filter((t) => t.status === "completed").length);
    return {
      todayTotal: todayTasks.length,
      todayCompleted: completedToday,
      todayFailed: failedToday,
      successRate: todayTasks.length > 0 ? Math.round((completedToday / (completedToday + failedToday || 1)) * 100) : 100,
      avgDuration: avgCount > 0 ? Math.round(avgDuration / avgCount / 1000) : 0,
    };
  }, [tasks]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-3">
          Tasks
          <Button variant="ghost" size="sm" onClick={refetch}><RefreshCw size={14} /></Button>
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleCleanup} className="text-xs text-muted-foreground">
            <Trash2 size={12} className="mr-1" /> Cleanup old
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Trash2 size={14} className="mr-1" /> Clean
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={async () => {
                const res = await api<{deleted: number}>("/api/tasks/clean/completed", "POST");
                toast.success(`Cleaned ${res.deleted} completed tasks`);
                refetch();
              }}>
                Completed tasks
              </DropdownMenuItem>
              <DropdownMenuItem onClick={async () => {
                const res = await api<{deleted: number}>("/api/tasks/clean/failed", "POST");
                toast.success(`Cleaned ${res.deleted} failed tasks`);
                refetch();
              }}>
                Failed tasks
              </DropdownMenuItem>
              <DropdownMenuItem onClick={async () => {
                const res = await api<{deleted: number}>("/api/tasks/clean/cancelled", "POST");
                toast.success(`Cleaned ${res.deleted} cancelled tasks`);
                refetch();
              }}>
                Cancelled tasks
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-lg font-bold">{stats.todayTotal}</div>
            <div className="text-[11px] text-muted-foreground">Today</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-lg font-bold text-green-500">{stats.todayCompleted}</div>
            <div className="text-[11px] text-muted-foreground">Completed</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-lg font-bold text-red-500">{stats.todayFailed}</div>
            <div className="text-[11px] text-muted-foreground">Failed</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-lg font-bold">{stats.successRate}%</div>
            <div className="text-[11px] text-muted-foreground">Success Rate</div>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <div className="text-lg font-bold">{stats.avgDuration}s</div>
            <div className="text-[11px] text-muted-foreground">Avg Duration</div>
          </div>
        </div>
      )}

      {/* Worker Status */}
      <WorkerStatus running={running.length} pending={pending.length} />

      {/* Active tasks */}
      {(running.length > 0 || pending.length > 0) && (
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity size={14} className="text-blue-500" />
              Active Tasks ({running.length + pending.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[...running, ...pending].map((task) => {
              const cfg = getStatus(task.status);
              const Icon = cfg.icon;
              const isExpanded = expandedId === task.id;
              return (
                <div key={task.id} className={`border rounded-lg overflow-hidden ${cfg.bg}`}>
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Icon size={16} className={`${cfg.color} ${task.status === "running" ? "animate-spin" : ""}`} />
                        <div>
                          <div className="font-medium text-sm">{getTaskLabel(task)}</div>
                          <div className="text-xs text-muted-foreground">
                            {task.status === "running" && task.started_at
                              ? <>Running for {fmtDuration(task.started_at, new Date().toISOString())}</>
                              : <>Queued {timeAgo(task.created_at)}</>}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {task.status === "running" && (
                          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setExpandedId(isExpanded ? null : task.id)}>
                            <Zap size={11} className="mr-1" /> {isExpanded ? "Hide" : "Live"}
                          </Button>
                        )}
                        <Button variant="outline" size="sm" className="text-red-500 border-red-500/30 hover:bg-red-500/10 h-7"
                          onClick={() => setCancelId(task.id)}>
                          <Ban size={11} className="mr-1" /> Cancel
                        </Button>
                      </div>
                    </div>
                    <TaskProgressBar progress={task.progress} />
                  </div>
                  {isExpanded && task.status === "running" && (
                    <div className="border-t border-border px-4 bg-black/20">
                      <LiveTaskEvents taskId={task.id} />
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* History with filters */}
      <Card className="bg-card">
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm">Task History ({filteredHistory.length})</CardTitle>
            <div className="flex items-center gap-2">
              <Filter size={13} className="text-muted-foreground" />
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-7 w-[180px] text-xs bg-input border-border">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {taskTypes.map((t) => (
                    <SelectItem key={t} value={t}>{TYPE_LABELS[t] ?? t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-7 w-[130px] text-xs bg-input border-border">
                  <SelectValue placeholder="All status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">No tasks match filters</div>
          ) : (
            <div className="space-y-1">
              {filteredHistory.map((task) => (
                <TaskRow key={task.id} task={task} expanded={expandedId === task.id}
                  onToggle={() => setExpandedId(expandedId === task.id ? null : task.id)}
                  onRetry={() => handleRetry(task)} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={cancelId !== null}
        onOpenChange={(open) => { if (!open) setCancelId(null); }}
        title="Cancel Task"
        description="Are you sure you want to cancel this task?"
        confirmLabel="Cancel Task"
        variant="destructive"
        onConfirm={() => { if (cancelId) handleCancel(cancelId); }}
      />
    </div>
  );
}

// ── Task Row ─────────────────────────────────────────────────────

function TaskRow({ task, expanded, onToggle, onRetry }: {
  task: Task; expanded: boolean; onToggle: () => void; onRetry: () => void;
}) {
  const cfg = getStatus(task.status);
  const Icon = cfg.icon;
  const summary = describeResult(task);

  return (
    <div className={`border border-border rounded-lg overflow-hidden ${cfg.bg}`}>
      <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-secondary/20 transition-colors" onClick={onToggle}>
        <Icon size={14} className={cfg.color} />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">{getTaskLabel(task)}</span>
          <span className="text-xs text-muted-foreground ml-2">{summary}</span>
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {fmtDuration(task.started_at || task.created_at, task.updated_at)}
        </span>
        <span className="text-[11px] text-muted-foreground flex-shrink-0 w-[80px] text-right hidden sm:block">
          {timeAgo(task.updated_at)}
        </span>
        {task.status === "failed" && (
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground flex-shrink-0"
            onClick={(e) => { e.stopPropagation(); onRetry(); }} title="Retry">
            <RotateCcw size={12} />
          </Button>
        )}
        {expanded ? <ChevronUp size={14} className="text-muted-foreground flex-shrink-0" /> : <ChevronDown size={14} className="text-muted-foreground flex-shrink-0" />}
      </div>
      {expanded && (
        <div className="px-4 py-3 border-t border-border bg-secondary/10 space-y-3">
          {/* Task metadata */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">ID:</span>{" "}
              <span className="font-mono">{task.id}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Type:</span>{" "}
              <span className="font-mono">{task.type}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Created:</span>{" "}
              {new Date(task.created_at).toLocaleString()}
            </div>
            <div>
              <span className="text-muted-foreground">Duration:</span>{" "}
              {fmtDuration(task.started_at || task.created_at, task.updated_at)}
            </div>
          </div>

          {/* Params */}
          {task.params && Object.keys(task.params).length > 0 && (
            <div>
              <span className="text-xs font-semibold text-muted-foreground">Params:</span>
              <pre className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-all bg-secondary/30 p-2 rounded font-mono">
                {JSON.stringify(task.params, null, 2)}
              </pre>
            </div>
          )}

          {/* Error */}
          {task.error && (
            <div>
              <span className="text-xs font-semibold text-red-500">Error:</span>
              <pre className="text-xs text-red-400 mt-1 whitespace-pre-wrap break-all bg-red-500/5 p-2 rounded font-mono">
                {task.error}
              </pre>
            </div>
          )}

          {/* Result */}
          {task.result && (
            <div>
              <span className="text-xs font-semibold text-muted-foreground">Result:</span>
              <pre className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-all bg-secondary/30 p-2 rounded font-mono max-h-[300px] overflow-y-auto">
                {JSON.stringify(task.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Worker Status ────────────────────────────────────────────────

interface WorkerInfo {
  max_slots: number;
  running: number;
  pending: number;
  running_tasks: { id: string; type: string; params?: Record<string, string> }[];
  pending_tasks: { id: string; type: string }[];
}

function WorkerStatus({ running, pending }: { running: number; pending: number }) {
  const [workerInfo, setWorkerInfo] = useState<WorkerInfo | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    api<WorkerInfo>("/api/worker/status").then(setWorkerInfo).catch(() => {});
    const timer = setInterval(() => { api<WorkerInfo>("/api/worker/status").then(setWorkerInfo).catch(() => {}); }, 5000);
    return () => clearInterval(timer);
  }, []);

  const maxSlots = workerInfo?.max_slots ?? 3;
  const runningTasks = workerInfo?.running_tasks ?? [];

  async function incrementSlots() {
    const next = maxSlots + 1;
    if (next > 5) return;
    try {
      await api("/api/worker/slots", "POST", { slots: next });
      setWorkerInfo((prev) => prev ? { ...prev, max_slots: next } : prev);
      toast.success(`Worker slots set to ${next}`);
    } catch { toast.error("Failed to set slots"); }
  }

  async function decrementSlots() {
    const next = maxSlots - 1;
    if (next < 1) return;
    try {
      await api("/api/worker/slots", "POST", { slots: next });
      setWorkerInfo((prev) => prev ? { ...prev, max_slots: next } : prev);
      toast.success(`Worker slots set to ${next}`);
    } catch { toast.error("Failed to set slots"); }
  }

  async function restartWorker() {
    setRestarting(true);
    try { await api("/api/worker/restart", "POST"); toast.success("Worker restarting..."); }
    catch { toast.error("Restart failed"); }
    finally { setTimeout(() => setRestarting(false), 5000); }
  }

  async function cancelAll() {
    try {
      const res = await api<{ cancelled: number }>("/api/worker/cancel-all", "POST");
      toast.success(`Cancelled ${res.cancelled} tasks`);
    } catch { toast.error("Failed to cancel tasks"); }
  }

  async function toggleLogs() {
    if (showLogs) { setShowLogs(false); return; }
    setShowLogs(true);
    setLogsLoading(true);
    try {
      const d = await api<{ name: string; logs: string }>("/api/stack/container/crate-worker/logs?tail=40");
      setLogs(d.logs);
    } catch { setLogs("Failed to load logs"); }
    finally { setLogsLoading(false); }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu size={16} />
            Workers
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={decrementSlots} disabled={maxSlots <= 1}>
              <Minus size={12} />
            </Button>
            <span className="text-sm font-mono w-6 text-center">{maxSlots}</span>
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={incrementSlots} disabled={maxSlots >= 5}>
              <Plus size={12} />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-red-400" onClick={restartWorker} disabled={restarting} title="Restart workers">
              {restarting ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            </Button>
            <Button variant="ghost" size="sm" onClick={cancelAll} className="text-xs text-red-500 hover:text-red-400 h-7">
              <Ban size={12} className="mr-1" /> Cancel all
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleLogs} className="text-xs text-muted-foreground h-7">
              {showLogs ? "Hide logs" : "Logs"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Slot bar visualization */}
        <div className="flex gap-1 mb-3">
          {Array.from({ length: maxSlots }, (_, i) => {
            const task = runningTasks[i];
            return (
              <div
                key={i}
                className={cn(
                  "h-8 flex-1 rounded-md flex items-center justify-center text-[10px] truncate px-1 transition-colors",
                  task
                    ? "bg-primary/20 border border-primary/30 text-primary"
                    : "bg-muted/30 border border-border text-muted-foreground/40"
                )}
                title={task ? `${task.type}: ${task.params?.artist || task.id}` : "Idle"}
              >
                {task ? (task.params?.artist || task.type.replace(/_/g, " ")) : "idle"}
              </div>
            );
          })}
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{running} running</span>
          <span>{pending} pending</span>
          <span>{maxSlots} slots</span>
        </div>

        {/* Logs */}
        {showLogs && (
          <div className="bg-[#060608] rounded-lg p-3 max-h-[250px] overflow-auto mt-3">
            {logsLoading ? (
              <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Loading...</div>
            ) : (
              <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">{logs || "No logs"}</pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

