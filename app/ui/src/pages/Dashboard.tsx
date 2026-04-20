import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GridSkeleton } from "@/components/ui/grid-skeleton";
import { Badge } from "@/components/ui/badge";
import { useApi } from "@/hooks/use-api";
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
import { ErrorState } from "@/components/ui/error-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Stats {
  artists: number;
  albums: number;
  tracks: number;
  total_size_gb: number;
  formats: Record<string, number>;
  last_scan: string | null;
  pending_imports: number;
  pending_tasks: number;
  total_duration_hours: number;
  avg_bitrate: number;
  top_genres: { name: string; count: number }[];
  recent_albums: { id?: number; slug?: string; artist: string; artist_id?: number; artist_slug?: string; name: string; display_name?: string; year: string | null; updated_at: string }[];
  analyzed_tracks: number;
  avg_album_duration_min?: number;
  avg_tracks_per_album?: number;
}

interface AnalyticsData {
  formats: Record<string, number>;
  decades: Record<string, number>;
  top_artists: { id?: number; slug?: string; name: string; albums: number }[];
  computing?: boolean;
}

interface LiveActivity {
  running_tasks: { id: string; type: string; progress: string }[];
  recent_tasks: { id: string; type: string; status: string; updated_at: string }[];
  worker_slots: { max: number; active: number };
  systems: {
    postgres: boolean;
    watcher: boolean;
  };
}


export function Dashboard() {
  const { data: stats, loading: loadingStats, error: statsError, refetch: refetchStats } = useApi<Stats>("/api/stats");
  const { data: analytics, refetch: refetchAnalytics } = useApi<AnalyticsData>("/api/analytics");
  const { data: live, refetch: refetchLive } = useApi<LiveActivity>("/api/activity/live");
  const [healthCounts, setHealthCounts] = useState<Record<string, number>>({});
  const [upcomingShows, setUpcomingShows] = useState<{ artist_name?: string; venue: string; city: string; country: string; date: string; url: string }[]>([]);

  useEffect(() => {
    api<{ counts: Record<string, number> }>("/api/manage/health-issues").then((d) => setHealthCounts(d.counts || {})).catch(() => {});
    api<{ events: typeof upcomingShows }>("/api/shows/cached?limit=5").then((d) => setUpcomingShows(d.events || [])).catch(() => {});
  }, []);
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);

  // Auto-refresh live activity every 5s
  useEffect(() => {
    const timer = setInterval(() => refetchLive(), 5000);
    return () => clearInterval(timer);
  }, [refetchLive]);

  // Auto-retry analytics if computing
  useEffect(() => {
    if (analytics?.computing) {
      const timer = setTimeout(() => refetchAnalytics(), 10000);
      return () => clearTimeout(timer);
    }
  }, [analytics, refetchAnalytics]);

  if (loadingStats) {
    return (
      <div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="bg-card border border-border rounded-lg p-6">
              <GridSkeleton count={1} columns="grid-cols-1" />
            </div>
          ))}
        </div>
        <GridSkeleton count={2} columns="grid-cols-2" />
      </div>
    );
  }

  if (statsError) {
    return <ErrorState message="Failed to load dashboard" onRetry={refetchStats} />;
  }

  const heroStats = [
    {
      label: "Artists",
      value: formatNumber(stats?.artists ?? 0),
      icon: Users,
      color: "border-l-primary",
    },
    {
      label: "Albums",
      value: formatNumber(stats?.albums ?? 0),
      icon: Disc3,
      color: "border-l-blue-500",
    },
    {
      label: "Tracks",
      value: formatNumber(stats?.tracks ?? 0),
      icon: Music,
      color: "border-l-green-500",
    },
    {
      label: "Library Size",
      value: stats?.total_size_gb ? `${stats.total_size_gb} GB` : "0 GB",
      icon: HardDrive,
      color: "border-l-orange-500",
    },
  ];

  const recentAlbums = stats?.recent_albums ?? [];
  const runningTasks = live?.running_tasks ?? [];
  const recentTasks = live?.recent_tasks ?? [];
  const systems = live?.systems;
  const workerSlots = live?.worker_slots;

  return (
    <div>
      {/* Row 1: Hero stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
        {heroStats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className={`bg-card border-l-4 ${s.color}`}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold text-foreground">{s.value}</div>
                    <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                  </div>
                  <Icon size={24} className="text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Row 2: Live Activity Feed + System Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card className="bg-card col-span-1 md:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity size={14} />
                Live Activity
              </CardTitle>
              {runningTasks.length > 0 && (
                <Badge variant="outline" className="text-blue-500 border-blue-500/30 text-[10px]">
                  {runningTasks.length} running
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
              {runningTasks.map((t) => (
                <div key={t.id} className="flex items-center gap-3 text-sm py-1.5 px-2 rounded bg-blue-500/5 border border-blue-500/10">
                  <Loader2 size={14} className="animate-spin text-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-foreground capitalize">{t.type.replace(/_/g, " ")}</span>
                    {t.progress && (
                      <span className="text-muted-foreground ml-2">({t.progress})</span>
                    )}
                  </div>
                  <Badge variant="outline" className="text-blue-500 border-blue-500/30 text-[10px] px-1 py-0">
                    running
                  </Badge>
                </div>
              ))}
              {recentTasks.filter(t => t.status !== "running").map((t) => (
                <div key={t.id} className="flex items-center gap-3 text-sm py-1.5 px-2">
                  {t.status === "completed" ? (
                    <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                  ) : t.status === "failed" ? (
                    <XCircle size={14} className="text-red-500 flex-shrink-0" />
                  ) : (
                    <Clock size={14} className="text-muted-foreground flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="text-foreground capitalize">{t.type.replace(/_/g, " ")}</span>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1 py-0 ${
                      t.status === "completed"
                        ? "text-green-500 border-green-500/30"
                        : t.status === "failed"
                          ? "text-red-500 border-red-500/30"
                          : "text-muted-foreground"
                    }`}
                  >
                    {t.status}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground flex-shrink-0">
                    {timeAgo(t.updated_at)}
                  </span>
                </div>
              ))}
              {recentTasks.length === 0 && runningTasks.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-8">
                  No recent activity
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-sm">System Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Database size={14} className="text-muted-foreground" />
                  <span>PostgreSQL</span>
                </div>
                <div className={`w-2 h-2 rounded-full ${systems?.postgres ? "bg-green-500" : "bg-red-500"}`} />
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Cpu size={14} className="text-muted-foreground" />
                  <span>Worker</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {workerSlots ? `${workerSlots.active}/${workerSlots.max} slots` : "-"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Eye size={14} className="text-muted-foreground" />
                  <span>Watcher</span>
                </div>
                <div className={`w-2 h-2 rounded-full ${systems?.watcher ? "bg-green-500" : "bg-red-500"}`} />
              </div>

              <div className="border-t border-border pt-3 mt-1 flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={async () => {
                    try {
                      await api("/api/tasks/sync-library", "POST");
                      toast.success("Library sync started");
                      refetchLive();
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {/* Health summary */}
        {Object.keys(healthCounts).length > 0 && (
          <Link to="/health" className="block">
            <Card className="bg-card hover:bg-white/5 transition-colors h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Stethoscope size={14} className="text-yellow-500" />
                  Library Health
                  <Badge variant="outline" className="text-yellow-500 border-yellow-500/30 ml-auto">
                    {Object.values(healthCounts).reduce((a, b) => a + b, 0)} issues
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(healthCounts).sort(([, a], [, b]) => b - a).slice(0, 5).map(([type, count]) => (
                    <Badge key={type} variant="secondary" className="text-[10px]">
                      {type.replace(/_/g, " ")} ({count})
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </Link>
        )}

        {/* Upcoming shows */}
        {upcomingShows.length > 0 && (
          <Link to="/upcoming" className="block">
            <Card className="bg-card hover:bg-white/5 transition-colors h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <CalendarDays size={14} className="text-orange-500" />
                  Upcoming Shows
                  <Badge variant="outline" className="text-orange-500 border-orange-500/30 ml-auto">
                    {upcomingShows.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {upcomingShows.slice(0, 3).map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="font-medium truncate">{s.artist_name}</span>
                      <span className="text-muted-foreground truncate">{s.venue}, {s.city}</span>
                      <span className="text-muted-foreground ml-auto flex-shrink-0">
                        {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </Link>
        )}
      </div>

      {/* Row 3: Recent Albums */}
      {recentAlbums.length > 0 && (
        <Card className="bg-card mb-8">
          <CardHeader>
            <CardTitle className="text-sm">Recently Added Albums</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {recentAlbums.map((album, i) => (
                <button
                  key={`${album.artist}-${album.name}-${i}`}
                  onClick={() => navigate(albumPagePath({ albumId: album.id, albumSlug: album.slug }))}
                  className="flex-shrink-0 w-[140px] group text-left"
                >
                  <div className="relative w-[140px] h-[140px] rounded-lg overflow-hidden bg-secondary mb-2">
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
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <ArrowRight size={20} className="text-white" />
                    </div>
                  </div>
                  <div className="text-xs font-medium truncate">{album.display_name || album.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{album.artist}</div>
                  {album.year && (
                    <div className="text-[10px] text-muted-foreground">{album.year}</div>
                  )}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Row 4: Format donut + Decade bar (Nivo) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card className="bg-card col-span-1">
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
        <Card className="bg-card col-span-1 md:col-span-2">
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <Card className="bg-card">
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

        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-sm">Library Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Duration</span>
                <span className="font-medium">{stats?.total_duration_hours ? `${stats.total_duration_hours}h` : "-"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Avg Bitrate</span>
                <span className="font-medium">{stats?.avg_bitrate ? `${Math.round(stats.avg_bitrate / 1000)}k` : "-"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Avg Album Duration</span>
                <span className="font-medium">{stats?.avg_album_duration_min ? `${stats.avg_album_duration_min} min` : "-"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Avg Tracks/Album</span>
                <span className="font-medium">{stats?.avg_tracks_per_album ?? "-"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Analyzed Tracks</span>
                <span className="font-medium">{formatNumber(stats?.analyzed_tracks ?? 0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Pending Tasks</span>
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
            refetchLive();
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
            refetchLive();
          } catch {
            toast.error("Failed to wipe database");
          }
        }}
      />
    </div>
  );
}
