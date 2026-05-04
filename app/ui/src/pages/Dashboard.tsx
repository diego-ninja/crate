import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ResponsiveBar } from "@nivo/bar";
import { ResponsivePie } from "@nivo/pie";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  Database,
  Eye,
  HardDrive,
  HeartPulse,
  Loader2,
  Music,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Stethoscope,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { OpsPageHero, OpsPanel, OpsStatTile } from "@/components/admin/ops-surfaces";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { GridSkeleton } from "@/components/ui/grid-skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useOpsSnapshot } from "@/contexts/OpsSnapshotContext";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { CrateChip, CratePill } from "@crate/ui/primitives/CrateBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@crate/ui/shadcn/card";
import { Button } from "@crate/ui/shadcn/button";
import { albumCoverApiUrl, albumPagePath } from "@/lib/library-routes";
import { api } from "@/lib/api";
import { cn, formatNumber, timeAgo } from "@/lib/utils";

type AttentionTone = "danger" | "warning" | "info";

interface AttentionItem {
  key: string;
  title: string;
  detail: string;
  tone: AttentionTone;
  actionLabel: string;
  href: string;
}

function queueTotal(
  queue: { fast: number; default: number; heavy: number; playback: number } | null | undefined,
): number {
  if (!queue) return 0;
  return (queue.fast || 0) + (queue.default || 0) + (queue.heavy || 0) + (queue.playback || 0);
}

function prettifyTaskType(taskType: string | null | undefined): string {
  return String(taskType || "unknown").replace(/_/g, " ");
}

function prettifyHealthType(checkType: string | null | undefined): string {
  return String(checkType || "unknown").replace(/_/g, " ");
}

function attentionToneClasses(tone: AttentionTone): string {
  switch (tone) {
    case "danger":
      return "border-red-500/20 bg-red-500/10";
    case "warning":
      return "border-amber-500/20 bg-amber-500/10";
    default:
      return "border-cyan-500/20 bg-cyan-500/10";
  }
}

function attentionChipClasses(tone: AttentionTone): string {
  switch (tone) {
    case "danger":
      return "border-red-500/25 bg-red-500/10 text-red-200";
    case "warning":
      return "border-amber-500/25 bg-amber-500/10 text-amber-200";
    default:
      return "border-cyan-500/25 bg-cyan-500/10 text-cyan-200";
  }
}

function emptyStateTitle(totalHealthIssues: number, queuedTasks: number, pendingImports: number): string {
  if (totalHealthIssues === 0 && queuedTasks === 0 && pendingImports === 0) {
    return "All clear";
  }
  return "Nothing urgent right now";
}

export function Dashboard() {
  const { data: opsSnapshot, loading: loadingSnapshot, error: snapshotError, refresh } = useOpsSnapshot();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);

  const stats = opsSnapshot?.stats;
  const analytics = opsSnapshot?.analytics;
  const live = opsSnapshot?.live;
  const analysis = opsSnapshot?.analysis;
  const healthCounts = opsSnapshot?.health_counts || {};
  const upcomingShows = opsSnapshot?.upcoming_shows || [];
  const eventing = opsSnapshot?.eventing;
  const domainEvents = eventing?.domain_events;
  const recentDomainEvents = domainEvents?.recent_events ?? [];
  const sseSurfaces = eventing?.sse_surfaces ?? [];

  if (loadingSnapshot && !opsSnapshot) {
    return (
      <div className="space-y-6">
        <div className="rounded-md border border-white/10 bg-panel-surface/95 p-5 shadow-[0_28px_80px_rgba(0,0,0,0.28)]">
          <GridSkeleton count={1} columns="grid-cols-1" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-md border border-white/10 bg-panel-surface p-6">
              <GridSkeleton count={1} columns="grid-cols-1" />
            </div>
          ))}
        </div>
        <GridSkeleton count={3} columns="grid-cols-3" />
      </div>
    );
  }

  if (snapshotError && !opsSnapshot) {
    return <ErrorState message="Failed to load dashboard" onRetry={() => void refresh(true)} />;
  }

  const recentAlbums = stats?.recent_albums ?? [];
  const runningTasks = live?.running_tasks ?? [];
  const recentTasks = live?.recent_tasks ?? [];
  const systems = live?.systems;
  const workerSlots = live?.worker_slots;
  const dbHeavyGate = live?.db_heavy_gate;
  const runtime = opsSnapshot?.runtime;

  const totalHealthIssues = Object.values(healthCounts).reduce((sum, count) => sum + count, 0);
  const topHealthEntry = Object.entries(healthCounts).sort(([, a], [, b]) => b - a)[0] ?? null;
  const topHealthLabel = topHealthEntry ? prettifyHealthType(topHealthEntry[0]) : null;

  const runningTotal = queueTotal(live?.queue_breakdown.running);
  const queuedTotal = queueTotal(live?.queue_breakdown.pending);
  const pendingImports =
    stats?.pending_imports ??
    opsSnapshot?.recent?.pending_imports ??
    opsSnapshot?.status?.pending_imports ??
    0;
  const recentFailedTasks = recentTasks.filter((task) => task.status === "failed");
  const recentCompletedTasks = recentTasks.filter((task) => task.status === "completed");
  const analysisBacklog = (analysis?.analysis_pending ?? 0) + (analysis?.analysis_active ?? 0);
  const blissBacklog = (analysis?.bliss_pending ?? 0) + (analysis?.bliss_active ?? 0);
  const fingerprintBacklog = analysis?.fingerprint_pending ?? 0;
  const totalAnalysisFailures = (analysis?.analysis_failed ?? 0) + (analysis?.bliss_failed ?? 0);

  const opsHealthy = Boolean(systems?.postgres) && Boolean(systems?.watcher);
  const workerSaturated = Boolean(workerSlots && workerSlots.max > 0 && workerSlots.active >= workerSlots.max);

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];

    if (!systems?.postgres || !systems?.watcher) {
      const degraded = [
        !systems?.postgres ? "PostgreSQL" : null,
        !systems?.watcher ? "watcher" : null,
      ].filter(Boolean).join(" + ");
      items.push({
        key: "systems",
        title: "Core services are degraded",
        detail: `${degraded} is not reporting healthy. Check system status before running heavy ops work.`,
        tone: "danger",
        actionLabel: "Open system",
        href: "/system",
      });
    }

    if (totalHealthIssues > 0) {
      items.push({
        key: "health",
        title: `${formatNumber(totalHealthIssues)} library issue${totalHealthIssues === 1 ? "" : "s"} open`,
        detail: topHealthLabel
          ? `${topHealthLabel} is the biggest bucket right now. Start here if you want the highest leverage cleanup.`
          : "Open health issues are waiting for review or repair.",
        tone: totalHealthIssues >= 10 ? "danger" : "warning",
        actionLabel: "Open health",
        href: "/health",
      });
    }

    if (recentFailedTasks.length > 0) {
      const latestFailed = recentFailedTasks[0];
      items.push({
        key: "failures",
        title: `${recentFailedTasks.length} recent task failure${recentFailedTasks.length === 1 ? "" : "s"}`,
        detail: latestFailed
          ? `${prettifyTaskType(latestFailed.type)} failed ${timeAgo(latestFailed.updated_at)}. Inspect tasks before it gets buried.`
          : "Recent task failures need review.",
        tone: "danger",
        actionLabel: "Open tasks",
        href: "/tasks",
      });
    }

    if (pendingImports > 0) {
      items.push({
        key: "imports",
        title: `${formatNumber(pendingImports)} import${pendingImports === 1 ? "" : "s"} waiting`,
        detail: "Library additions are queued but not yet landed. Good next stop if you're checking acquisition flow.",
        tone: pendingImports >= 10 ? "warning" : "info",
        actionLabel: "Open tasks",
        href: "/tasks",
      });
    }

    if ((dbHeavyGate?.blocking ?? false) || (dbHeavyGate?.pending ?? 0) > 0) {
      items.push({
        key: "db-heavy",
        title: "DB-heavy work is backing up",
        detail: `${dbHeavyGate?.active ?? 0} active and ${dbHeavyGate?.pending ?? 0} queued. Heavy analysis or rebuild work is slowing the pipe.`,
        tone: "warning",
        actionLabel: "Open analysis",
        href: "/analysis",
      });
    }

    if (totalAnalysisFailures > 0) {
      items.push({
        key: "analysis-failures",
        title: `${formatNumber(totalAnalysisFailures)} analysis failure${totalAnalysisFailures === 1 ? "" : "s"}`,
        detail: "Audio analysis or bliss jobs have failed and need investigation before the backlog can clear cleanly.",
        tone: "warning",
        actionLabel: "Open analysis",
        href: "/analysis",
      });
    }

    if (workerSaturated) {
      items.push({
        key: "worker-capacity",
        title: "Worker capacity is saturated",
        detail: `${workerSlots?.active ?? 0}/${workerSlots?.max ?? 0} slots are occupied. Expect slower turnaround until work drains.`,
        tone: "info",
        actionLabel: "Open tasks",
        href: "/tasks",
      });
    }

    return items.slice(0, 6);
  }, [
    dbHeavyGate?.active,
    dbHeavyGate?.blocking,
    dbHeavyGate?.pending,
    pendingImports,
    recentFailedTasks,
    systems?.postgres,
    systems?.watcher,
    topHealthLabel,
    totalAnalysisFailures,
    totalHealthIssues,
    workerSlots?.active,
    workerSlots?.max,
    workerSaturated,
  ]);

  async function triggerLibrarySync() {
    try {
      await api("/api/tasks/sync-library", "POST");
      toast.success("Library sync started");
      void refresh(true);
    } catch {
      toast.error("Sync already running or failed");
    }
  }

  return (
    <div className="space-y-8">
      <OpsPageHero
        icon={Activity}
        title="Dashboard"
        description="First-glance state of the library, worker queues, and the things that need attention now."
        actions={(
          <>
            <CratePill onClick={() => navigate("/health")} icon={HeartPulse}>
              Health
            </CratePill>
            <CratePill onClick={() => navigate("/tasks")} icon={Clock}>
              Tasks
            </CratePill>
            <CratePill onClick={() => navigate("/upcoming")} icon={CalendarDays}>
              Upcoming
            </CratePill>
            <Button variant="outline" onClick={() => void triggerLibrarySync()}>
              <RefreshCw size={14} className="mr-2" />
              Sync library
            </Button>
          </>
        )}
      >
        <CrateChip icon={Clock}>
          Last scan {stats?.last_scan ? timeAgo(stats.last_scan) : "not recorded"}
        </CrateChip>
        <CrateChip
          icon={Database}
          className={systems?.postgres ? "border-green-500/25 bg-green-500/10 text-green-300" : "border-red-500/25 bg-red-500/10 text-red-300"}
        >
          PostgreSQL {systems?.postgres ? "online" : "offline"}
        </CrateChip>
        <CrateChip
          icon={Eye}
          className={systems?.watcher ? "border-green-500/25 bg-green-500/10 text-green-300" : "border-red-500/25 bg-red-500/10 text-red-300"}
        >
          Watcher {systems?.watcher ? "online" : "offline"}
        </CrateChip>
        <CrateChip
          icon={Stethoscope}
          className={totalHealthIssues > 0 ? "border-amber-500/25 bg-amber-500/10 text-amber-200" : "border-green-500/25 bg-green-500/10 text-green-300"}
        >
          {totalHealthIssues > 0 ? `${formatNumber(totalHealthIssues)} open issues` : "Health clean"}
        </CrateChip>
      </OpsPageHero>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OpsStatTile
          icon={HeartPulse}
          label="Health"
          value={totalHealthIssues > 0 ? `${formatNumber(totalHealthIssues)} open` : "Clean"}
          caption={topHealthLabel ? `${topHealthLabel} is leading` : "No open repair issues right now"}
          tone={totalHealthIssues > 0 ? "warning" : "success"}
        />
        <OpsStatTile
          icon={Activity}
          label="Pipeline"
          value={`${formatNumber(runningTotal)} running · ${formatNumber(queuedTotal)} queued`}
          caption={`${formatNumber(pendingImports)} pending imports`}
          tone={queuedTotal > 0 || pendingImports > 0 ? "primary" : "default"}
        />
        <OpsStatTile
          icon={Users}
          label="Activity"
          value={`${formatNumber(runtime?.active_users_5m ?? 0)} users · ${formatNumber(runtime?.streams_3m ?? 0)} streams`}
          caption="Active in the last 5 minutes / streams in the last 3 minutes"
          tone={(runtime?.active_users_5m ?? 0) > 0 || (runtime?.streams_3m ?? 0) > 0 ? "success" : "default"}
        />
        <OpsStatTile
          icon={Cpu}
          label="Ops"
          value={opsHealthy ? "Healthy" : "Degraded"}
          caption={workerSlots ? `${workerSlots.active}/${workerSlots.max} worker slots in use` : "Worker status unavailable"}
          tone={opsHealthy ? "success" : "danger"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_0.9fr]">
        <OpsPanel
          icon={AlertTriangle}
          title="Needs Attention"
          description="A short, prioritized queue of the things most worth looking at right now."
          action={(
            <Button variant="outline" size="sm" onClick={() => void refresh(true)}>
              <RefreshCw size={14} className="mr-1" />
              Refresh
            </Button>
          )}
        >
          {attentionItems.length > 0 ? (
            <div className="space-y-3">
              {attentionItems.map((item) => (
                <div
                  key={item.key}
                  className={cn(
                    "flex flex-col gap-3 rounded-md border px-4 py-4 shadow-[0_16px_36px_rgba(0,0,0,0.16)] md:flex-row md:items-start md:justify-between",
                    attentionToneClasses(item.tone),
                  )}
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <CrateChip className={attentionChipClasses(item.tone)}>
                        {item.tone === "danger" ? "Needs action" : item.tone === "warning" ? "Review soon" : "Worth checking"}
                      </CrateChip>
                      <div className="text-base font-medium text-white">{item.title}</div>
                    </div>
                    <div className="max-w-3xl text-sm text-white/65">{item.detail}</div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => navigate(item.href)}
                  >
                    {item.actionLabel}
                    <ArrowRight size={14} className="ml-1" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-4 py-5 text-sm shadow-[0_16px_36px_rgba(0,0,0,0.16)]">
              <div className="flex items-center gap-2 text-emerald-200">
                <CheckCircle2 size={16} />
                <span className="font-medium">{emptyStateTitle(totalHealthIssues, queuedTotal, pendingImports)}</span>
              </div>
              <div className="mt-2 text-emerald-100/75">
                No urgent blockers surfaced in health, task failures or queue pressure. The pipe looks calm.
              </div>
            </div>
          )}
        </OpsPanel>

        <OpsPanel
          icon={RadioTower}
          title="Right Now"
          description="Quick operational readout without diving into lower-level diagnostics."
        >
          <div className="space-y-3">
            <div className="rounded-md border border-white/8 bg-white/[0.04] px-3 py-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-white/55">Worker slots</span>
                <span className="font-medium text-white">{workerSlots ? `${workerSlots.active}/${workerSlots.max}` : "-"}</span>
              </div>
            </div>
            <div className="rounded-md border border-white/8 bg-white/[0.04] px-3 py-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-white/55">DB-heavy gate</span>
                <span className="font-medium text-white">
                  {dbHeavyGate ? `${dbHeavyGate.active} active / ${dbHeavyGate.pending} queued` : "-"}
                </span>
              </div>
              {dbHeavyGate?.blocking ? (
                <div className="mt-1 text-xs text-amber-200">Queued heavy work is waiting on the current heavy task to finish.</div>
              ) : null}
            </div>
            <div className="rounded-md border border-white/8 bg-white/[0.04] px-3 py-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-white/55">Latest scan</span>
                <span className="font-medium text-white">{stats?.last_scan ? timeAgo(stats.last_scan) : "Not recorded"}</span>
              </div>
            </div>
            <div className="rounded-md border border-white/8 bg-white/[0.04] px-3 py-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-white/55">Upcoming shows</span>
                <span className="font-medium text-white">{formatNumber(upcomingShows.length)}</span>
              </div>
            </div>
            <div className="rounded-md border border-white/8 bg-white/[0.04] px-3 py-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-white/55">Recent completions</span>
                <span className="font-medium text-white">{formatNumber(recentCompletedTasks.length)}</span>
              </div>
            </div>
          </div>
        </OpsPanel>
      </div>

      <OpsPanel
        icon={Cpu}
        title="Pipeline"
        description="How work is flowing through imports, analysis and background processing right now."
      >
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <OpsStatTile
            icon={HardDrive}
            label="Imports waiting"
            value={formatNumber(pendingImports)}
            caption="Pending queue items not yet landed"
            tone={pendingImports > 0 ? "warning" : "default"}
          />
          <OpsStatTile
            icon={Activity}
            label="Analysis backlog"
            value={formatNumber(analysisBacklog)}
            caption={`${formatNumber(analysis?.analysis_failed ?? 0)} failed`}
            tone={analysisBacklog > 0 ? "primary" : "default"}
          />
          <OpsStatTile
            icon={Music}
            label="Bliss backlog"
            value={formatNumber(blissBacklog)}
            caption={`${formatNumber(analysis?.bliss_failed ?? 0)} failed`}
            tone={blissBacklog > 0 ? "primary" : "default"}
          />
          <OpsStatTile
            icon={Eye}
            label="Fingerprint queue"
            value={formatNumber(fingerprintBacklog)}
            caption={analysis?.chromaprint_available ? `Strategy ${analysis.fingerprint_strategy}` : "Chromaprint unavailable"}
            tone={fingerprintBacklog > 0 ? "primary" : "default"}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className="border-white/10 bg-black/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Running now</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {runningTasks.length > 0 ? runningTasks.slice(0, 6).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 rounded-md border border-cyan-500/15 bg-cyan-500/10 px-3 py-3 text-sm"
                  >
                    <Loader2 size={14} className="animate-spin text-cyan-300 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-white">{prettifyTaskType(task.type)}</div>
                      <div className="truncate text-xs text-white/45">
                        {task.progress || "In progress"}
                        {task.pool ? ` · ${task.pool}` : ""}
                      </div>
                    </div>
                    <span className="text-[11px] text-white/35">
                      {task.updated_at ? timeAgo(task.updated_at) : "live"}
                    </span>
                  </div>
                )) : (
                  <div className="rounded-md border border-dashed border-white/10 bg-white/[0.03] px-3 py-6 text-sm text-white/45">
                    No running tasks right now.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-black/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Recently finished</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {recentTasks.length > 0 ? recentTasks.slice(0, 6).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 rounded-md border border-white/8 bg-white/[0.04] px-3 py-3 text-sm"
                  >
                    {task.status === "completed" ? (
                      <CheckCircle2 size={14} className="shrink-0 text-emerald-300" />
                    ) : task.status === "failed" ? (
                      <AlertTriangle size={14} className="shrink-0 text-red-300" />
                    ) : (
                      <Clock size={14} className="shrink-0 text-white/45" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-white">{prettifyTaskType(task.type)}</div>
                      <div className="truncate text-xs text-white/45">{task.status}</div>
                    </div>
                    <span className="text-[11px] text-white/35">{timeAgo(task.updated_at)}</span>
                  </div>
                )) : (
                  <div className="rounded-md border border-dashed border-white/10 bg-white/[0.03] px-3 py-6 text-sm text-white/45">
                    No recent task activity recorded.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </OpsPanel>

      <OpsPanel
        icon={Music}
        title="Library Changes"
        description="Recent additions, what is coming up soon, and a compact sense of library footprint."
      >
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
          <Card className="border-white/10 bg-black/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-sm">Recently added albums</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => navigate("/browse?sort=recent")}>
                  Browse recent
                  <ArrowRight size={14} className="ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {recentAlbums.length > 0 ? (
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {recentAlbums.map((album, index) => (
                    <button
                      key={`${album.artist}-${album.name}-${index}`}
                      onClick={() => navigate(albumPagePath({ albumId: album.id, albumSlug: album.slug, artistName: album.artist, albumName: album.name }))}
                      className="group w-[152px] shrink-0 text-left"
                    >
                      <div className="relative mb-3 h-[152px] w-[152px] overflow-hidden rounded-md border border-white/10 bg-secondary/70 shadow-[0_20px_44px_rgba(0,0,0,0.22)]">
                        <img
                          src={albumCoverApiUrl({ albumId: album.id, albumSlug: album.slug, artistName: album.artist, albumName: album.name })}
                          alt={album.name}
                          loading="lazy"
                          className="h-full w-full object-cover"
                          onError={(event) => { (event.target as HTMLImageElement).style.display = "none"; }}
                        />
                        <div className="absolute inset-0 -z-10 flex items-center justify-center bg-secondary">
                          <Music size={28} className="text-muted-foreground/30" />
                        </div>
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                          <ArrowRight size={20} className="text-white" />
                        </div>
                      </div>
                      <div className="truncate text-sm font-medium text-white">{album.display_name || album.name}</div>
                      <div className="truncate text-[11px] text-white/45">{album.artist}</div>
                      {album.year ? <div className="mt-1 text-[10px] text-white/35">{album.year}</div> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-white/10 bg-white/[0.03] px-3 py-6 text-sm text-white/45">
                  No recent albums available yet.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="border-white/10 bg-black/20">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-sm">Upcoming</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/upcoming")}>
                    View all
                    <ArrowRight size={14} className="ml-1" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {upcomingShows.length > 0 ? (
                  <div className="space-y-3">
                    {upcomingShows.slice(0, 4).map((show, index) => (
                      <div key={index} className="rounded-md border border-white/8 bg-white/[0.04] px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-white">{show.artist_name || "Unknown artist"}</div>
                            <div className="mt-1 text-xs leading-5 text-white/50">
                              {[show.venue, show.city, show.country].filter(Boolean).join(" · ") || "Venue TBA"}
                            </div>
                          </div>
                          <div className="shrink-0 rounded-md border border-white/10 bg-white/[0.05] px-2.5 py-1 text-right">
                            <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">
                              {show.date
                                ? new Date(show.date).toLocaleDateString(undefined, { month: "short" })
                                : "TBA"}
                            </div>
                            <div className="text-sm font-medium text-white">
                              {show.date
                                ? new Date(show.date).toLocaleDateString(undefined, { day: "numeric" })
                                : "—"}
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 text-[11px] text-white/35">
                          {show.date
                            ? new Date(show.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
                            : "Date TBA"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-white/10 bg-white/[0.03] px-3 py-6 text-sm text-white/45">
                    No upcoming shows found for your library artists.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-black/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Collection footprint</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-md border border-white/8 bg-white/[0.04] px-3 py-2 text-sm">
                    <span className="text-white/45">Artists</span>
                    <span className="font-medium text-white">{formatNumber(stats?.artists ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-white/8 bg-white/[0.04] px-3 py-2 text-sm">
                    <span className="text-white/45">Albums</span>
                    <span className="font-medium text-white">{formatNumber(stats?.albums ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-white/8 bg-white/[0.04] px-3 py-2 text-sm">
                    <span className="text-white/45">Tracks</span>
                    <span className="font-medium text-white">{formatNumber(stats?.tracks ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-white/8 bg-white/[0.04] px-3 py-2 text-sm">
                    <span className="text-white/45">Library size</span>
                    <span className="font-medium text-white">{stats?.total_size_gb ? `${stats.total_size_gb} GB` : "0 GB"}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-white/8 bg-white/[0.04] px-3 py-2 text-sm">
                    <span className="text-white/45">Duration</span>
                    <span className="font-medium text-white">{stats?.total_duration_hours ? `${stats.total_duration_hours}h` : "-"}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </OpsPanel>

      <OpsPanel
        icon={Database}
        title="Advanced Diagnostics"
        description="Low-level transport, eventing and collection profiling for deeper debugging. Useful, but intentionally not first in the hierarchy."
        action={(
          <Button variant="outline" size="sm" onClick={() => setShowAdvanced((value) => !value)}>
            {showAdvanced ? <ChevronUp size={14} className="mr-1" /> : <ChevronDown size={14} className="mr-1" />}
            {showAdvanced ? "Hide diagnostics" : "Show diagnostics"}
          </Button>
        )}
      >
        {showAdvanced ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card className="border-white/10 bg-black/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Event Bus & SSE</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    <OpsStatTile
                      icon={Activity}
                      label="Domain sequence"
                      value={formatNumber(domainEvents?.latest_sequence ?? 0)}
                      caption={domainEvents?.stream_key || "Domain-event stream"}
                      tone={eventing?.redis_connected ? "primary" : "warning"}
                    />
                    <OpsStatTile
                      icon={Database}
                      label="Stream depth"
                      value={formatNumber(domainEvents?.stream_length ?? 0)}
                      caption={domainEvents?.consumer_group ? `${domainEvents.consumer_group} consumer group` : "No consumer group"}
                    />
                    <OpsStatTile
                      icon={Clock}
                      label="Pending acks"
                      value={formatNumber(domainEvents?.pending ?? 0)}
                      caption={domainEvents?.last_delivered_id ? `Last delivered ${domainEvents.last_delivered_id}` : "Projector idle"}
                      tone={(domainEvents?.pending ?? 0) > 0 ? "warning" : "success"}
                    />
                    <OpsStatTile
                      icon={Eye}
                      label="SSE surfaces"
                      value={formatNumber(sseSurfaces.length)}
                      caption={`${formatNumber(eventing?.cache_invalidation?.retained_events ?? 0)} retained invalidations`}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-black/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Recent domain events</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {recentDomainEvents.length > 0 ? recentDomainEvents.map((event) => (
                      <div key={`${event.id}-${event.event_type}`} className="rounded-md border border-white/8 bg-white/[0.04] px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <CrateChip className="border-cyan-500/20 bg-cyan-500/10 text-cyan-200">
                            {event.event_type || "unknown"}
                          </CrateChip>
                          <span className="text-[11px] text-white/35">{event.id}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/55">
                          <span>scope: {event.scope || "—"}</span>
                          <span>subject: {event.subject_key || "—"}</span>
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-md border border-dashed border-white/10 bg-white/[0.03] px-3 py-6 text-sm text-white/45">
                        No recent domain events captured in the retained stream window.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Card className="border-white/10 bg-black/20">
                <CardHeader>
                  <CardTitle className="text-sm">Formats</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[220px]">
                    {(analytics?.formats || stats?.formats) && Object.keys(analytics?.formats || stats?.formats || {}).length > 0 ? (
                      <ResponsivePie
                        data={Object.entries(analytics?.formats || stats?.formats || {}).map(([key, value]) => ({ id: key, value }))}
                        margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                        innerRadius={0.6}
                        padAngle={2}
                        cornerRadius={4}
                        colors={["#06b6d4", "#06b6d4cc", "#06b6d499", "#06b6d466", "#06b6d433"]}
                        borderWidth={0}
                        enableArcLinkLabels
                        arcLinkLabelsColor={{ from: "color" }}
                        arcLinkLabelsTextColor="#9ca3af"
                        arcLinkLabelsThickness={2}
                        arcLabelsTextColor="#fff"
                        theme={{ tooltip: { container: { background: "var(--color-card)", color: "var(--color-foreground)", borderRadius: "8px", fontSize: 12, border: "1px solid var(--color-border)" } } }}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data</div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-black/20 xl:col-span-2">
                <CardHeader>
                  <CardTitle className="text-sm">Albums by decade</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[220px]">
                    {analytics?.decades && Object.keys(analytics.decades).length > 0 ? (
                      <ResponsiveBar
                        data={Object.entries(analytics.decades).sort(([a], [b]) => a.localeCompare(b)).map(([decade, count]) => ({ decade, albums: count }))}
                        keys={["albums"]}
                        indexBy="decade"
                        margin={{ top: 10, right: 10, bottom: 35, left: 40 }}
                        padding={0.3}
                        colors={["#06b6d4"]}
                        borderRadius={4}
                        enableLabel={false}
                        axisBottom={{ tickRotation: -45 }}
                        theme={{
                          axis: { ticks: { text: { fill: "#6b7280", fontSize: 11 } } },
                          grid: { line: { stroke: "var(--color-border)" } },
                          tooltip: { container: { background: "var(--color-card)", color: "var(--color-foreground)", borderRadius: "8px", fontSize: 12, border: "1px solid var(--color-border)" } },
                        }}
                        animate
                        motionConfig="gentle"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card className="border-white/10 bg-black/20">
                <CardHeader>
                  <CardTitle className="text-sm">Top genres</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[200px]">
                    {(stats?.top_genres ?? []).length > 0 ? (
                      <ResponsiveBar
                        data={stats!.top_genres.slice(0, 8).map((genre) => ({
                          genre: genre.name.length > 14 ? `${genre.name.slice(0, 14)}...` : genre.name,
                          tracks: genre.count,
                        }))}
                        keys={["tracks"]}
                        indexBy="genre"
                        layout="horizontal"
                        margin={{ top: 5, right: 20, bottom: 5, left: 100 }}
                        padding={0.3}
                        colors={["#06b6d4"]}
                        borderRadius={3}
                        enableLabel
                        labelTextColor="#fff"
                        theme={{
                          axis: { ticks: { text: { fill: "#9ca3af", fontSize: 11 } } },
                          grid: { line: { stroke: "var(--color-border)" } },
                          tooltip: { container: { background: "var(--color-card)", color: "var(--color-foreground)", borderRadius: "8px", fontSize: 12, border: "1px solid var(--color-border)" } },
                        }}
                        animate
                        motionConfig="gentle"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No genre data</div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-black/20">
                <CardHeader>
                  <CardTitle className="text-sm">Deep library stats</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between rounded-md border border-white/6 bg-white/[0.04] px-3 py-2 text-sm">
                      <span className="text-white/45">Avg bitrate</span>
                      <span className="font-medium text-white">{stats?.avg_bitrate ? `${Math.round(stats.avg_bitrate / 1000)}k` : "-"}</span>
                    </div>
                    <div className="flex justify-between rounded-md border border-white/6 bg-white/[0.04] px-3 py-2 text-sm">
                      <span className="text-white/45">Avg album duration</span>
                      <span className="font-medium text-white">{stats?.avg_album_duration_min ? `${stats.avg_album_duration_min} min` : "-"}</span>
                    </div>
                    <div className="flex justify-between rounded-md border border-white/6 bg-white/[0.04] px-3 py-2 text-sm">
                      <span className="text-white/45">Avg tracks/album</span>
                      <span className="font-medium text-white">{stats?.avg_tracks_per_album ?? "-"}</span>
                    </div>
                    <div className="flex justify-between rounded-md border border-white/6 bg-white/[0.04] px-3 py-2 text-sm">
                      <span className="text-white/45">Analyzed tracks</span>
                      <span className="font-medium text-white">{formatNumber(stats?.analyzed_tracks ?? 0)}</span>
                    </div>
                    <div className="flex justify-between rounded-md border border-white/6 bg-white/[0.04] px-3 py-2 text-sm">
                      <span className="text-white/45">Pending tasks</span>
                      <span className="font-medium text-white">{stats?.pending_tasks ?? 0}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {isAdmin ? (
              <Card className="border-red-500/20 bg-red-500/[0.06]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-red-100">Danger zone</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-3 md:flex-row">
                    <Button variant="outline" className="border-white/10" onClick={() => setShowRebuildConfirm(true)}>
                      <RotateCcw size={14} className="mr-1" />
                      Rebuild library
                    </Button>
                    <Button
                      variant="outline"
                      className="border-red-500/30 text-red-200 hover:bg-red-500/10"
                      onClick={() => setShowWipeConfirm(true)}
                    >
                      <Trash2 size={14} className="mr-1" />
                      Wipe database
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-white/45">
            Open this section when you need charts, event-bus visibility, or destructive maintenance actions. It is intentionally out of the way during normal daily use.
          </div>
        )}
      </OpsPanel>

      <ConfirmDialog
        open={showRebuildConfirm}
        onOpenChange={setShowRebuildConfirm}
        title="Rebuild Library"
        description="This will wipe the entire library database and rebuild from scratch. This includes: wipe DB, health check, repair, full sync, and re-enrichment. This may take a while."
        confirmLabel="Rebuild Library"
        variant="destructive"
        onConfirm={async () => {
          try {
            await api("/api/manage/rebuild", "POST");
            toast.success("Library rebuild started");
            void refresh(true);
          } catch {
            toast.error("Failed to start rebuild");
          }
        }}
      />

      <ConfirmDialog
        open={showWipeConfirm}
        onOpenChange={setShowWipeConfirm}
        title="Wipe Library Database"
        description="This will permanently delete ALL library data (artists, albums, tracks) from the database. Files on disk will NOT be affected. This action cannot be undone."
        confirmLabel="Wipe Database"
        variant="destructive"
        onConfirm={async () => {
          try {
            await api("/api/manage/wipe", "POST", { rebuild: false });
            toast.success("Library database wiped");
            void refresh(true);
          } catch {
            toast.error("Failed to wipe database");
          }
        }}
      />
    </div>
  );
}
