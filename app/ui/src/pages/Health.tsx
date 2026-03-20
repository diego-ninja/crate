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
import { Wrench, Stethoscope, ShieldCheck, Loader2 } from "lucide-react";
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

  // Check for structured task progress
  const scanTask = status.tasks?.find((t) => t.type === "scan" && t.status === "running");
  if (scanTask && typeof scanTask.progress === "object") {
    const p = scanTask.progress;
    const percent = p.artists_total > 0
      ? Math.round((p.artists_done / p.artists_total) * 100)
      : 0;
    return { rich: p, text: "", percent };
  }

  // Fallback to plain string
  return {
    rich: null,
    text: status.progress || "Scanning...",
    percent: status.percent ?? 0,
  };
}

interface FixPreview {
  dry_run: boolean;
  threshold: number;
  auto_fixable: number;
  needs_review: number;
}

interface HealthReport {
  issues: { check: string; severity: string; auto_fixable: boolean; details: Record<string, unknown> }[];
  summary: Record<string, number>;
  scanned_at: string | null;
  duration_ms: number;
}

interface RepairResult {
  actions: { action: string; target: string; applied: boolean; details?: Record<string, unknown> }[];
  fs_changed: boolean;
  db_changed: boolean;
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
  const [repairPreview, setRepairPreview] = useState<RepairResult | null>(null);
  const [showRepairConfirm, setShowRepairConfirm] = useState(false);
  const [repairing, setRepairing] = useState(false);

  const { data: sseStatus } = useSse<SseStatus>("/api/events", {
    enabled: scanning,
  });

  const loadIssues = useCallback(async () => {
    const data = await api<Issue[]>("/api/issues");
    setIssues(data);
  }, []);

  useEffect(() => {
    api<SseStatus>("/api/status").then((s) => {
      if (s.scanning) {
        setScanning(true);
      } else if (s.issue_count > 0) {
        loadIssues();
      }
    });
  }, [loadIssues]);

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
    } catch {
      toast.error("Failed to preview fixes");
    }
  }

  async function applyFix() {
    setShowFixConfirm(false);
    setFixing(true);
    try {
      const result = await api<FixPreview>("/api/fix", "POST", { dry_run: false });
      toast.success(`Fixed ${result.auto_fixable} issues`, {
        description: `${result.needs_review} issues need manual review`,
      });
      loadIssues();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error("Fix failed", { description: msg });
    } finally {
      setFixing(false);
    }
  }

  const { rich: richProgress, text: progressText, percent } = parseScanProgress(sseStatus);

  const issueTypes = issues
    ? Object.entries(
        issues.reduce<Record<string, number>>((acc, i) => {
          acc[i.type] = (acc[i.type] || 0) + 1;
          return acc;
        }, {}),
      )
    : [];

  const filteredIssues = filter && issues
    ? issues.filter((i) => i.type === filter)
    : issues;

  async function runHealthCheck() {
    setRunningHealthCheck(true);
    try {
      const { task_id } = await api<{ task_id: string }>("/api/manage/health-check", "POST");
      toast.success("Health check started");
      // Poll for completion
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string }>(`/api/tasks/${task_id}`);
          if (task.status === "completed") {
            clearInterval(poll);
            const report = await api<HealthReport>("/api/manage/health-report");
            setHealthReport(report);
            setRunningHealthCheck(false);
            toast.success("Health check complete", { description: `Found ${report.issues.length} issues` });
          } else if (task.status === "failed") {
            clearInterval(poll);
            setRunningHealthCheck(false);
            toast.error("Health check failed");
          }
        } catch { /* continue polling */ }
      }, 2000);
    } catch {
      setRunningHealthCheck(false);
      toast.error("Failed to start health check");
    }
  }

  async function previewRepair() {
    try {
      const { task_id } = await api<{ task_id: string }>("/api/manage/repair", "POST", { dry_run: true, auto_only: true });
      toast.success("Repair preview started");
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string; result?: RepairResult }>(`/api/tasks/${task_id}`);
          if (task.status === "completed" && task.result) {
            clearInterval(poll);
            setRepairPreview(task.result);
            setShowRepairConfirm(true);
          } else if (task.status === "failed") {
            clearInterval(poll);
            toast.error("Repair preview failed");
          }
        } catch { /* continue polling */ }
      }, 2000);
    } catch {
      toast.error("Failed to preview repair");
    }
  }

  async function applyRepair() {
    setShowRepairConfirm(false);
    setRepairing(true);
    try {
      const { task_id } = await api<{ task_id: string }>("/api/manage/repair", "POST", { dry_run: false, auto_only: true });
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string; result?: RepairResult }>(`/api/tasks/${task_id}`);
          if (task.status === "completed") {
            clearInterval(poll);
            setRepairing(false);
            toast.success("Repair complete", { description: `${task.result?.actions?.length ?? 0} actions applied` });
            runHealthCheck();
          } else if (task.status === "failed") {
            clearInterval(poll);
            setRepairing(false);
            toast.error("Repair failed");
          }
        } catch { /* continue polling */ }
      }, 2000);
    } catch {
      setRepairing(false);
      toast.error("Failed to apply repair");
    }
  }

  return (
    <div>
      <h2 className="font-semibold mb-4">Library Health</h2>

      {/* Health Check & Repair Section */}
      {isAdmin && (
        <Card className="bg-card mb-6">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Stethoscope size={14} />
              Library Health Check & Repair
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap mb-4">
              <Button
                onClick={runHealthCheck}
                disabled={runningHealthCheck}
                size="sm"
              >
                {runningHealthCheck ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Stethoscope size={14} className="mr-1" />}
                Run Health Check
              </Button>
              {healthReport && healthReport.issues.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={previewRepair}
                    disabled={repairing}
                  >
                    <ShieldCheck size={14} className="mr-1" /> Preview Repair
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-yellow-500 border-yellow-500/30 hover:bg-yellow-500/10"
                    onClick={() => setShowRepairConfirm(true)}
                    disabled={repairing}
                  >
                    {repairing ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Wrench size={14} className="mr-1" />}
                    Apply Repair
                  </Button>
                </>
              )}
            </div>
            {healthReport && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Object.entries(healthReport.summary).map(([check, count]) => (
                  <div key={check} className="bg-secondary/50 rounded-lg p-3">
                    <div className="text-lg font-bold text-foreground">{count}</div>
                    <div className="text-xs text-muted-foreground">{check.replace(/_/g, " ")}</div>
                  </div>
                ))}
                {Object.keys(healthReport.summary).length === 0 && (
                  <div className="col-span-4 text-sm text-muted-foreground text-center py-4">
                    No issues found
                  </div>
                )}
              </div>
            )}
            {repairPreview && (
              <div className="mt-4 border border-border rounded-lg overflow-hidden">
                <div className="text-xs font-semibold px-3 py-2 bg-secondary/50">
                  Repair Preview ({repairPreview.actions.length} actions)
                </div>
                <div className="max-h-[200px] overflow-y-auto">
                  {repairPreview.actions.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs border-t border-border">
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

      <ConfirmDialog
        open={showRepairConfirm && repairPreview != null}
        onOpenChange={setShowRepairConfirm}
        title="Apply Library Repair"
        description={`This will execute ${repairPreview?.actions?.length ?? 0} repair actions. ${repairPreview?.fs_changed ? "Some actions modify the filesystem." : "Only database changes."}`}
        confirmLabel={`Apply ${repairPreview?.actions?.length ?? 0} repairs`}
        variant="destructive"
        onConfirm={applyRepair}
      />

      {/* Original Scan Section */}
      <div className="flex gap-2 flex-wrap mb-6">
        <Button onClick={() => runScan()} disabled={scanning}>
          Scan All
        </Button>
        <Button variant="outline" onClick={() => runScan("nested")} disabled={scanning}>
          Nested
        </Button>
        <Button variant="outline" onClick={() => runScan("duplicates")} disabled={scanning}>
          Duplicates
        </Button>
        <Button variant="outline" onClick={() => runScan("incomplete")} disabled={scanning}>
          Incomplete
        </Button>
        <Button variant="outline" onClick={() => runScan("mergeable")} disabled={scanning}>
          Mergeable
        </Button>
        <Button variant="outline" onClick={() => runScan("naming")} disabled={scanning}>
          Naming
        </Button>
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
          <Button
            size="sm"
            variant={filter === null ? "default" : "outline"}
            onClick={() => setFilter(null)}
          >
            All
            <Badge variant="secondary" className="ml-1.5">
              {issues.length}
            </Badge>
          </Button>
          {issueTypes.map(([type, count]) => (
            <Button
              key={type}
              size="sm"
              variant={filter === type ? "default" : "outline"}
              onClick={() => setFilter(type)}
            >
              {type.replace(/_/g, " ")}
              <Badge variant="secondary" className="ml-1.5">
                {count}
              </Badge>
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
            ? `${fixPreview.auto_fixable} issues can be auto-fixed (confidence >= ${fixPreview.threshold}%). ${fixPreview.needs_review} issues need manual review and will be skipped. This will move duplicate/nested folders to trash and rename badly named folders.`
            : "Apply auto-fixable issues?"
        }
        confirmLabel={`Fix ${fixPreview?.auto_fixable ?? 0} issues`}
        variant="destructive"
        onConfirm={applyFix}
      />
    </div>
  );
}
