import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Stethoscope, Loader2, CheckCircle2, AlertTriangle,
  XCircle, Info, Wrench, ChevronDown, ChevronUp,
  X,
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
const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-red-500 border-red-500/30 bg-red-500/5",
  high: "text-orange-500 border-orange-500/30 bg-orange-500/5",
  medium: "text-yellow-500 border-yellow-500/30 bg-yellow-500/5",
  low: "text-muted-foreground border-border bg-card",
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

export function Health() {
  const { isAdmin } = useAuth();
  const [issues, setIssues] = useState<HealthIssue[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  async function fetchIssues() {
    try {
      const url = filter ? `/api/manage/health-issues?check_type=${filter}` : "/api/manage/health-issues";
      const data = await api<{ issues: HealthIssue[]; counts: Record<string, number> }>(url);
      setIssues(data.issues);
      setCounts(data.counts);
      setError(null);
    } catch (e) {
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
            } else {
              toast.error("Scan failed");
            }
          }
        } catch { /* poll */ }
      }, 3000);
      setTimeout(() => { clearInterval(poll); setScanning(false); }, 300000);
    } catch { setScanning(false); toast.error("Failed to start scan"); }
  }

  async function handleResolve(id: number) {
    await api(`/api/manage/health-issues/${id}/resolve`, "POST");
    setIssues((prev) => prev.filter((i) => i.id !== id));
    setCounts((prev) => {
      const issue = issues.find((i) => i.id === id);
      if (!issue) return prev;
      const n = { ...prev };
      const val = (n[issue.check_type] || 1) - 1;
      if (val <= 0) delete n[issue.check_type];
      else n[issue.check_type] = val;
      return n;
    });
  }

  async function handleDismiss(id: number) {
    await api(`/api/manage/health-issues/${id}/dismiss`, "POST");
    setIssues((prev) => prev.filter((i) => i.id !== id));
  }

  function toggleGroup(check: string) {
    setExpandedGroups((prev) => {
      const s = new Set(prev);
      s.has(check) ? s.delete(check) : s.add(check);
      return s;
    });
  }

  const totalOpen = Object.values(counts).reduce((a, b) => a + b, 0);

  // Group issues by check_type
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
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Stethoscope size={24} className="text-primary" />
          <h1 className="text-2xl font-bold">Library Health</h1>
          {totalOpen > 0 && (
            <Badge variant="outline" className="text-yellow-500 border-yellow-500/30">
              {totalOpen} open
            </Badge>
          )}
          {totalOpen === 0 && !loading && (
            <Badge variant="outline" className="text-green-500 border-green-500/30">
              Healthy
            </Badge>
          )}
        </div>
        {isAdmin && (
          <Button onClick={runScan} disabled={scanning} size="sm">
            {scanning ? <Loader2 size={14} className="animate-spin mr-1" /> : <Stethoscope size={14} className="mr-1" />}
            {scanning ? "Scanning..." : "Run Scan"}
          </Button>
        )}
      </div>

      {/* Filter pills */}
      {Object.keys(counts).length > 0 && (
        <div className="flex gap-2 flex-wrap mb-6">
          <Button size="sm" variant={filter === null ? "default" : "outline"} onClick={() => setFilter(null)}>
            All <Badge variant="secondary" className="ml-1.5">{totalOpen}</Badge>
          </Button>
          {Object.entries(counts)
            .sort(([, a], [, b]) => b - a)
            .map(([check, count]) => (
              <Button key={check} size="sm" variant={filter === check ? "default" : "outline"} onClick={() => setFilter(check)}>
                {CHECK_LABELS[check] || check.replace(/_/g, " ")} <Badge variant="secondary" className="ml-1.5">{count}</Badge>
              </Button>
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
        <div className="text-center py-24">
          <CheckCircle2 size={48} className="text-green-500 mx-auto mb-3 opacity-50" />
          <div className="text-lg font-semibold text-green-500">Library is healthy</div>
          <div className="text-sm text-muted-foreground mt-1">
            {totalOpen === 0 && Object.keys(counts).length === 0
              ? "Run a scan to check for issues"
              : "No issues found for this filter"}
          </div>
        </div>
      )}

      {/* Issue groups */}
      {!loading && grouped.map(({ check, severity, items }) => {
        const Icon = SEVERITY_ICONS[severity] || Info;
        const colorStr = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.low ?? "";
        const borderClass = colorStr.split(" ").find(c => c.startsWith("border-")) || "border-border";
        const textClass = colorStr.split(" ")[0] || "text-muted-foreground";
        const isExpanded = expandedGroups.has(check);
        const label = CHECK_LABELS[check] || check.replace(/_/g, " ");

        return (
          <Card key={check} className={`mb-3 border ${borderClass}`}>
            <button
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/5 transition-colors"
              onClick={() => toggleGroup(check)}
            >
              <Icon size={16} className={textClass} />
              <span className="font-medium flex-1">{label}</span>
              <Badge variant="outline" className="text-xs">{items.length}</Badge>
              {items.some(i => i.auto_fixable) && (
                <Badge variant="secondary" className="text-[10px]"><Wrench size={10} className="mr-0.5" /> fixable</Badge>
              )}
              {isExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
            </button>

            {isExpanded && (
              <div className="px-4 pb-3 space-y-1 border-t border-border/50 pt-2">
                {items.map((issue) => (
                  <div key={issue.id} className="flex items-center gap-2 text-xs py-1.5 group">
                    <span className="flex-1 text-muted-foreground">{issue.description}</span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {issue.auto_fixable && (
                        <button
                          onClick={() => handleResolve(issue.id)}
                          className="text-green-500 hover:text-green-400 p-1"
                          title="Mark as fixed"
                        >
                          <CheckCircle2 size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDismiss(issue.id)}
                        className="text-muted-foreground hover:text-foreground p-1"
                        title="Dismiss"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
