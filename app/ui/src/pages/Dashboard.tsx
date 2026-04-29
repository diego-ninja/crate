import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { CrateChip, CratePill } from "@crate/ui/primitives/CrateBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@crate/ui/shadcn/card";
import { Button } from "@crate/ui/shadcn/button";
import { OpsPanel, OpsStatTile } from "@/components/admin/ops-surfaces";
import { GridSkeleton } from "@/components/ui/grid-skeleton";
import { useOpsSnapshot } from "@/contexts/OpsSnapshotContext";
import { api } from "@/lib/api";
import { albumCoverApiUrl, albumPagePath } from "@/lib/library-routes";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveBar } from "@nivo/bar";
import { formatNumber, timeAgo } from "@/lib/utils";
import {
  Users, Disc3, Music, HardDrive, Loader2, ArrowRight,
  RefreshCw, CheckCircle2, XCircle, Clock,
  Activity, Database, Eye, Cpu, RotateCcw, Trash2, Stethoscope, CalendarDays,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function Dashboard() {
  const { data: opsSnapshot, loading: loadingSnapshot, error: snapshotError, refresh } = useOpsSnapshot();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);
  const stats = opsSnapshot?.stats;
  const analytics = opsSnapshot?.analytics;
  const live = opsSnapshot?.live;
  const healthCounts = opsSnapshot?.health_counts || {};
  const upcomingShows = opsSnapshot?.upcoming_shows || [];
  const eventing = opsSnapshot?.eventing;
  const domainEvents = eventing?.domain_events;
  const recentDomainEvents = domainEvents?.recent_events ?? [];
  const sseSurfaces = eventing?.sse_surfaces ?? [];

  if (loadingSnapshot && !opsSnapshot) {
    return (
      <div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="bg-card border border-border rounded-md p-6">
              <GridSkeleton count={1} columns="grid-cols-1" />
            </div>
          ))}
        </div>
        <GridSkeleton count={2} columns="grid-cols-2" />
      </div>
    );
  }

  if (snapshotError && !opsSnapshot) {
    return <ErrorState message="Failed to load dashboard" onRetry={() => void refresh(true)} />;
  }

  const heroStats = [
    {
      label: "Artists",
      value: formatNumber(stats?.artists ?? 0),
      icon: Users,
      chipClass: "border-cyan-400/20 bg-cyan-400/12 text-cyan-200",
    },
    {
      label: "Albums",
      value: formatNumber(stats?.albums ?? 0),
      icon: Disc3,
      chipClass: "border-blue-400/20 bg-blue-400/12 text-blue-200",
    },
    {
      label: "Tracks",
      value: formatNumber(stats?.tracks ?? 0),
      icon: Music,
      chipClass: "border-emerald-400/20 bg-emerald-400/12 text-emerald-200",
    },
    {
      label: "Library Size",
      value: stats?.total_size_gb ? `${stats.total_size_gb} GB` : "0 GB",
      icon: HardDrive,
      chipClass: "border-amber-400/20 bg-amber-400/12 text-amber-200",
    },
  ];

  const recentAlbums = stats?.recent_albums ?? [];
  const runningTasks = live?.running_tasks ?? [];
  const recentTasks = live?.recent_tasks ?? [];
  const systems = live?.systems;
  const workerSlots = live?.worker_slots;
  const dbHeavyGate = live?.db_heavy_gate;
  const totalHealthIssues = Object.values(healthCounts).reduce((sum, count) => sum + count, 0);
  const sseModeClass = (mode: string) => {
    switch (mode) {
      case "snapshot":
        return "border-cyan-500/25 bg-cyan-500/10 text-cyan-200";
      case "replay":
        return "border-amber-500/25 bg-amber-500/10 text-amber-200";
      default:
        return "border-white/10 bg-white/[0.05] text-white/65";
    }
  };

  return (
    <div className="space-y-8">
      <section className="rounded-md border border-white/10 bg-panel-surface/95 p-5 shadow-[0_28px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/12 text-primary shadow-[0_18px_40px_rgba(6,182,212,0.14)]">
                <Activity size={22} />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">Dashboard</h1>
                <p className="text-sm text-white/55">
                  Operational pulse for the library, worker activity, and acquisition pipeline.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <CrateChip icon={Clock}>
                Last scan {stats?.last_scan ? timeAgo(stats.last_scan) : "not recorded"}
              </CrateChip>
              <CrateChip icon={Database} className={systems?.postgres ? "border-green-500/25 bg-green-500/10 text-green-300" : "border-red-500/25 bg-red-500/10 text-red-300"}>
                PostgreSQL {systems?.postgres ? "online" : "offline"}
              </CrateChip>
              <CrateChip icon={Cpu}>
                Worker {workerSlots ? `${workerSlots.active}/${workerSlots.max} slots` : "not reporting"}
              </CrateChip>
              {dbHeavyGate && (dbHeavyGate.active > 0 || dbHeavyGate.pending > 0) ? (
                <CrateChip
                  icon={Activity}
                  className={dbHeavyGate.blocking ? "border-amber-500/25 bg-amber-500/10 text-amber-200" : "border-white/10 bg-white/[0.05] text-white/70"}
                >
                  DB-heavy {dbHeavyGate.active} active / {dbHeavyGate.pending} queued
                </CrateChip>
              ) : null}
              <CrateChip icon={Stethoscope} className={totalHealthIssues > 0 ? "border-amber-500/25 bg-amber-500/10 text-amber-200" : "border-green-500/25 bg-green-500/10 text-green-300"}>
                {totalHealthIssues > 0 ? `${totalHealthIssues} open issues` : "Health clean"}
              </CrateChip>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <CratePill onClick={() => navigate("/health")} icon={Stethoscope}>
              Health
            </CratePill>
            <CratePill onClick={() => navigate("/upcoming")} icon={CalendarDays}>
              Upcoming
            </CratePill>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await api("/api/tasks/sync-library", "POST");
                  toast.success("Library sync started");
                  void refresh(true);
                } catch {
                  toast.error("Sync already running or failed");
                }
              }}
            >
              <RefreshCw size={14} className="mr-2" />
              Sync library
            </Button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {heroStats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="overflow-hidden border-white/10 bg-panel-surface shadow-[0_24px_70px_rgba(0,0,0,0.2)]">
              <CardContent className="pt-6">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-2xl font-semibold tracking-tight text-white">{s.value}</div>
                    <div className="mt-1 text-xs text-white/50">{s.label}</div>
                  </div>
                  <div className={`flex h-11 w-11 items-center justify-center rounded-md border shadow-[0_16px_36px_rgba(0,0,0,0.18)] ${s.chipClass}`}>
                    <Icon size={20} />
                  </div>
                </div>
                <div className="h-px w-full bg-gradient-to-r from-white/10 via-white/5 to-transparent" />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Row 2: Live Activity Feed + System Status */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="col-span-1 border-white/10 bg-panel-surface md:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Activity size={14} />
                Live Activity
              </CardTitle>
              {runningTasks.length > 0 && (
                <CrateChip className="border-blue-500/25 bg-blue-500/10 text-blue-300">
                  {runningTasks.length} running
                </CrateChip>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex max-h-[300px] flex-col gap-2 overflow-y-auto">
              {runningTasks.map((t) => (
                <div key={t.id} className="flex items-center gap-3 rounded-md border border-blue-500/15 bg-blue-500/10 px-3 py-3 text-sm shadow-[0_12px_30px_rgba(0,0,0,0.16)]">
                  <Loader2 size={14} className="animate-spin text-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="capitalize text-white">{t.type.replace(/_/g, " ")}</span>
                    {t.progress && (
                      <span className="ml-2 text-white/45">({t.progress})</span>
                    )}
                  </div>
                  <CrateChip className="border-blue-500/25 bg-blue-500/10 text-blue-300">running</CrateChip>
                </div>
              ))}
              {recentTasks.filter(t => t.status !== "running").map((t) => (
                <div key={t.id} className="flex items-center gap-3 rounded-md border border-white/6 bg-white/[0.04] px-3 py-3 text-sm shadow-[0_12px_30px_rgba(0,0,0,0.14)]">
                  {t.status === "completed" ? (
                    <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                  ) : t.status === "failed" ? (
                    <XCircle size={14} className="text-red-500 flex-shrink-0" />
                  ) : (
                    <Clock size={14} className="text-muted-foreground flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="capitalize text-white">{t.type.replace(/_/g, " ")}</span>
                  </div>
                  <CrateChip
                    className={
                      t.status === "completed"
                        ? "border-green-500/25 bg-green-500/10 text-green-300"
                        : t.status === "failed"
                          ? "border-red-500/25 bg-red-500/10 text-red-300"
                          : ""
                    }
                  >
                    {t.status}
                  </CrateChip>
                  <span className="flex-shrink-0 text-[11px] text-white/40">
                    {timeAgo(t.updated_at)}
                  </span>
                </div>
              ))}
              {recentTasks.length === 0 && runningTasks.length === 0 && (
                <div className="py-8 text-center text-sm text-white/45">
                  No recent activity
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-panel-surface">
          <CardHeader>
            <CardTitle className="text-sm">System Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between rounded-md border border-white/6 bg-white/[0.04] px-3 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <Database size={14} className="text-muted-foreground" />
                  <span>PostgreSQL</span>
                </div>
                <div className={`w-2 h-2 rounded-md ${systems?.postgres ? "bg-green-500" : "bg-red-500"}`} />
              </div>
              <div className="flex items-center justify-between rounded-md border border-white/6 bg-white/[0.04] px-3 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <Cpu size={14} className="text-muted-foreground" />
                  <span>Worker</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {workerSlots ? `${workerSlots.active}/${workerSlots.max} slots` : "-"}
                </span>
              </div>
              {dbHeavyGate && (dbHeavyGate.active > 0 || dbHeavyGate.pending > 0) ? (
                <div className="rounded-md border border-white/6 bg-white/[0.04] px-3 py-3 text-xs text-white/70">
                  DB-heavy gate: {dbHeavyGate.active} active, {dbHeavyGate.pending} queued
                  {dbHeavyGate.blocking ? " — queued heavy work is waiting on the current heavy task to finish." : ""}
                </div>
              ) : null}
              <div className="flex items-center justify-between rounded-md border border-white/6 bg-white/[0.04] px-3 py-3 text-sm">
                <div className="flex items-center gap-2">
                  <Eye size={14} className="text-muted-foreground" />
                  <span>Watcher</span>
                </div>
                <div className={`w-2 h-2 rounded-md ${systems?.watcher ? "bg-green-500" : "bg-red-500"}`} />
              </div>

              <div className="mt-2 flex flex-col gap-2 border-t border-white/8 pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={async () => {
                    try {
                      await api("/api/tasks/sync-library", "POST");
                      toast.success("Library sync started");
                      void refresh(true);
                    } catch {
                      toast.error("Sync already running or failed");
                    }
                  }}
                >
                  <RefreshCw size={14} className="mr-1" />
                  Sync Library
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => navigate("/health")}
                >
                  <ArrowRight size={14} className="mr-1" />
                  Health Scan
                </Button>
                {isAdmin && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => setShowRebuildConfirm(true)}
                    >
                      <RotateCcw size={14} className="mr-1" />
                      Rebuild Library
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-red-500 border-red-500/30 hover:bg-red-500/10"
                      onClick={() => setShowWipeConfirm(true)}
                    >
                      <Trash2 size={14} className="mr-1" />
                      Wipe Database
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Health + Shows summary row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Health summary */}
        {Object.keys(healthCounts).length > 0 && (
          <Link to="/health" className="block">
            <Card className="h-full border-white/10 bg-panel-surface transition-colors hover:bg-white/[0.05]">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Stethoscope size={14} className="text-yellow-500" />
                  Library Health
                  <CrateChip className="ml-auto border-yellow-500/25 bg-yellow-500/10 text-yellow-200">
                    {Object.values(healthCounts).reduce((a, b) => a + b, 0)} issues
                  </CrateChip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(healthCounts).sort(([, a], [, b]) => b - a).slice(0, 5).map(([type, count]) => (
                    <CrateChip key={type}>{type.replace(/_/g, " ")} ({count})</CrateChip>
                  ))}
                </div>
              </CardContent>
            </Card>
          </Link>
        )}

        {/* Upcoming shows */}
        {upcomingShows.length > 0 && (
          <Link to="/upcoming" className="block">
            <Card className="h-full border-white/10 bg-panel-surface transition-colors hover:bg-white/[0.05]">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CalendarDays size={14} className="text-orange-500" />
                  Upcoming Shows
                  <CrateChip className="ml-auto border-orange-500/25 bg-orange-500/10 text-orange-200">
                    {upcomingShows.length}
                  </CrateChip>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {upcomingShows.slice(0, 3).map((s, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-md border border-white/6 bg-white/[0.04] px-3 py-2 text-xs">
                      <span className="truncate font-medium">{s.artist_name}</span>
                      <span className="truncate text-white/45">{s.venue}, {s.city}</span>
                      <span className="ml-auto flex-shrink-0 text-white/35">
                        {s.date
                          ? new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                          : "TBA"}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </Link>
        )}
      </div>

      <OpsPanel
        icon={Activity}
        title="Event Bus & SSE"
        description="Visibility into the Redis-backed domain-event stream, cache invalidations, and live SSE surfaces that keep admin and listen snapshots fresh."
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <OpsStatTile
            icon={Activity}
            label="Domain Sequence"
            value={formatNumber(domainEvents?.latest_sequence ?? 0)}
            caption={domainEvents?.stream_key || "Domain-event stream"}
            tone={eventing?.redis_connected ? "primary" : "warning"}
          />
          <OpsStatTile
            icon={Database}
            label="Stream Depth"
            value={formatNumber(domainEvents?.stream_length ?? 0)}
            caption={domainEvents?.consumer_group ? `${domainEvents.consumer_group} consumer group` : "No consumer group"}
          />
          <OpsStatTile
            icon={Clock}
            label="Pending Acks"
            value={formatNumber(domainEvents?.pending ?? 0)}
            caption={domainEvents?.last_delivered_id ? `Last delivered ${domainEvents.last_delivered_id}` : "Projector idle"}
            tone={(domainEvents?.pending ?? 0) > 0 ? "warning" : "success"}
          />
          <OpsStatTile
            icon={Eye}
            label="SSE Surfaces"
            value={formatNumber(sseSurfaces.length)}
            caption={`${formatNumber(eventing?.cache_invalidation?.retained_events ?? 0)} retained invalidations`}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className="border-white/10 bg-black/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Recent Domain Events</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                {recentDomainEvents.length > 0 ? recentDomainEvents.map((event) => (
                  <div
                    key={`${event.id}-${event.event_type}`}
                    className="rounded-md border border-white/8 bg-white/[0.04] px-3 py-3"
                  >
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

          <Card className="border-white/10 bg-black/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">SSE Surface Catalog</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                {sseSurfaces.map((surface) => (
                  <div
                    key={`${surface.name}-${surface.channel}`}
                    className="rounded-md border border-white/8 bg-white/[0.04] px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium text-white">{surface.name}</div>
                      <CrateChip className={sseModeClass(surface.mode)}>{surface.mode}</CrateChip>
                    </div>
                    {surface.endpoint ? (
                      <div className="mt-1 text-xs text-cyan-200">{surface.endpoint}</div>
                    ) : null}
                    <div className="mt-1 break-all text-[11px] text-white/40">{surface.channel}</div>
                    {surface.description ? (
                      <div className="mt-2 text-xs text-white/55">{surface.description}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </OpsPanel>

      {/* Row 3: Recent Albums */}
      {recentAlbums.length > 0 && (
        <Card className="border-white/10 bg-panel-surface">
          <CardHeader>
            <CardTitle className="text-sm">Recently Added Albums</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {recentAlbums.map((album, i) => (
                <button
                  key={`${album.artist}-${album.name}-${i}`}
                  onClick={() => navigate(albumPagePath({ albumId: album.id, albumSlug: album.slug }))}
                  className="group w-[148px] flex-shrink-0 text-left"
                >
                  <div className="relative mb-3 h-[148px] w-[148px] overflow-hidden rounded-md border border-white/10 bg-secondary/70 shadow-[0_20px_44px_rgba(0,0,0,0.22)]">
                    <img
                      src={albumCoverApiUrl({ albumId: album.id, albumSlug: album.slug, artistName: album.artist, albumName: album.name })}
                      alt={album.name}
                      loading="lazy"
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <div className="absolute inset-0 bg-secondary flex items-center justify-center -z-10">
                      <Music size={28} className="text-muted-foreground/30" />
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                      <ArrowRight size={20} className="text-white" />
                    </div>
                  </div>
                  <div className="truncate text-sm font-medium text-white">{album.display_name || album.name}</div>
                  <div className="truncate text-[11px] text-white/45">{album.artist}</div>
                  {album.year && (
                    <div className="mt-1 text-[10px] text-white/35">{album.year}</div>
                  )}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Row 4: Format donut + Decade bar (Nivo) */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="col-span-1 border-white/10 bg-panel-surface">
          <CardHeader>
            <CardTitle className="text-sm">Formats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              {(analytics?.formats || stats?.formats) && Object.keys(analytics?.formats || stats?.formats || {}).length > 0 ? (
                <ResponsivePie
                  data={Object.entries(analytics?.formats || stats?.formats || {}).map(([k, v]) => ({ id: k, value: v }))}
                  margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                  innerRadius={0.6}
                  padAngle={2}
                  cornerRadius={4}
                  colors={["#06b6d4", "#06b6d4cc", "#06b6d499", "#06b6d466", "#06b6d433"]}
                  borderWidth={0}
                  enableArcLinkLabels={true}
                  arcLinkLabelsColor={{ from: "color" }}
                  arcLinkLabelsTextColor="#9ca3af"
                  arcLinkLabelsThickness={2}
                  arcLabelsTextColor="#fff"
                  theme={{ tooltip: { container: { background: "var(--color-card)", color: "var(--color-foreground)", borderRadius: "8px", fontSize: 12, border: "1px solid var(--color-border)" } } }}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data</div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="col-span-1 border-white/10 bg-panel-surface md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Albums by Decade</CardTitle>
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
                  animate={true}
                  motionConfig="gentle"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 5: Top Genres + Library stats */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="border-white/10 bg-panel-surface">
          <CardHeader>
            <CardTitle className="text-sm">Top Genres</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              {(stats?.top_genres ?? []).length > 0 ? (
                <ResponsiveBar
                  data={stats!.top_genres.slice(0, 8).map((g) => ({ genre: g.name.length > 14 ? g.name.slice(0, 14) + "..." : g.name, tracks: g.count }))}
                  keys={["tracks"]}
                  indexBy="genre"
                  layout="horizontal"
                  margin={{ top: 5, right: 20, bottom: 5, left: 100 }}
                  padding={0.3}
                  colors={["#06b6d4"]}
                  borderRadius={3}
                  enableLabel={true}
                  labelTextColor="#fff"
                  theme={{
                    axis: { ticks: { text: { fill: "#9ca3af", fontSize: 11 } } },
                    grid: { line: { stroke: "var(--color-border)" } },
                    tooltip: { container: { background: "var(--color-card)", color: "var(--color-foreground)", borderRadius: "8px", fontSize: 12, border: "1px solid var(--color-border)" } },
                  }}
                  animate={true}
                  motionConfig="gentle"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No genre data</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-panel-surface">
          <CardHeader>
            <CardTitle className="text-sm">Library Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="flex justify-between rounded-md border border-white/6 bg-white/[0.04] px-3 py-2 text-sm">
                <span className="text-white/45">Total Duration</span>
                <span className="font-medium">{stats?.total_duration_hours ? `${stats.total_duration_hours}h` : "-"}</span>
              </div>
              <div className="flex justify-between rounded-md border border-white/6 bg-white/[0.04] px-3 py-2 text-sm">
                <span className="text-white/45">Avg Bitrate</span>
                <span className="font-medium">{stats?.avg_bitrate ? `${Math.round(stats.avg_bitrate / 1000)}k` : "-"}</span>
              </div>
              <div className="flex justify-between rounded-md border border-white/6 bg-white/[0.04] px-3 py-2 text-sm">
                <span className="text-white/45">Avg Album Duration</span>
                <span className="font-medium">{stats?.avg_album_duration_min ? `${stats.avg_album_duration_min} min` : "-"}</span>
              </div>
              <div className="flex justify-between rounded-md border border-white/6 bg-white/[0.04] px-3 py-2 text-sm">
                <span className="text-white/45">Avg Tracks/Album</span>
                <span className="font-medium">{stats?.avg_tracks_per_album ?? "-"}</span>
              </div>
              <div className="flex justify-between rounded-md border border-white/6 bg-white/[0.04] px-3 py-2 text-sm">
                <span className="text-white/45">Analyzed Tracks</span>
                <span className="font-medium">{formatNumber(stats?.analyzed_tracks ?? 0)}</span>
              </div>
              <div className="flex justify-between rounded-md border border-white/6 bg-white/[0.04] px-3 py-2 text-sm">
                <span className="text-white/45">Pending Tasks</span>
                <span className="font-medium">{stats?.pending_tasks ?? 0}</span>
              </div>
              <div className="flex gap-2 mt-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => navigate("/insights")}>
                  <ArrowRight size={14} className="mr-1" /> Insights
                </Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={() => navigate("/imports")}>
                  <ArrowRight size={14} className="mr-1" /> Imports
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

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
