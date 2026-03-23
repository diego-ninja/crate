import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IssueList } from "@/components/scanner/IssueList";
import { ScanProgress, type ScanProgressData } from "@/components/scanner/ScanProgress";
import { useSse } from "@/hooks/use-sse";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Wrench,
  Stethoscope,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  ChevronDown,
  ChevronUp,
  Check,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface Issue {
  type: string;
  severity: string;
  confidence: number;
  description: string;
  suggestion: string;
  paths: string[];
  details: Record<string, unknown>;
}

interface SseTask {
  id: string;
  type: string;
  status: string;
  progress: string | ScanProgressData;
}

interface SseStatus {
  scanning: boolean;
  progress: string;
  issue_count: number;
  percent?: number;
  tasks?: SseTask[];
}

function parseScanProgress(status: SseStatus | null): { rich: ScanProgressData | null; text: string; percent: number } {
  if (!status) return { rich: null, text: "Scanning...", percent: 0 };
  const scanTask = status.tasks?.find((t) => t.type === "scan" && t.status === "running");
  if (scanTask && typeof scanTask.progress === "object") {
    const p = scanTask.progress;
    const percent = p.artists_total > 0 ? Math.round((p.artists_done / p.artists_total) * 100) : 0;
    return { rich: p, text: "", percent };
  }
  return { rich: null, text: status.progress || "Scanning...", percent: status.percent ?? 0 };
}

interface FixPreview {
  dry_run: boolean;
  threshold: number;
  auto_fixable: number;
  needs_review: number;
}

interface HealthIssue {
  check: string;
  severity: string;
  auto_fixable: boolean;
  details: Record<string, unknown>;
}

interface HealthReport {
  issues: HealthIssue[];
  summary: Record<string, number>;
  scanned_at: string | null;
  duration_ms: number;
}

interface RepairAction {
  action: string;
  target: string;
  applied: boolean;
  fs_write?: boolean;
  details?: Record<string, unknown>;
}

interface RepairResult {
  actions: RepairAction[];
  fs_changed: boolean;
  db_changed: boolean;
}

// ── Human-readable descriptions ──

const SEVERITY_CONFIG: Record<string, { icon: typeof XCircle; color: string; label: string }> = {
  critical: { icon: XCircle, color: "text-red-400", label: "Critical" },
  high: { icon: AlertTriangle, color: "text-orange-400", label: "High" },
  medium: { icon: AlertTriangle, color: "text-yellow-400", label: "Medium" },
  low: { icon: Info, color: "text-blue-400", label: "Low" },
};

function describeIssue(issue: HealthIssue): { title: string; description: string; fix: string } {
  const d = issue.details;
  switch (issue.check) {
    case "duplicate_folders":
      return {
        title: "Duplicate artist folders",
        description: `Folders "${(d.folders as string[])?.join('", "')}" resolve to the same artist (normalized: "${d.normalized}")`,
        fix: `Merge all albums into "${(d.folders as string[])?.[0]}" and remove empty folders`,
      };
    case "canonical_mismatch":
      return {
        title: "Name mismatch",
        description: `Artist "${d.artist}" in DB but audio tags say "${d.tag_name}" (folder: ${d.folder})`,
        fix: `Update DB folder_name to match filesystem`,
      };
    case "fk_orphan_albums":
      return {
        title: "Orphan album",
        description: `Album "${d.album}" references artist "${d.artist}" which doesn't exist in DB`,
        fix: `Reassign to matching artist (case-insensitive) or delete from DB`,
      };
    case "fk_orphan_tracks":
      return {
        title: "Orphan track",
        description: `Track at "${d.track_path}" references album_id=${d.album_id} which doesn't exist`,
        fix: `Delete track record from DB`,
      };
    case "stale_artists":
      return {
        title: "Stale artist",
        description: `Artist "${d.artist}" exists in DB but folder not found on disk (${d.expected_path})`,
        fix: `Delete artist and all related records from DB`,
      };
    case "stale_albums":
      return {
        title: "Stale album",
        description: `Album "${d.album}" by ${d.artist} in DB but path "${d.path}" doesn't exist on disk`,
        fix: `Delete album and its tracks from DB`,
      };
    case "stale_tracks":
      return {
        title: "Stale track",
        description: `Track "${d.track_path}" in DB but file not found on disk`,
        fix: `Delete track record from DB`,
      };
    case "zombie_artists":
      return {
        title: "Empty artist",
        description: `Artist "${d.artist}" has 0 albums and 0 tracks in DB`,
        fix: `Delete artist record from DB`,
      };
    case "has_photo_desync":
      return {
        title: "Photo sync mismatch",
        description: `Artist "${d.artist}": DB says has_photo=${d.db_has_photo} but filesystem says ${d.fs_has_photo}`,
        fix: `Update DB has_photo to ${d.fs_has_photo}`,
      };
    case "duplicate_albums":
      return {
        title: "Duplicate albums",
        description: `Artist "${d.artist}" has ${d.count} albums named "${d.album}"`,
        fix: `Manual review required — cannot auto-fix`,
      };
    case "unindexed_files":
      return {
        title: "Unindexed files",
        description: `${d.count} audio file(s) in "${d.dir}" not indexed in DB`,
        fix: `Trigger sync for this directory`,
      };
    case "tag_mismatch":
      return {
        title: "Tag mismatch",
        description: `Track "${(d.track_path as string)?.split("/").pop()}": DB artist="${d.db_artist}" but tag says "${d.tag_artist}"`,
        fix: `Update DB artist to "${d.tag_artist}" (tag is source of truth)`,
      };
    case "folder_naming":
      return {
        title: "Folder structure",
        description: `${d.artist}/${d.current_folder} — ${d.reason}`,
        fix: `Move to ${d.artist}/${d.year}/${d.clean_name}/`,
      };
    default:
      return {
        title: issue.check.replace(/_/g, " "),
        description: JSON.stringify(d),
        fix: issue.auto_fixable ? "Auto-fixable" : "Manual review required",
      };
  }
}

function SeverityIcon({ severity }: { severity: string }) {
  const config = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.low!;
  const Icon = config!.icon;
  return <Icon size={14} className={config!.color} />;
}

export function Health() {
  const { isAdmin } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [fixPreview, setFixPreview] = useState<FixPreview | null>(null);
  const [showFixConfirm, setShowFixConfirm] = useState(false);
  const [fixing, setFixing] = useState(false);

  // Health check state
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [runningHealthCheck, setRunningHealthCheck] = useState(false);
  const [selectedIssues, setSelectedIssues] = useState<Set<number>>(new Set());
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showRepairConfirm, setShowRepairConfirm] = useState(false);

  const { data: sseStatus } = useSse<SseStatus>("/api/events", { enabled: scanning });

  const loadIssues = useCallback(async () => {
    const data = await api<Issue[]>("/api/issues");
    setIssues(data);
  }, []);

  useEffect(() => {
    api<SseStatus>("/api/status").then((s) => {
      if (s.scanning) setScanning(true);
      else if (s.issue_count > 0) loadIssues();
    });
  }, [loadIssues]);

  // Load existing report on mount
  useEffect(() => {
    api<HealthReport>("/api/manage/health-report").then((r) => {
      if (r.issues?.length > 0) setHealthReport(r);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (sseStatus && !sseStatus.scanning && scanning) {
      setScanning(false);
      loadIssues();
      toast.success("Scan complete", { description: `Found ${sseStatus.issue_count} issues` });
    }
  }, [sseStatus, scanning, loadIssues]);

  async function runScan(only?: string) {
    await api("/api/scan", "POST", only ? { only } : {});
    setScanning(true);
  }

  async function previewFix() {
    try {
      const preview = await api<FixPreview>("/api/fix", "POST", { dry_run: true });
      setFixPreview(preview);
      setShowFixConfirm(true);
    } catch { toast.error("Failed to preview fixes"); }
  }

  async function applyFix() {
    setShowFixConfirm(false);
    setFixing(true);
    try {
      const result = await api<FixPreview>("/api/fix", "POST", { dry_run: false });
      toast.success(`Fixed ${result.auto_fixable} issues`, { description: `${result.needs_review} issues need manual review` });
      loadIssues();
    } catch (e) {
      toast.error("Fix failed", { description: e instanceof Error ? e.message : "Unknown error" });
    } finally { setFixing(false); }
  }

  async function runHealthCheck() {
    setRunningHealthCheck(true);
    setHealthReport(null);
    setRepairResult(null);
    setSelectedIssues(new Set());
    try {
      const { task_id } = await api<{ task_id: string }>("/api/manage/health-check", "POST");
      toast.success("Health check started");
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string }>(`/api/tasks/${task_id}`);
          if (task.status === "completed") {
            clearInterval(poll);
            const report = await api<HealthReport>("/api/manage/health-report");
            setHealthReport(report);
            setRunningHealthCheck(false);
            // Auto-expand all groups
            const groups = new Set(report.issues.map((i) => i.check));
            setExpandedGroups(groups);
            toast.success("Health check complete", { description: `Found ${report.issues.length} issues` });
          } else if (task.status === "failed") {
            clearInterval(poll);
            setRunningHealthCheck(false);
            toast.error("Health check failed");
          }
        } catch { /* poll */ }
      }, 2000);
    } catch { setRunningHealthCheck(false); toast.error("Failed to start health check"); }
  }

  async function repairSelected(issuesToRepair: HealthIssue[]) {
    if (!issuesToRepair.length) return;
    setRepairing(true);
    setShowRepairConfirm(false);
    try {
      const { task_id } = await api<{ task_id: string }>("/api/manage/repair-issues", "POST", {
        issues: issuesToRepair,
        dry_run: false,
      });
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string; result?: RepairResult }>(`/api/tasks/${task_id}`);
          if (task.status === "completed") {
            clearInterval(poll);
            setRepairing(false);
            setRepairResult(task.result ?? null);
            const applied = task.result?.actions?.filter((a) => a.applied).length ?? 0;
            toast.success(`Applied ${applied} fixes`);
            setSelectedIssues(new Set());
            // Refresh report
            runHealthCheck();
          } else if (task.status === "failed") {
            clearInterval(poll);
            setRepairing(false);
            toast.error("Repair failed");
          }
        } catch { /* poll */ }
      }, 2000);
    } catch { setRepairing(false); toast.error("Failed to start repair"); }
  }

  function toggleIssue(idx: number) {
    setSelectedIssues((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function toggleGroup(check: string) {
    if (!healthReport) return;
    const groupIndices = healthReport.issues
      .map((issue, i) => (issue.check === check && issue.auto_fixable ? i : -1))
      .filter((i) => i >= 0);
    const allSelected = groupIndices.every((i) => selectedIssues.has(i));
    setSelectedIssues((prev) => {
      const next = new Set(prev);
      groupIndices.forEach((i) => allSelected ? next.delete(i) : next.add(i));
      return next;
    });
  }

  function toggleGroupExpand(check: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(check)) next.delete(check); else next.add(check);
      return next;
    });
  }

  // Group issues by check type
  const groupedIssues: { check: string; severity: string; issues: { issue: HealthIssue; idx: number }[] }[] = [];
  if (healthReport) {
    const groups: Record<string, { severity: string; issues: { issue: HealthIssue; idx: number }[] }> = {};
    healthReport.issues.forEach((issue, idx) => {
      if (!groups[issue.check]) groups[issue.check] = { severity: issue.severity, issues: [] };
      groups[issue.check]!.issues.push({ issue, idx });
    });
    // Sort by severity
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    for (const [check, data] of Object.entries(groups).sort(
      ([, a], [, b]) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4)
    )) {
      groupedIssues.push({ check, severity: data.severity, issues: data.issues });
    }
  }

  const autoFixableSelected = healthReport
    ? [...selectedIssues].filter((i) => healthReport.issues[i]?.auto_fixable)
    : [];

  const { rich: richProgress, text: progressText, percent } = parseScanProgress(sseStatus);

  const issueTypes = issues
    ? Object.entries(issues.reduce<Record<string, number>>((acc, i) => { acc[i.type] = (acc[i.type] || 0) + 1; return acc; }, {}))
    : [];

  const filteredIssues = filter && issues ? issues.filter((i) => i.type === filter) : issues;

  return (
    <div>
      <h2 className="font-semibold mb-4">Library Health</h2>

      {/* Health Check & Repair */}
      {isAdmin && (
        <Card className="bg-card mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Stethoscope size={14} />
                Health Check & Repair
              </CardTitle>
              <div className="flex gap-2">
                <Button onClick={runHealthCheck} disabled={runningHealthCheck || repairing} size="sm">
                  {runningHealthCheck ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Stethoscope size={14} className="mr-1" />}
                  {runningHealthCheck ? "Checking..." : "Run Health Check"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Summary cards */}
            {healthReport && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {Object.keys(healthReport.summary).length === 0 ? (
                  <div className="col-span-4 flex items-center gap-2 py-4 justify-center text-sm text-green-400">
                    <CheckCircle2 size={16} /> Library is healthy — no issues found
                  </div>
                ) : (
                  Object.entries(healthReport.summary).map(([check, count]) => (
                    <button
                      key={check}
                      className="bg-secondary/50 rounded-lg p-3 text-left hover:bg-secondary/70 transition-colors"
                      onClick={() => toggleGroupExpand(check)}
                    >
                      <div className="text-lg font-bold text-foreground">{count}</div>
                      <div className="text-xs text-muted-foreground">{check.replace(/_/g, " ")}</div>
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Actions bar */}
            {healthReport && healthReport.issues.length > 0 && (
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const allFixable = healthReport.issues
                      .map((issue, i) => (issue.auto_fixable ? i : -1))
                      .filter((i) => i >= 0);
                    const allSelected = allFixable.every((i) => selectedIssues.has(i));
                    if (allSelected) setSelectedIssues(new Set());
                    else setSelectedIssues(new Set(allFixable));
                  }}
                >
                  <Check size={14} className="mr-1" />
                  {selectedIssues.size > 0 ? "Deselect All" : "Select All Fixable"}
                </Button>
                {autoFixableSelected.length > 0 && (
                  <Button
                    size="sm"
                    className="bg-yellow-600 hover:bg-yellow-500 text-white"
                    onClick={() => setShowRepairConfirm(true)}
                    disabled={repairing}
                  >
                    {repairing ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Wrench size={14} className="mr-1" />}
                    Fix {autoFixableSelected.length} Selected
                  </Button>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  {healthReport.issues.length} issues total,{" "}
                  {healthReport.issues.filter((i) => i.auto_fixable).length} auto-fixable
                  {healthReport.scanned_at && (
                    <> &middot; scanned {new Date(healthReport.scanned_at).toLocaleTimeString()}</>
                  )}
                </span>
              </div>
            )}

            {/* Issues grouped by check type */}
            {groupedIssues.map((group) => {
              const expanded = expandedGroups.has(group.check);
              const fixableInGroup = group.issues.filter((i) => i.issue.auto_fixable);
              const allGroupSelected = fixableInGroup.length > 0 && fixableInGroup.every((i) => selectedIssues.has(i.idx));
              const sampleDesc = describeIssue(group.issues[0]!.issue);

              return (
                <div key={group.check} className="border border-border rounded-lg mb-2 overflow-hidden">
                  {/* Group header */}
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 bg-secondary/30 hover:bg-secondary/50 transition-colors text-left"
                    onClick={() => toggleGroupExpand(group.check)}
                  >
                    <SeverityIcon severity={group.severity} />
                    <span className="text-sm font-medium flex-1">{sampleDesc.title}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {group.issues.length}
                    </Badge>
                    <Badge
                      className={`text-[10px] ${
                        SEVERITY_CONFIG[group.severity]
                          ? `bg-${group.severity === "critical" ? "red" : group.severity === "high" ? "orange" : group.severity === "medium" ? "yellow" : "blue"}-500/10 ${SEVERITY_CONFIG[group.severity]!.color} border-0`
                          : ""
                      }`}
                    >
                      {SEVERITY_CONFIG[group.severity]?.label ?? group.severity}
                    </Badge>
                    {fixableInGroup.length > 0 && (
                      <button
                        className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                          allGroupSelected
                            ? "bg-cyan-600 text-white border-cyan-600"
                            : "border-border text-muted-foreground hover:border-cyan-500/50"
                        }`}
                        onClick={(e) => { e.stopPropagation(); toggleGroup(group.check); }}
                      >
                        {allGroupSelected ? "Deselect" : "Select"} all
                      </button>
                    )}
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  {/* Expanded issue list */}
                  {expanded && (
                    <div className="divide-y divide-border">
                      {group.issues.map(({ issue, idx }) => {
                        const desc = describeIssue(issue);
                        const isSelected = selectedIssues.has(idx);
                        return (
                          <div
                            key={idx}
                            className={`px-3 py-2 text-xs transition-colors ${
                              isSelected ? "bg-cyan-500/5" : "hover:bg-secondary/20"
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              {issue.auto_fixable && (
                                <button
                                  className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                                    isSelected
                                      ? "bg-cyan-600 border-cyan-600 text-white"
                                      : "border-border hover:border-cyan-500/50"
                                  }`}
                                  onClick={() => toggleIssue(idx)}
                                >
                                  {isSelected && <Check size={10} />}
                                </button>
                              )}
                              {!issue.auto_fixable && (
                                <div className="mt-0.5 w-4 h-4 flex-shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="text-foreground">{desc.description}</div>
                                <div className="text-muted-foreground mt-0.5 flex items-center gap-1">
                                  <Wrench size={10} className="flex-shrink-0" />
                                  <span>{desc.fix}</span>
                                </div>
                              </div>
                              {issue.auto_fixable && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground flex-shrink-0"
                                  disabled={repairing}
                                  onClick={() => repairSelected([issue])}
                                >
                                  Fix
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Repair result */}
            {repairResult && (
              <div className="mt-4 border border-green-500/20 rounded-lg overflow-hidden">
                <div className="text-xs font-semibold px-3 py-2 bg-green-500/10 text-green-400 flex items-center gap-1">
                  <CheckCircle2 size={12} />
                  Last repair: {repairResult.actions.filter((a) => a.applied).length} actions applied
                  {repairResult.fs_changed && " (filesystem modified)"}
                  {repairResult.db_changed && " (database modified)"}
                </div>
                <div className="max-h-[150px] overflow-y-auto">
                  {repairResult.actions.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs border-t border-border">
                      {a.applied ? (
                        <CheckCircle2 size={12} className="text-green-400 flex-shrink-0" />
                      ) : (
                        <Info size={12} className="text-muted-foreground flex-shrink-0" />
                      )}
                      <Badge variant="outline" className="text-[10px]">{a.action.replace(/_/g, " ")}</Badge>
                      <span className="text-muted-foreground truncate">{a.target}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Confirm repair dialog */}
      <ConfirmDialog
        open={showRepairConfirm}
        onOpenChange={setShowRepairConfirm}
        title="Apply Selected Fixes"
        description={`This will apply ${autoFixableSelected.length} repair action(s). Some may modify the filesystem. Are you sure?`}
        confirmLabel={`Apply ${autoFixableSelected.length} fixes`}
        variant="destructive"
        onConfirm={() => {
          if (!healthReport) return;
          const issuesToFix = autoFixableSelected.map((i) => healthReport.issues[i]).filter(Boolean) as HealthIssue[];
          repairSelected(issuesToFix);
        }}
      />

      {/* Original Scan Section */}
      <div className="flex gap-2 flex-wrap mb-6">
        <Button onClick={() => runScan()} disabled={scanning}>Scan All</Button>
        <Button variant="outline" onClick={() => runScan("nested")} disabled={scanning}>Nested</Button>
        <Button variant="outline" onClick={() => runScan("duplicates")} disabled={scanning}>Duplicates</Button>
        <Button variant="outline" onClick={() => runScan("incomplete")} disabled={scanning}>Incomplete</Button>
        <Button variant="outline" onClick={() => runScan("mergeable")} disabled={scanning}>Mergeable</Button>
        <Button variant="outline" onClick={() => runScan("naming")} disabled={scanning}>Naming</Button>
        {issues && issues.length > 0 && !scanning && (
          <Button
            variant="outline"
            className="ml-auto text-yellow-500 border-yellow-500/30 hover:bg-yellow-500/10"
            onClick={previewFix}
            disabled={fixing}
          >
            <Wrench size={14} className="mr-1" /> Fix Issues
          </Button>
        )}
      </div>

      {scanning && (
        <div className="mb-6">
          {richProgress ? (
            <ScanProgress progress={richProgress} />
          ) : (
            <>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-sm text-muted-foreground">{progressText}</span>
              </div>
              <Progress value={percent} className="h-2" />
            </>
          )}
        </div>
      )}

      {issues !== null && issueTypes.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-4">
          <Button size="sm" variant={filter === null ? "default" : "outline"} onClick={() => setFilter(null)}>
            All <Badge variant="secondary" className="ml-1.5">{issues.length}</Badge>
          </Button>
          {issueTypes.map(([type, count]) => (
            <Button key={type} size="sm" variant={filter === type ? "default" : "outline"} onClick={() => setFilter(type)}>
              {type.replace(/_/g, " ")} <Badge variant="secondary" className="ml-1.5">{count}</Badge>
            </Button>
          ))}
        </div>
      )}

      {filteredIssues !== null && <IssueList issues={filteredIssues} />}

      <ConfirmDialog
        open={showFixConfirm}
        onOpenChange={setShowFixConfirm}
        title="Apply Fixes"
        description={
          fixPreview
            ? `${fixPreview.auto_fixable} issues can be auto-fixed (confidence >= ${fixPreview.threshold}%). ${fixPreview.needs_review} issues need manual review and will be skipped.`
            : "Apply auto-fixable issues?"
        }
        confirmLabel={`Fix ${fixPreview?.auto_fixable ?? 0} issues`}
        variant="destructive"
        onConfirm={applyFix}
      />
    </div>
  );
}
