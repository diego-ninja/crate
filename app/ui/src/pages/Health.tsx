import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { CrateChip, CratePill } from "@crate/ui/primitives/CrateBadge";
import { timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Button } from "@crate/ui/shadcn/button";
import { Card } from "@crate/ui/shadcn/card";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Stethoscope, Loader2, CheckCircle2, AlertTriangle,
  XCircle, Info, Wrench, ChevronDown, ChevronUp,
  EyeOff,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { useTaskEvents } from "@/hooks/use-task-events";
import {
  pickLatestRepairTask,
  repairOutcomeTone,
  taskNeedsAttention,
  taskRevalidationIssueCount,
  type TaskInsightLike,
} from "@/lib/task-insights";

interface HealthIssue {
  id: number;
  check_type: string;
  severity: string;
  description: string;
  details_json: Record<string, unknown>;
  auto_fixable: boolean;
  status: string;
  created_at: string;
}

interface HealthSnapshotData {
  snapshot: {
    scope: string;
    subject_key: string;
    version: number;
    stale: boolean;
    generation_ms: number;
  };
  issues: HealthIssue[];
  counts: Record<string, number>;
  total: number;
  filter: string | null;
}

interface RepairCatalogEntry {
  check_type: string;
  scanner_method: string;
  fixer_method?: string | null;
  support: string;
  risk: string;
  scope: string;
  requires_confirmation: boolean;
  supports_batch: boolean;
  supports_artist_scope: boolean;
  supports_global_scope: boolean;
  auto_fixable: boolean;
}

interface RepairCatalogResponse {
  items: RepairCatalogEntry[];
}

interface RepairHistoryTask extends TaskInsightLike {
  id: string;
  type: string;
  status: string;
  error: string | null;
  result: Record<string, unknown> | null;
  updated_at: string;
  created_at: string;
}

interface TasksSnapshotLite {
  history: RepairHistoryTask[];
}

const SEVERITY_ICONS: Record<string, typeof AlertTriangle> = {
  critical: XCircle, high: AlertTriangle, medium: Info, low: Info,
};
const SEVERITY_COLORS: Record<string, { text: string; border: string; bg: string }> = {
  critical: { text: "text-red-500", border: "border-red-500/30", bg: "bg-red-500/5" },
  high: { text: "text-orange-500", border: "border-orange-500/30", bg: "bg-orange-500/5" },
  medium: { text: "text-yellow-500", border: "border-yellow-500/30", bg: "bg-yellow-500/5" },
  low: { text: "text-muted-foreground", border: "border-border", bg: "bg-card" },
};
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const CHECK_LABELS: Record<string, string> = {
  duplicate_folders: "Duplicate Folders",
  canonical_mismatch: "Canonical Mismatch",
  fk_orphan_albums: "Orphan Albums",
  fk_orphan_tracks: "Orphan Tracks",
  stale_artists: "Stale Artists",
  stale_albums: "Stale Albums",
  stale_tracks: "Stale Tracks",
  zombie_artists: "Empty Artists",
  has_photo_desync: "Photo Desync",
  artist_layout_fix: "Artist Layout Fix",
  duplicate_albums: "Duplicate Albums",
  unindexed_files: "Unindexed Files",
  tag_mismatch: "Tag Mismatch",
  folder_naming: "Folder Naming",
  missing_cover: "Missing Covers",
};

const CHECK_DESCRIPTIONS: Record<string, string> = {
  duplicate_folders: "Multiple folders that normalize to the same artist name",
  canonical_mismatch: "Folder name doesn't match the canonical artist name from tags",
  fk_orphan_albums: "Albums in DB with no matching artist record",
  fk_orphan_tracks: "Tracks in DB with no matching album record",
  stale_artists: "Artists in DB with no folder on disk",
  stale_albums: "Albums in DB with no folder on disk",
  stale_tracks: "Tracks in DB with no file on disk",
  zombie_artists: "Artists with 0 albums and 0 tracks",
  has_photo_desync: "Artist photo flag in DB doesn't match filesystem",
  artist_layout_fix: "Artist filesystem layout or canonical entity-UID directory needs consolidation",
  duplicate_albums: "Same album name appears multiple times for an artist",
  unindexed_files: "Audio files on disk not indexed in DB",
  tag_mismatch: "Album artist tag doesn't match folder artist name",
  folder_naming: "Folder structure doesn't match the configured naming pattern",
  missing_cover: "Albums without cover art (cover.jpg/cover.png)",
};

const RISK_TONES: Record<string, string> = {
  safe: "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-100",
  caution: "border-amber-500/20 bg-amber-500/[0.06] text-amber-100",
  destructive: "border-red-500/20 bg-red-500/[0.08] text-red-100",
};

const SCOPE_TONES: Record<string, string> = {
  db: "border-cyan-400/20 bg-cyan-400/[0.05] text-cyan-100",
  filesystem: "border-fuchsia-400/20 bg-fuchsia-400/[0.05] text-fuchsia-100",
  hybrid: "border-violet-400/20 bg-violet-400/[0.06] text-violet-100",
};

const REPAIR_OUTCOME_TONES: Record<string, string> = {
  success: "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-100",
  warning: "border-amber-500/20 bg-amber-500/[0.06] text-amber-100",
  danger: "border-red-500/20 bg-red-500/[0.08] text-red-100",
  neutral: "border-white/10 bg-white/[0.04] text-white/70",
};

function riskLabel(risk: string | undefined) {
  if (risk === "safe") return "Safe";
  if (risk === "caution") return "Needs review";
  if (risk === "destructive") return "Destructive";
  return "Unknown";
}

function scopeLabel(scope: string | undefined) {
  if (scope === "db") return "Database";
  if (scope === "filesystem") return "Filesystem";
  if (scope === "hybrid") return "DB + filesystem";
  return "Unknown scope";
}

function executionLane(entry: RepairCatalogEntry | undefined) {
  if (!entry) return "Unknown";
  if (entry.support === "manual" || !entry.auto_fixable) return "Manual only";
  if (entry.supports_global_scope) return "Global batch";
  if (entry.supports_artist_scope) return "Artist review";
  return "Review required";
}

function executionLaneTone(entry: RepairCatalogEntry | undefined) {
  if (!entry) return "border-white/10 bg-white/[0.04] text-white/55";
  if (entry.support === "manual" || !entry.auto_fixable) return "border-white/10 bg-white/[0.04] text-white/55";
  if (entry.supports_global_scope) return "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-100";
  return "border-amber-500/20 bg-amber-500/[0.06] text-amber-100";
}

function latestRepairSummary(task: RepairHistoryTask | null) {
  if (!task) return "No repair or health runs recorded yet.";
  if (task.error) return task.error;

  const result = task.result ?? {};
  if (task.type === "repair") {
    const summary = (result.summary as Record<string, unknown> | undefined) ?? {};
    const remaining = taskRevalidationIssueCount(result);
    const parts = [`${Number(summary.applied ?? 0)} applied`];
    if (Number(summary.skipped ?? 0) > 0) parts.push(`${Number(summary.skipped ?? 0)} skipped`);
    if (Number(summary.failed ?? 0) > 0) parts.push(`${Number(summary.failed ?? 0)} failed`);
    if (Number(summary.unsupported ?? 0) > 0) parts.push(`${Number(summary.unsupported ?? 0)} manual`);
    if (remaining != null) parts.push(`${remaining} open after revalidation`);
    return parts.join(", ");
  }

  if (task.type === "fix_artist") {
    const parts = [
      `${Number(result.albums_fixed ?? 0)} albums fixed`,
      `${Number(result.synced_tracks ?? 0)} tracks synced`,
    ];
    const remaining = taskRevalidationIssueCount(result);
    if (remaining != null) parts.push(`${remaining} open after revalidation`);
    return parts.join(", ");
  }

  if (task.type === "health_check") {
    return `${Number(result.issue_count ?? 0)} issue${Number(result.issue_count ?? 0) === 1 ? "" : "s"} found`;
  }

  return "Repair run completed";
}

function repairOutcomeLabel(task: RepairHistoryTask | null) {
  if (!task) return "No recent repair";
  if (task.status === "failed") return "Failed";
  if (taskNeedsAttention(task)) return "Needs attention";
  if (task.status === "completed") return "Completed cleanly";
  if (task.status === "cancelled") return "Cancelled";
  return task.status;
}

export function Health() {
  const { isAdmin } = useAuth();
  const [issues, setIssues] = useState<HealthIssue[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [catalogByCheck, setCatalogByCheck] = useState<Record<string, RepairCatalogEntry>>({});
  const [latestRepairTask, setLatestRepairTask] = useState<RepairHistoryTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [fixing, setFixing] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const taskReconnectTimerRef = useRef<number | null>(null);
  const { done: activeTaskDone, reset: resetTaskEvents } = useTaskEvents(activeTaskId);

  async function fetchRepairCatalog() {
    try {
      const data = await api<RepairCatalogResponse>("/api/manage/repair-catalog");
      setCatalogByCheck(
        Object.fromEntries(data.items.map((item) => [item.check_type, item])),
      );
    } catch {
      // Keep health usable even if the catalog fails to load.
    }
  }

  function applyLatestRepair(history: RepairHistoryTask[]) {
    setLatestRepairTask(pickLatestRepairTask(history));
  }

  async function fetchLatestRepairTask(fresh = false) {
    try {
      const query = fresh ? "?limit=40&fresh=1" : "?limit=40";
      const data = await api<TasksSnapshotLite>(`/api/admin/tasks-snapshot${query}`);
      applyLatestRepair(data.history ?? []);
    } catch {
      // Keep the rest of the surface usable if tasks snapshot is temporarily unavailable.
    }
  }

  async function fetchIssues(fresh = false) {
    try {
      const query = new URLSearchParams();
      if (filter) query.set("check_type", filter);
      if (fresh) query.set("fresh", "1");
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const data = await api<HealthSnapshotData>(`/api/admin/health-snapshot${suffix}`);
      setIssues(data.issues);
      setCounts(data.counts);
      setError(null);
    } catch {
      setError("Failed to load health issues");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchIssues();
  }, [filter]);

  useEffect(() => {
    void fetchRepairCatalog();
  }, []);

  useEffect(() => {
    void fetchLatestRepairTask();
  }, []);

  useEffect(() => {
    let disposed = false;
    let stream: EventSource | null = null;

    function connect() {
      if (disposed) return;
      const query = filter ? `?check_type=${encodeURIComponent(filter)}` : "";
      stream = new EventSource(`/api/admin/health-stream${query}`, { withCredentials: true });
      stream.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as HealthSnapshotData;
          setIssues(payload.issues);
          setCounts(payload.counts);
          setError(null);
          setLoading(false);
        } catch {
          // Ignore malformed payloads and wait for the next event.
        }
      };
      stream.onerror = () => {
        stream?.close();
        if (!disposed) {
          reconnectTimerRef.current = window.setTimeout(connect, 3000);
        }
      };
    }

    connect();
    return () => {
      disposed = true;
      stream?.close();
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [filter]);

  useEffect(() => {
    let disposed = false;
    let stream: EventSource | null = null;

    function connect() {
      if (disposed) return;
      stream = new EventSource("/api/admin/tasks-stream?limit=40", { withCredentials: true });
      stream.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as TasksSnapshotLite;
          applyLatestRepair(payload.history ?? []);
        } catch {
          // Ignore malformed payloads and wait for the next event.
        }
      };
      stream.onerror = () => {
        stream?.close();
        if (!disposed) {
          taskReconnectTimerRef.current = window.setTimeout(connect, 5000);
        }
      };
    }

    connect();
    return () => {
      disposed = true;
      stream?.close();
      if (taskReconnectTimerRef.current !== null) {
        window.clearTimeout(taskReconnectTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!activeTaskId || !activeTaskDone) return;
    if (activeTaskDone.status === "completed") {
      const revalidation = activeTaskDone.result?.revalidation as Record<string, unknown> | undefined;
      const remaining = Number(revalidation?.issue_count ?? NaN);
      if (!scanning && Number.isFinite(remaining)) {
        toast.success(
          remaining > 0
            ? `Repair complete: ${remaining} issue${remaining === 1 ? "" : "s"} remain after revalidation`
            : "Repair complete: no open issues remain after revalidation",
        );
      } else {
        toast.success(scanning ? "Scan complete" : "Repair complete");
      }
      void fetchIssues(true);
      void fetchLatestRepairTask(true);
    } else if (activeTaskDone.status === "failed") {
      toast.error(scanning ? "Scan failed" : "Repair failed");
      void fetchLatestRepairTask(true);
    }
    setScanning(false);
    setFixing(null);
    setActiveTaskId(null);
    resetTaskEvents();
  }, [activeTaskDone, activeTaskId, resetTaskEvents, scanning]);

  async function runScan() {
    setScanning(true);
    try {
      const { task_id } = await api<{ task_id: string }>("/api/manage/health-check", "POST");
      toast.success("Health scan started...");
      setActiveTaskId(task_id);
    } catch { setScanning(false); toast.error("Failed to start scan"); }
  }

  async function handleResolve(id: number) {
    await api(`/api/manage/health-issues/${id}/resolve`, "POST");
    removeIssue(id);
    toast.success("Issue resolved");
  }

  async function handleDismiss(id: number) {
    await api(`/api/manage/health-issues/${id}/dismiss`, "POST");
    removeIssue(id);
  }

  function removeIssue(id: number) {
    const issue = issues.find((i) => i.id === id);
    setIssues((prev) => prev.filter((i) => i.id !== id));
    if (issue) {
      setCounts((prev) => {
        const n = { ...prev };
        const val = (n[issue.check_type] || 1) - 1;
        if (val <= 0) delete n[issue.check_type];
        else n[issue.check_type] = val;
        return n;
      });
    }
  }

  async function handleFixType(checkType: string) {
    setFixing(checkType);
    try {
      const res = await api<{ task_id: string | null; fixable: number; allowed: boolean; reason?: string | null }>(
        `/api/manage/health-issues/fix-type/${checkType}`,
        "POST",
      );
      if (!res.task_id) {
        if (res.reason === "global_scope_not_supported") {
          toast.error("This repair must be reviewed artist-by-artist");
        } else if (res.reason === "not_auto_fixable") {
          toast.error("Automatic fix is not available for this repair type");
        } else {
          toast.error("No auto-fixable issues");
        }
        setFixing(null);
        return;
      }
      toast.success(`Fixing ${res.fixable} issues...`);
      setActiveTaskId(res.task_id);
    } catch { setFixing(null); toast.error("Failed to start repair"); }
  }

  async function handleDismissType(checkType: string) {
    await api(`/api/manage/health-issues/resolve-type/${checkType}`, "POST");
    setIssues((prev) => prev.filter((i) => i.check_type !== checkType));
    setCounts((prev) => { const n = { ...prev }; delete n[checkType]; return n; });
    toast.success("All issues dismissed");
  }

  function toggleGroup(check: string) {
    setExpandedGroups((prev) => {
      const s = new Set(prev);
      s.has(check) ? s.delete(check) : s.add(check);
      return s;
    });
  }

  const totalOpen = Object.values(counts).reduce((a, b) => a + b, 0);
  const lastScan = issues.length > 0
    ? issues.reduce((latest, i) => i.created_at > latest ? i.created_at : latest, "")
    : null;
  const catalogItems = Object.values(catalogByCheck).sort((a, b) => {
    const countDiff = (counts[b.check_type] || 0) - (counts[a.check_type] || 0);
    if (countDiff !== 0) return countDiff;
    return (CHECK_LABELS[a.check_type] || a.check_type).localeCompare(CHECK_LABELS[b.check_type] || b.check_type);
  });
  const batchReadyCount = catalogItems.filter((entry) => (counts[entry.check_type] || 0) > 0 && entry.auto_fixable && entry.supports_global_scope).length;
  const artistReviewCount = catalogItems.filter((entry) => (counts[entry.check_type] || 0) > 0 && entry.auto_fixable && !entry.supports_global_scope && entry.supports_artist_scope).length;
  const manualOnlyCount = catalogItems.filter((entry) => (counts[entry.check_type] || 0) > 0 && (!entry.auto_fixable || entry.support === "manual")).length;
  const healthyCatalogCount = catalogItems.filter((entry) => (counts[entry.check_type] || 0) === 0).length;
  const latestRepairTone = REPAIR_OUTCOME_TONES[repairOutcomeTone(latestRepairTask ?? { type: "repair", status: "cancelled" })] || REPAIR_OUTCOME_TONES.neutral;
  const latestRemaining = latestRepairTask ? taskRevalidationIssueCount(latestRepairTask.result) : null;

  // Group issues
  const grouped: { check: string; severity: string; items: HealthIssue[] }[] = [];
  const byCheck: Record<string, HealthIssue[]> = {};
  for (const issue of issues) {
    (byCheck[issue.check_type] ??= []).push(issue);
  }
  for (const [check, items] of Object.entries(byCheck).sort(
    ([, a], [, b]) => (SEVERITY_ORDER[a[0]?.severity || "low"] ?? 4) - (SEVERITY_ORDER[b[0]?.severity || "low"] ?? 4)
  )) {
    grouped.push({ check, severity: items[0]?.severity || "medium", items });
  }
  if (error) return <ErrorState message={error} onRetry={() => void fetchIssues(true)} />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="rounded-md border border-white/10 bg-panel-surface/95 p-5 shadow-[0_28px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/12 text-primary shadow-[0_18px_40px_rgba(6,182,212,0.14)]">
                <Stethoscope size={22} />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">Library Health</h1>
                <p className="text-sm text-white/55">
                  Repair queue for structural mismatches, stale records, and metadata drift across the library.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {totalOpen > 0 ? (
                <CrateChip className="border-yellow-500/25 bg-yellow-500/10 text-yellow-200">{totalOpen} open issues</CrateChip>
              ) : !loading ? (
                <CrateChip className="border-green-500/25 bg-green-500/10 text-green-300">Healthy</CrateChip>
              ) : null}
              {lastScan && <CrateChip>Last scan {timeAgo(lastScan)}</CrateChip>}
              {Object.keys(counts).length > 0 && <CrateChip>{Object.keys(counts).length} check types</CrateChip>}
            </div>
          </div>
          {isAdmin && (
            <Button onClick={runScan} disabled={scanning}>
              {scanning ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Stethoscope size={14} className="mr-2" />}
              {scanning ? "Scanning..." : "Run scan"}
            </Button>
          )}
        </div>
      </section>

      {/* Filter pills */}
      {Object.keys(counts).length > 0 && (
        <div className="flex flex-wrap gap-2">
          <CratePill active={filter === null} onClick={() => setFilter(null)}>
            All
            <span className="ml-1 text-white/40">{totalOpen}</span>
          </CratePill>
          {Object.entries(counts)
            .sort(([, a], [, b]) => b - a)
            .map(([check, count]) => (
              <CratePill key={check} active={filter === check} onClick={() => setFilter(check)}>
                {CHECK_LABELS[check] || check.replace(/_/g, " ")}
                <span className="ml-1 text-white/40">{count}</span>
              </CratePill>
            ))}
        </div>
      )}

      <Card className="border-white/10 bg-panel-surface shadow-[0_20px_52px_rgba(0,0,0,0.18)]">
        <div className="space-y-4 p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-3">
              <div>
                <div className="text-sm font-semibold text-white">Latest repair impact</div>
                <div className="mt-1 text-xs text-white/45">
                  Sticky readout of the most recent repair, fix-artist or health scan, including whether issues still remain.
                </div>
              </div>
              {latestRepairTask ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <CrateChip className={latestRepairTone}>{repairOutcomeLabel(latestRepairTask)}</CrateChip>
                    <CrateChip>{latestRepairTask.type.replace(/_/g, " ")}</CrateChip>
                    <CrateChip>Updated {timeAgo(latestRepairTask.updated_at || latestRepairTask.created_at)}</CrateChip>
                    {latestRemaining != null ? (
                      <CrateChip className={latestRemaining > 0 ? "border-amber-500/20 bg-amber-500/[0.06] text-amber-100" : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-100"}>
                        {latestRemaining > 0 ? `${latestRemaining} still open` : "No open issues remain"}
                      </CrateChip>
                    ) : null}
                  </div>
                  <div className="max-w-3xl text-sm text-white/72">
                    {latestRepairSummary(latestRepairTask)}
                  </div>
                </>
              ) : (
                <div className="text-sm text-white/55">No repair or health runs recorded yet.</div>
              )}
            </div>
            {latestRepairTask ? (
              <Button size="sm" variant="outline" asChild>
                <Link to={`/tasks?task=${latestRepairTask.id}`}>View task log</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {catalogItems.length > 0 ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card className="border-white/10 bg-panel-surface shadow-[0_20px_52px_rgba(0,0,0,0.18)]">
            <div className="space-y-4 p-5">
              <div>
                <div className="text-sm font-semibold text-white">Repair lanes</div>
                <div className="mt-1 text-xs text-white/45">
                  How open issues can be executed right now across the repair catalog.
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-emerald-200/75">Global batch</div>
                  <div className="mt-2 text-2xl font-semibold text-emerald-100">{batchReadyCount}</div>
                  <div className="mt-1 text-xs text-emerald-100/70">Checks with open issues that can run safely from Health.</div>
                </div>
                <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-amber-200/75">Artist review</div>
                  <div className="mt-2 text-2xl font-semibold text-amber-100">{artistReviewCount}</div>
                  <div className="mt-1 text-xs text-amber-100/70">Checks that need artist-level preview before applying.</div>
                </div>
                <div className="rounded-md border border-white/10 bg-white/[0.04] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-white/55">Manual only</div>
                  <div className="mt-2 text-2xl font-semibold text-white">{manualOnlyCount}</div>
                  <div className="mt-1 text-xs text-white/45">Open issues without an automatic fixer yet.</div>
                </div>
                <div className="rounded-md border border-cyan-400/20 bg-cyan-400/[0.05] px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-cyan-100/75">Healthy checks</div>
                  <div className="mt-2 text-2xl font-semibold text-cyan-100">{healthyCatalogCount}</div>
                  <div className="mt-1 text-xs text-cyan-100/70">Catalog entries with no currently open issues.</div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="border-white/10 bg-panel-surface shadow-[0_20px_52px_rgba(0,0,0,0.18)]">
            <div className="space-y-4 p-5">
              <div>
                <div className="text-sm font-semibold text-white">Repair catalog</div>
                <div className="mt-1 text-xs text-white/45">
                  Canonical capabilities per check type: route, risk and storage impact.
                </div>
              </div>
              <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {catalogItems.map((entry) => {
                  const openCount = counts[entry.check_type] || 0;
                  return (
                    <div key={entry.check_type} className="rounded-md border border-white/8 bg-black/15 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-white">
                            {CHECK_LABELS[entry.check_type] || entry.check_type}
                          </div>
                          <div className="mt-1 text-xs text-white/40">
                            {CHECK_DESCRIPTIONS[entry.check_type] || "No description available."}
                          </div>
                        </div>
                        <CrateChip className={openCount > 0 ? "border-yellow-500/25 bg-yellow-500/10 text-yellow-200" : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-100"}>
                          {openCount > 0 ? `${openCount} open` : "Healthy"}
                        </CrateChip>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <CrateChip className={executionLaneTone(entry)}>{executionLane(entry)}</CrateChip>
                        <CrateChip className={RISK_TONES[entry.risk] || RISK_TONES.caution}>{riskLabel(entry.risk)}</CrateChip>
                        <CrateChip className={SCOPE_TONES[entry.scope] || SCOPE_TONES.hybrid}>{scopeLabel(entry.scope)}</CrateChip>
                        <CrateChip>{entry.support === "manual" ? "Manual" : entry.support === "automatic" ? "Automatic" : "Scan only"}</CrateChip>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        </section>
      ) : null}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {/* Empty state */}
      {!loading && issues.length === 0 && (
        <div className="rounded-md border border-white/10 bg-panel-surface px-6 py-24 text-center shadow-[0_28px_80px_rgba(0,0,0,0.24)]">
          <CheckCircle2 size={48} className="text-green-500 mx-auto mb-3 opacity-50" />
          <div className="text-lg font-semibold text-green-500">Library is healthy</div>
          <div className="text-sm text-muted-foreground mt-1">
            {totalOpen === 0 && Object.keys(counts).length === 0 ? "Run a scan to check for issues" : "No issues found for this filter"}
          </div>
        </div>
      )}

      {/* Issue groups */}
      {!loading && grouped.map(({ check, severity, items }) => {
        const Icon = SEVERITY_ICONS[severity] || Info;
        const colors = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.low!;
        const isExpanded = expandedGroups.has(check);
        const label = CHECK_LABELS[check] || check.replace(/_/g, " ");
        const description = CHECK_DESCRIPTIONS[check] || "";
        const catalogEntry = catalogByCheck[check];
        const fixableCount = items.filter((i) => i.auto_fixable).length;
        const isFixing = fixing === check;
        const canRunGlobalFix = Boolean(
          catalogEntry?.auto_fixable &&
          catalogEntry.supports_global_scope &&
          fixableCount > 0,
        );
        const reviewOnly = Boolean(catalogEntry?.auto_fixable && !catalogEntry.supports_global_scope);
        const manualOnly = catalogEntry?.support === "manual";

        return (
          <Card
            key={check}
            className={`mb-3 overflow-hidden border ${colors.border} bg-panel-surface shadow-[0_20px_52px_rgba(0,0,0,0.18)]`}
          >
            {/* Group header */}
            <button
              className={cn(
                "w-full text-left transition-colors",
                "bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.05),transparent_46%)] hover:bg-white/[0.04]"
              )}
              onClick={() => toggleGroup(check)}
            >
              <div className="flex items-start gap-3 p-4">
                <div className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-md border shadow-[0_16px_36px_rgba(0,0,0,0.18)] ${colors.border} ${colors.bg}`}>
                  <Icon size={16} className={colors.text} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-white">{label}</span>
                    <CrateChip>{items.length}</CrateChip>
                    <CrateChip className={`${colors.border} ${colors.bg} ${colors.text}`}>{severity}</CrateChip>
                    {catalogEntry ? (
                      <>
                        <CrateChip className={RISK_TONES[catalogEntry.risk] || RISK_TONES.caution}>
                          {riskLabel(catalogEntry.risk)}
                        </CrateChip>
                        <CrateChip className={SCOPE_TONES[catalogEntry.scope] || SCOPE_TONES.hybrid}>
                          {scopeLabel(catalogEntry.scope)}
                        </CrateChip>
                      </>
                    ) : null}
                  </div>
                  {description && !isExpanded && (
                    <div className="mt-1 truncate text-xs text-white/45">{description}</div>
                  )}
                  {catalogEntry?.requires_confirmation ? (
                    <div className="mt-1 text-xs text-amber-200/80">
                      Review artist-by-artist before applying this fix.
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {canRunGlobalFix ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 rounded-md border-green-500/30 px-3 text-xs text-green-300 hover:bg-green-500/10"
                      onClick={() => handleFixType(check)}
                      disabled={isFixing}
                    >
                      {isFixing ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Wrench size={12} className="mr-1" />}
                      Fix all ({fixableCount})
                    </Button>
                  ) : reviewOnly || manualOnly ? (
                    <div className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 text-xs text-white/55">
                      <AlertTriangle size={12} />
                      {manualOnly ? "Manual only" : "Review per artist"}
                    </div>
                  ) : null}
                  <ActionIconButton
                    onClick={() => handleDismissType(check)}
                    title="Dismiss all issues of this type"
                  >
                    <EyeOff size={14} />
                  </ActionIconButton>
                  <ActionIconButton title={isExpanded ? "Collapse" : "Expand"}>
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </ActionIconButton>
                </div>
              </div>
            </button>

            {/* Expanded issue list */}
            {isExpanded && (
              <div className="border-t border-white/8">
                {description && (
                  <div className="px-4 pb-1 pt-3 text-xs text-white/45">{description}</div>
                )}
                {catalogEntry ? (
                  <div className="px-4 pb-2 text-xs text-white/50">
                    {catalogEntry.support === "manual"
                      ? "Automatic fix is not available for this repair type yet."
                      : catalogEntry.supports_global_scope
                        ? "Global fix can be queued directly from here."
                        : "This repair is available from the artist repair flow, not as a global batch."}
                  </div>
                ) : null}
                <div className="px-2 pb-2">
                  {items.map((issue) => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      catalogEntry={catalogEntry}
                      onResolve={() => handleResolve(issue.id)}
                      onDismiss={() => handleDismiss(issue.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}


function IssueRow({ issue, catalogEntry, onResolve, onDismiss }: {
  issue: HealthIssue;
  catalogEntry?: RepairCatalogEntry;
  onResolve: () => void;
  onDismiss: () => void;
}) {
  const details = issue.details_json || {};
  const path = details.path as string | undefined;

  return (
    <div className="group flex items-center gap-3 rounded-md border border-white/6 bg-white/[0.04] px-3 py-3 transition-colors hover:bg-white/[0.06]">
      {/* Severity dot */}
      <span className={`w-1.5 h-1.5 rounded-md flex-shrink-0 ${
        issue.severity === "critical" ? "bg-red-500" :
        issue.severity === "high" ? "bg-orange-500" :
        issue.severity === "medium" ? "bg-yellow-500" : "bg-muted-foreground/50"
      }`} />

      {/* Description */}
      <div className="flex-1 min-w-0">
        <div className="truncate text-xs text-white">{issue.description}</div>
        {path && (
          <div className="mt-0.5 truncate font-mono text-[10px] text-white/35">{path}</div>
        )}
        {catalogEntry ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <CrateChip className={RISK_TONES[catalogEntry.risk] || RISK_TONES.caution}>
              {riskLabel(catalogEntry.risk)}
            </CrateChip>
            <CrateChip className={SCOPE_TONES[catalogEntry.scope] || SCOPE_TONES.hybrid}>
              {scopeLabel(catalogEntry.scope)}
            </CrateChip>
            {catalogEntry.auto_fixable ? (
              <CrateChip>
                {catalogEntry.supports_global_scope ? "Global batch fix" : "Artist repair"}
              </CrateChip>
            ) : (
              <CrateChip>Manual review</CrateChip>
            )}
          </div>
        ) : null}
      </div>

      {/* Age */}
      <CrateChip className="hidden sm:inline-flex">{timeAgo(issue.created_at)}</CrateChip>
      <span className="sr-only">
        {timeAgo(issue.created_at)}
      </span>

      {/* Actions — always visible */}
      <div className="flex flex-shrink-0 gap-1">
        <ActionIconButton
          onClick={(e) => { e.stopPropagation(); onResolve(); }}
          className="hover:bg-green-500/10 hover:text-green-300"
          title="Mark as resolved"
        >
          <CheckCircle2 size={13} />
        </ActionIconButton>
        <ActionIconButton
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          className="hover:bg-white/10 hover:text-white"
          title="Dismiss (won't show again until next scan finds it)"
        >
          <EyeOff size={13} />
        </ActionIconButton>
      </div>
    </div>
  );
}
