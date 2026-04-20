import { useState, useEffect } from "react";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { CrateChip, CratePill } from "@/components/ui/CrateBadge";
import { timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Stethoscope, Loader2, CheckCircle2, AlertTriangle,
  XCircle, Info, Wrench, ChevronDown, ChevronUp,
  EyeOff,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ErrorState } from "@/components/ui/error-state";

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
  duplicate_albums: "Same album name appears multiple times for an artist",
  unindexed_files: "Audio files on disk not indexed in DB",
  tag_mismatch: "Album artist tag doesn't match folder artist name",
  folder_naming: "Folder structure doesn't match the configured naming pattern",
  missing_cover: "Albums without cover art (cover.jpg/cover.png)",
};

export function Health() {
  const { isAdmin } = useAuth();
  const [issues, setIssues] = useState<HealthIssue[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [fixing, setFixing] = useState<string | null>(null);

  async function fetchIssues() {
    try {
      const url = filter ? `/api/manage/health-issues?check_type=${filter}` : "/api/manage/health-issues";
      const data = await api<{ issues: HealthIssue[]; counts: Record<string, number> }>(url);
      setIssues(data.issues);
      setCounts(data.counts);
      setError(null);
    } catch {
      setError("Failed to load health issues");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchIssues(); }, [filter]);

  async function runScan() {
    setScanning(true);
    try {
      const { task_id } = await api<{ task_id: string }>("/api/manage/health-check", "POST");
      toast.success("Health scan started...");
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string }>(`/api/tasks/${task_id}`);
          if (task.status === "completed" || task.status === "failed") {
            clearInterval(poll);
            setScanning(false);
            if (task.status === "completed") {
              toast.success("Scan complete");
              fetchIssues();
            } else toast.error("Scan failed");
          }
        } catch { /* poll */ }
      }, 3000);
      setTimeout(() => { clearInterval(poll); setScanning(false); }, 300000);
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
      const res = await api<{ task_id: string | null; fixable: number }>(`/api/manage/health-issues/fix-type/${checkType}`, "POST");
      if (!res.task_id) {
        toast.error("No auto-fixable issues");
        setFixing(null);
        return;
      }
      toast.success(`Fixing ${res.fixable} issues...`);
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string }>(`/api/tasks/${res.task_id}`);
          if (task.status === "completed" || task.status === "failed") {
            clearInterval(poll);
            setFixing(null);
            if (task.status === "completed") {
              toast.success("Repair complete");
              fetchIssues();
            } else toast.error("Repair failed");
          }
        } catch { /* poll */ }
      }, 3000);
      setTimeout(() => { clearInterval(poll); setFixing(null); }, 300000);
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

  if (error) return <ErrorState message={error} onRetry={fetchIssues} />;

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
        const fixableCount = items.filter((i) => i.auto_fixable).length;
        const isFixing = fixing === check;

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
                  </div>
                  {description && !isExpanded && (
                    <div className="mt-1 truncate text-xs text-white/45">{description}</div>
                  )}
                </div>
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {fixableCount > 0 && (
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
                  )}
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
                <div className="px-2 pb-2">
                  {items.map((issue) => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
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


function IssueRow({ issue, onResolve, onDismiss }: {
  issue: HealthIssue;
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
      </div>

      {/* Age */}
      <CrateChip className="hidden sm:inline-flex">{timeAgo(issue.created_at)}</CrateChip>
      <span className="sr-only">
        {timeAgo(issue.created_at)}
      </span>

      {/* Actions — always visible */}
      <div className="flex flex-shrink-0 gap-1">
        {issue.auto_fixable && (
          <ActionIconButton
            onClick={(e) => { e.stopPropagation(); onResolve(); }}
            className="text-green-300 hover:bg-green-500/10 hover:text-green-300"
            title="Auto-fix this issue"
          >
            <Wrench size={13} />
          </ActionIconButton>
        )}
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
