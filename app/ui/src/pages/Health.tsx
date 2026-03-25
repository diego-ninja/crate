import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IssueList } from "@/components/scanner/IssueList";
import { ScanProgress, type ScanProgressData } from "@/components/scanner/ScanProgress";
import { useSse } from "@/hooks/use-sse";
import { useApi } from "@/hooks/use-api";
import { useTaskEvents } from "@/hooks/use-task-events";
import { api } from "@/lib/api";
import { cn, encPath } from "@/lib/utils";
import { toast } from "sonner";
import {
  Wrench, Stethoscope, Loader2, CheckCircle2, AlertTriangle,
  XCircle, Info, Image, Search,
  Download, Disc3, Zap, Copy,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

// ── Types ──

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

interface HealthIssue {
  check: string;
  severity: string;
  description: string;
  details: Record<string, unknown>;
  auto_fixable: boolean;
}

interface HealthReport {
  issues: HealthIssue[];
  summary: Record<string, number>;
  scanned_at: string;
  duration_ms: number;
}

interface DupIssue {
  type: string;
  description: string;
  suggestion: string;
  paths: string[];
  details: { keep?: string; remove?: string[] };
}

interface DupAlbum {
  path: string;
  name: string;
  artist: string;
  track_count: number;
  total_size_mb: number;
  formats: string[];
  has_cover: boolean;
  tracks: { tracknumber: string; title: string; bitrate: number | null }[];
}

interface CoverFoundEvent {
  artist: string;
  album: string;
  path: string;
  source: string;
  size: number;
  index: number;
}

// ── Helpers ──

function parseScanProgress(status: SseTask | null) {
  if (!status?.progress) return { rich: null, text: "", percent: 0 };
  if (typeof status.progress === "object") return { rich: status.progress, text: "", percent: 0 };
  try {
    const p = JSON.parse(status.progress as string);
    if (p.artists_done != null && p.artists_total) {
      return { rich: p as ScanProgressData, text: "", percent: Math.round((p.artists_done / p.artists_total) * 100) };
    }
    return { rich: null, text: status.progress as string, percent: 0 };
  } catch {
    return { rich: null, text: String(status.progress), percent: 0 };
  }
}

const SEVERITY_ICONS: Record<string, typeof AlertTriangle> = {
  critical: XCircle,
  high: AlertTriangle,
  medium: Info,
  low: Info,
};
const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-red-500",
  high: "text-orange-500",
  medium: "text-yellow-500",
  low: "text-muted-foreground",
};

const SOURCE_LABELS: Record<string, string> = {
  coverartarchive: "Cover Art Archive", embedded: "Embedded", deezer: "Deezer",
  itunes: "iTunes", lastfm: "Last.fm", tidal: "Tidal",
};
const SOURCE_COLORS: Record<string, string> = {
  coverartarchive: "text-green-500 border-green-500/30", embedded: "text-blue-500 border-blue-500/30",
  deezer: "text-purple-500 border-purple-500/30", itunes: "text-pink-500 border-pink-500/30",
  lastfm: "text-red-500 border-red-500/30", tidal: "text-cyan-500 border-cyan-500/30",
};

// ── Main Component ──

export function Health() {
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState("issues");

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Stethoscope size={24} className="text-primary" />
        <h1 className="text-2xl font-bold">Library Health</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="issues">Issues</TabsTrigger>
          <TabsTrigger value="artwork">Artwork</TabsTrigger>
          <TabsTrigger value="duplicates">Duplicates</TabsTrigger>
          <TabsTrigger value="scanner">Scanner</TabsTrigger>
        </TabsList>

        <TabsContent value="issues">
          <HealthCheckTab isAdmin={isAdmin} />
        </TabsContent>

        <TabsContent value="artwork">
          <ArtworkTab />
        </TabsContent>

        <TabsContent value="duplicates">
          <DuplicatesTab />
        </TabsContent>

        <TabsContent value="scanner">
          <ScannerTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}


// ── Health Check & Repair Tab ──

function HealthCheckTab({ isAdmin }: { isAdmin: boolean }) {
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [runningHealthCheck, setRunningHealthCheck] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<{ actions: { action: string; target: string; applied: boolean }[] } | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<Set<number>>(new Set());
  const [showRepairConfirm, setShowRepairConfirm] = useState(false);

  useEffect(() => {
    api<HealthReport>("/api/manage/health-report").then(setHealthReport).catch(() => {});
  }, []);

  async function runHealthCheck() {
    setRunningHealthCheck(true);
    try {
      const { task_id } = await api<{ task_id: string }>("/api/manage/health-check", "POST");
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string }>(`/api/tasks/${task_id}`);
          if (task.status === "completed" || task.status === "failed") {
            clearInterval(poll);
            setRunningHealthCheck(false);
            if (task.status === "completed") {
              const report = await api<HealthReport>("/api/manage/health-report");
              setHealthReport(report);
              toast.success(`Health check: ${report.issues.length} issues`);
            }
          }
        } catch { /* poll */ }
      }, 3000);
      setTimeout(() => { clearInterval(poll); setRunningHealthCheck(false); }, 120000);
    } catch { setRunningHealthCheck(false); toast.error("Failed"); }
  }

  async function repairSelected(issues: HealthIssue[]) {
    setRepairing(true);
    try {
      const { task_id } = await api<{ task_id: string }>("/api/manage/repair-issues", "POST", { issues, dry_run: false });
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string; result?: typeof repairResult }>(`/api/tasks/${task_id}`);
          if (task.status === "completed" || task.status === "failed") {
            clearInterval(poll);
            setRepairing(false);
            if (task.result) setRepairResult(task.result);
            toast.success("Repair complete");
            runHealthCheck();
          }
        } catch { /* poll */ }
      }, 3000);
      setTimeout(() => { clearInterval(poll); setRepairing(false); }, 120000);
    } catch { setRepairing(false); toast.error("Repair failed"); }
  }

  if (!isAdmin) return <div className="text-muted-foreground py-12 text-center">Admin access required</div>;

  const groupedIssues: { check: string; severity: string; issues: { issue: HealthIssue; idx: number }[] }[] = [];
  if (healthReport?.issues) {
    const groups: Record<string, { severity: string; issues: { issue: HealthIssue; idx: number }[] }> = {};
    healthReport.issues.forEach((issue, idx) => {
      if (!groups[issue.check]) groups[issue.check] = { severity: issue.severity, issues: [] };
      groups[issue.check]!.issues.push({ issue, idx });
    });
    const ord: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    for (const [check, data] of Object.entries(groups).sort(([, a], [, b]) => (ord[a.severity] ?? 4) - (ord[b.severity] ?? 4))) {
      groupedIssues.push({ check, severity: data.severity, issues: data.issues });
    }
  }

  const autoFixable = healthReport ? [...selectedIssues].filter((i) => healthReport.issues[i]?.auto_fixable) : [];

  return (
    <div>
      <div className="flex gap-2 mb-6">
        <Button onClick={runHealthCheck} disabled={runningHealthCheck || repairing} size="sm">
          {runningHealthCheck ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Stethoscope size={14} className="mr-1" />}
          Run Health Check
        </Button>
        {autoFixable.length > 0 && (
          <Button onClick={() => setShowRepairConfirm(true)} disabled={repairing} size="sm" variant="destructive">
            <Wrench size={14} className="mr-1" /> Fix {autoFixable.length} Issues
          </Button>
        )}
      </div>

      {healthReport && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {Object.entries(healthReport.summary).map(([check, count]) => (
              <Card key={check} className="p-3">
                <div className="text-xs text-muted-foreground capitalize">{check.replace(/_/g, " ")}</div>
                <div className="text-lg font-bold">{count}</div>
              </Card>
            ))}
          </div>

          {groupedIssues.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 size={48} className="text-green-500 mx-auto mb-3 opacity-50" />
              <div className="text-lg font-semibold text-green-500">Library is healthy</div>
            </div>
          ) : (
            <div className="space-y-3">
              {groupedIssues.map(({ check, severity, issues }) => {
                const Icon = SEVERITY_ICONS[severity] || Info;
                return (
                  <Card key={check}>
                    <CardHeader className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Icon size={14} className={SEVERITY_COLORS[severity]} />
                        <span className="text-sm font-medium capitalize">{check.replace(/_/g, " ")}</span>
                        <Badge variant="outline" className="text-[10px]">{issues.length}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <div className="space-y-1">
                        {issues.map(({ issue, idx }) => (
                          <label key={idx} className="flex items-start gap-2 text-xs py-1 cursor-pointer hover:bg-white/5 rounded px-1">
                            {issue.auto_fixable && (
                              <input
                                type="checkbox"
                                checked={selectedIssues.has(idx)}
                                onChange={() => setSelectedIssues((prev) => {
                                  const s = new Set(prev);
                                  s.has(idx) ? s.delete(idx) : s.add(idx);
                                  return s;
                                })}
                                className="mt-0.5"
                              />
                            )}
                            <span className="text-muted-foreground flex-1">{issue.description}</span>
                          </label>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {repairResult && (
        <Card className="mt-4 p-4 border-green-500/20 bg-green-500/5">
          <div className="text-sm font-medium mb-2">Repair Results</div>
          <div className="space-y-1">
            {repairResult.actions.map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <CheckCircle2 size={12} className="text-green-400" />
                <Badge variant="outline" className="text-[10px]">{a.action.replace(/_/g, " ")}</Badge>
                <span className="text-muted-foreground truncate">{a.target}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={showRepairConfirm}
        onOpenChange={setShowRepairConfirm}
        title="Apply Selected Fixes"
        description={`Apply ${autoFixable.length} repair action(s)? Some may modify the filesystem.`}
        confirmLabel={`Apply ${autoFixable.length} fixes`}
        variant="destructive"
        onConfirm={() => {
          if (!healthReport) return;
          repairSelected(autoFixable.map((i) => healthReport.issues[i]).filter((x): x is HealthIssue => !!x));
        }}
      />
    </div>
  );
}


// ── Artwork Tab ──

function ArtworkTab() {
  const navigate = useNavigate();
  const { data: missingData } = useApi<{ missing_count: number; albums: { name: string; display_name: string; artist: string; year: string; mbid: string | null; path: string }[] }>("/api/artwork/missing");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [applying, setApplying] = useState<Set<number>>(new Set());
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const { events, done, connected } = useTaskEvents(taskId);

  const isScanning = taskId !== null && !done;
  const coverEvents = events.filter((e) => e.type === "cover_found").map((e) => e.data as unknown as CoverFoundEvent);
  const infoEvents = events.filter((e) => e.type === "info");
  const lastInfo = infoEvents[infoEvents.length - 1];

  async function startScan(autoApply = false) {
    try {
      const { task_id } = await api<{ task_id: string }>("/api/artwork/scan", "POST", { auto_apply: autoApply });
      setTaskId(task_id);
      setApplied(new Set());
      setApplying(new Set());
      toast.success(autoApply ? "Scanning + auto-applying covers..." : "Scanning for missing covers...");
    } catch { toast.error("Failed to start scan"); }
  }

  async function applyCover(cover: CoverFoundEvent) {
    setApplying((prev) => new Set(prev).add(cover.index));
    try {
      await api("/api/artwork/apply", "POST", { path: cover.path, source: cover.source, artist: cover.artist, album: cover.album, mbid: "" });
      setApplied((prev) => new Set(prev).add(cover.index));
      toast.success(`Cover applied: ${cover.artist} — ${cover.album}`);
    } catch { toast.error("Failed to apply cover"); }
    finally { setApplying((prev) => { const s = new Set(prev); s.delete(cover.index); return s; }); }
  }

  async function applyAll() {
    for (const cover of coverEvents) {
      if (!applied.has(cover.index)) await applyCover(cover);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          {missingData && (
            <Badge variant="outline" className={missingData.missing_count > 0 ? "text-yellow-500 border-yellow-500/30" : "text-green-500 border-green-500/30"}>
              {missingData.missing_count} missing
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => startScan(false)} disabled={isScanning}>
            {isScanning ? <Loader2 size={14} className="animate-spin mr-1" /> : <Search size={14} className="mr-1" />}
            Scan & Find
          </Button>
          <Button size="sm" variant="outline" onClick={() => startScan(true)} disabled={isScanning}>
            <Zap size={14} className="mr-1" /> Auto-Apply All
          </Button>
        </div>
      </div>

      {isScanning && (
        <Card className="p-4 mb-6 border-blue-500/20 bg-blue-500/5">
          <div className="flex items-center gap-3">
            <Loader2 size={16} className="animate-spin text-blue-500" />
            <div>
              <div className="text-sm font-medium">{lastInfo?.data?.message as string ?? "Scanning..."}</div>
              {connected && <div className="text-xs text-muted-foreground">{coverEvents.length} covers found</div>}
            </div>
          </div>
        </Card>
      )}

      {done && (
        <Card className="p-4 mb-6 border-green-500/20 bg-green-500/5">
          <div className="flex items-center gap-3">
            <CheckCircle2 size={16} className="text-green-500" />
            <div className="flex-1">
              <div className="text-sm font-medium">Scan complete</div>
              <div className="text-xs text-muted-foreground">{coverEvents.length} found · {applied.size} applied</div>
            </div>
            {coverEvents.length > applied.size && (
              <Button size="sm" onClick={applyAll}><Download size={14} className="mr-1" /> Apply All ({coverEvents.length - applied.size})</Button>
            )}
          </div>
        </Card>
      )}

      {coverEvents.length > 0 && (
        <div className="space-y-2 mb-6">
          {coverEvents.map((cover) => (
            <div key={`${cover.artist}-${cover.album}-${cover.index}`}
              className={`flex items-center gap-4 px-4 py-3 rounded-lg border border-border ${applied.has(cover.index) ? "opacity-50" : ""}`}>
              <div className="w-12 h-12 rounded-lg bg-secondary flex-shrink-0 overflow-hidden">
                <img src={`/api/cover/${encPath(cover.artist)}/${encPath(cover.album)}`} alt="" className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
              <div className="flex-1 min-w-0">
                <button className="text-sm font-medium truncate hover:text-primary" onClick={() => navigate(`/album/${encPath(cover.artist)}/${encPath(cover.album)}`)}>
                  {cover.artist} — {cover.album}
                </button>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${SOURCE_COLORS[cover.source] || ""}`}>{SOURCE_LABELS[cover.source] || cover.source}</Badge>
                  <span className="text-xs text-muted-foreground">{Math.round(cover.size / 1024)}KB</span>
                </div>
              </div>
              {applied.has(cover.index) ? <CheckCircle2 size={18} className="text-green-500" /> : (
                <Button size="sm" variant="outline" disabled={applying.has(cover.index)} onClick={() => applyCover(cover)}>
                  {applying.has(cover.index) ? <Loader2 size={14} className="animate-spin" /> : <><Download size={14} className="mr-1" /> Apply</>}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {!taskId && !done && missingData?.albums && missingData.albums.length > 0 && (
        <div className="space-y-1">
          {missingData.albums.map((a, i) => (
            <div key={`${a.artist}-${a.name}-${i}`} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border hover:bg-muted/30">
              <div className="w-10 h-10 rounded bg-secondary flex items-center justify-center flex-shrink-0"><Disc3 size={16} className="text-muted-foreground" /></div>
              <div className="flex-1 min-w-0">
                <button className="text-sm font-medium truncate hover:text-primary block" onClick={() => navigate(`/album/${encPath(a.artist)}/${encPath(a.name)}`)}>
                  {a.artist} — {a.display_name}
                </button>
                <div className="text-xs text-muted-foreground flex gap-2">
                  {a.year && <span>{a.year}</span>}
                  <Badge variant="outline" className={`text-[9px] px-1 py-0 ${a.mbid ? "text-green-500 border-green-500/30" : "text-yellow-500 border-yellow-500/30"}`}>{a.mbid ? "MBID" : "No MBID"}</Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {done && coverEvents.length === 0 && (
        <div className="text-center py-12">
          <CheckCircle2 size={48} className="text-green-500 mx-auto mb-3 opacity-50" />
          <div className="text-sm text-green-500">All albums have cover art</div>
        </div>
      )}

      {!taskId && !done && (!missingData || missingData.missing_count === 0) && (
        <div className="text-center py-12 text-muted-foreground">
          <Image size={48} className="mx-auto mb-3 opacity-30" />
          <div className="text-sm">All albums have cover art</div>
        </div>
      )}
    </div>
  );
}


// ── Duplicates Tab ──

function DuplicatesTab() {
  const [issues, setIssues] = useState<DupIssue[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [comparisons, setComparisons] = useState<Record<number, { albums: DupAlbum[]; selected: number }>>({});
  const [resolved, setResolved] = useState<Set<number>>(new Set());
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const scan = useCallback(async () => {
    setScanning(true);
    await api("/api/scan", "POST", { only: "duplicates" });
    const poll = async () => {
      const s = await api<{ scanning: boolean }>("/api/status");
      if (s.scanning) { pollRef.current = setTimeout(poll, 2000); return; }
      const data = await api<DupIssue[]>("/api/issues?type=duplicate_album");
      setIssues(data);
      setScanning(false);
    };
    pollRef.current = setTimeout(poll, 2000);
  }, []);

  async function compare(idx: number) {
    const paths = issues![idx]!.paths.map((p) => p.replace("/music/", ""));
    const albums = await api<DupAlbum[]>(`/api/duplicates/compare?${paths.map((p) => `path=${encodeURIComponent(p)}`).join("&")}`);
    setComparisons((prev) => ({ ...prev, [idx]: { albums, selected: 0 } }));
  }

  async function resolve(idx: number) {
    const comp = comparisons[idx];
    if (!comp) return;
    const keep = comp.albums[comp.selected]!.path;
    const remove = comp.albums.filter((_, i) => i !== comp.selected).map((a) => a.path);
    try {
      const { task_id } = await api<{ task_id: string }>("/api/duplicates/resolve", "POST", { keep, remove });
      toast.success("Resolving...");
      const poll = setInterval(async () => {
        const task = await api<{ status: string }>(`/api/tasks/${task_id}`);
        if (task.status === "completed") { clearInterval(poll); setResolved((p) => new Set(p).add(idx)); setConfirmIdx(null); toast.success("Resolved"); }
        else if (task.status === "failed") { clearInterval(poll); setConfirmIdx(null); toast.error("Failed"); }
      }, 2000);
      setTimeout(() => clearInterval(poll), 60000);
    } catch { toast.error("Failed"); setConfirmIdx(null); }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Button size="sm" onClick={scan} disabled={scanning}>
          {scanning ? <Loader2 size={14} className="animate-spin mr-1" /> : <Copy size={14} className="mr-1" />}
          Scan for Duplicates
        </Button>
      </div>

      {issues !== null && issues.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">No duplicates found</div>
      )}

      {issues?.map((issue, idx) => (
        <div key={idx} className="bg-card border border-border rounded-lg p-4 mb-3">
          {resolved.has(idx) ? <div className="text-green-500 py-2">Resolved</div> : (
            <>
              <div className="text-sm mb-1">{issue.description}</div>
              <div className="text-sm text-green-500 mb-3">{issue.suggestion}</div>
              <Button size="sm" variant="outline" onClick={() => compare(idx)}>Compare</Button>
              {comparisons[idx] && (
                <>
                  <div className="flex gap-4 mt-4">
                    {comparisons[idx]!.albums.map((a, i) => (
                      <div key={a.path}
                        onClick={() => setComparisons((p) => ({ ...p, [idx]: { ...p[idx]!, selected: i } }))}
                        className={cn("flex-1 border rounded-lg p-4 cursor-pointer",
                          comparisons[idx]!.selected === i ? "border-green-500 shadow-[0_0_0_1px] shadow-green-500" : "border-border")}>
                        <div className="flex justify-between mb-2">
                          <strong className="text-sm">{a.name}</strong>
                          <div className="flex gap-1">
                            {a.formats.map((f) => <Badge key={f} variant="outline" className="text-[10px]">{f.replace(".", "").toUpperCase()}</Badge>)}
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground mb-2">{a.track_count} tracks · {a.total_size_mb} MB{a.has_cover ? " · Cover" : ""}</div>
                        <Table>
                          <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Title</TableHead><TableHead>Bitrate</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {a.tracks.map((t) => (
                              <TableRow key={t.title}><TableCell className="text-muted-foreground">{t.tracknumber || "?"}</TableCell><TableCell className="text-sm">{t.title}</TableCell><TableCell className="text-muted-foreground font-mono text-sm">{t.bitrate ? `${t.bitrate}k` : "-"}</TableCell></TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3"><Button size="sm" variant="destructive" onClick={() => setConfirmIdx(idx)}>Keep selected, trash others</Button></div>
                </>
              )}
            </>
          )}
        </div>
      ))}

      <ConfirmDialog
        open={confirmIdx !== null}
        onOpenChange={(open) => !open && setConfirmIdx(null)}
        title="Resolve Duplicate"
        description={confirmIdx !== null && comparisons[confirmIdx] ? `Keep "${comparisons[confirmIdx]!.albums[comparisons[confirmIdx]!.selected]!.name}" and trash ${comparisons[confirmIdx]!.albums.length - 1} other(s)?` : ""}
        confirmLabel="Trash others"
        variant="destructive"
        onConfirm={() => confirmIdx !== null && resolve(confirmIdx)}
      />
    </div>
  );
}


// ── Legacy Scanner Tab ──

function ScannerTab() {
  const { data: sseStatus } = useSse<SseTask>("/api/events");
  const [scanning, setScanning] = useState(false);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [fixPreview, setFixPreview] = useState<{ auto_fixable: number; needs_review: number; threshold: number } | null>(null);
  const [showFixConfirm, setShowFixConfirm] = useState(false);

  async function runScan(only?: string) {
    setScanning(true);
    setIssues(null);
    setFilter(null);
    try {
      await api("/api/scan", "POST", only ? { only } : {});
      const poll = setInterval(async () => {
        const s = await api<{ scanning: boolean }>("/api/status");
        if (!s.scanning) {
          clearInterval(poll);
          const data = await api<Issue[]>("/api/issues");
          setIssues(data);
          setScanning(false);
        }
      }, 2000);
      setTimeout(() => { clearInterval(poll); setScanning(false); }, 120000);
    } catch { setScanning(false); toast.error("Scan failed"); }
  }

  async function previewFix() {
    const preview = await api<{ auto_fixable: number; needs_review: number; threshold: number }>("/api/fix", "POST", { dry_run: true });
    setFixPreview(preview);
    setShowFixConfirm(true);
  }

  async function applyFix() {
    setFixing(true);
    try {
      const result = await api<{ fixed: number }>("/api/fix", "POST", { dry_run: false });
      toast.success(`Fixed ${result.fixed} issues`);
      const data = await api<Issue[]>("/api/issues");
      setIssues(data);
    } catch { toast.error("Fix failed"); }
    finally { setFixing(false); }
  }

  const { rich, text, percent } = parseScanProgress(sseStatus);
  const issueTypes = issues ? Object.entries(issues.reduce<Record<string, number>>((acc, i) => { acc[i.type] = (acc[i.type] || 0) + 1; return acc; }, {})) : [];
  const filtered = filter && issues ? issues.filter((i) => i.type === filter) : issues;

  return (
    <div>
      <div className="flex gap-2 flex-wrap mb-6">
        <Button size="sm" onClick={() => runScan()} disabled={scanning}>Scan All</Button>
        <Button size="sm" variant="outline" onClick={() => runScan("nested")} disabled={scanning}>Nested</Button>
        <Button size="sm" variant="outline" onClick={() => runScan("incomplete")} disabled={scanning}>Incomplete</Button>
        <Button size="sm" variant="outline" onClick={() => runScan("mergeable")} disabled={scanning}>Mergeable</Button>
        <Button size="sm" variant="outline" onClick={() => runScan("naming")} disabled={scanning}>Naming</Button>
        {issues && issues.length > 0 && !scanning && (
          <Button size="sm" variant="outline" className="ml-auto text-yellow-500 border-yellow-500/30" onClick={previewFix} disabled={fixing}>
            <Wrench size={14} className="mr-1" /> Fix Issues
          </Button>
        )}
      </div>

      {scanning && (rich ? <ScanProgress progress={rich} /> : (
        <div className="mb-6"><div className="text-sm text-muted-foreground mb-2">{text}</div><Progress value={percent} className="h-2" /></div>
      ))}

      {issues !== null && issueTypes.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-4">
          <Button size="sm" variant={filter === null ? "default" : "outline"} onClick={() => setFilter(null)}>All <Badge variant="secondary" className="ml-1.5">{issues.length}</Badge></Button>
          {issueTypes.map(([type, count]) => (
            <Button key={type} size="sm" variant={filter === type ? "default" : "outline"} onClick={() => setFilter(type)}>
              {type.replace(/_/g, " ")} <Badge variant="secondary" className="ml-1.5">{count}</Badge>
            </Button>
          ))}
        </div>
      )}

      {filtered !== null && <IssueList issues={filtered} />}

      <ConfirmDialog
        open={showFixConfirm}
        onOpenChange={setShowFixConfirm}
        title="Apply Fixes"
        description={fixPreview ? `${fixPreview.auto_fixable} auto-fixable, ${fixPreview.needs_review} need review.` : "Apply fixes?"}
        confirmLabel={`Fix ${fixPreview?.auto_fixable ?? 0} issues`}
        variant="destructive"
        onConfirm={applyFix}
      />
    </div>
  );
}
