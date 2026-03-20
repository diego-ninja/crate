import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IssueList } from "@/components/scanner/IssueList";
import { ScanProgress, type ScanProgressData } from "@/components/scanner/ScanProgress";
import { useSse } from "@/hooks/use-sse";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Wrench } from "lucide-react";

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

export function Health() {
  const [scanning, setScanning] = useState(false);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [fixPreview, setFixPreview] = useState<FixPreview | null>(null);
  const [showFixConfirm, setShowFixConfirm] = useState(false);
  const [fixing, setFixing] = useState(false);

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

  return (
    <div>
      <h2 className="font-semibold mb-4">Library Health</h2>
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
