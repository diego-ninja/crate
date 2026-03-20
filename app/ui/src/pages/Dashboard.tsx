import { useEffect } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GridSkeleton } from "@/components/ui/grid-skeleton";
import { Badge } from "@/components/ui/badge";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { FormatDonut } from "@/components/charts/FormatDonut";
import { DecadeBar } from "@/components/charts/DecadeBar";
import { formatNumber, encPath } from "@/lib/utils";
import {
  Users, Disc3, Music, HardDrive, Loader2, ArrowRight,
  Play, RefreshCw, CheckCircle2, XCircle, Clock,
  Activity, Database, Radio, Eye, Cpu,
} from "lucide-react";
import { toast } from "sonner";
import { usePlayer } from "@/contexts/PlayerContext";

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
  recent_albums: { artist: string; name: string; year: string | null; updated_at: string }[];
  analyzed_tracks: number;
}

interface AnalyticsData {
  formats: Record<string, number>;
  decades: Record<string, number>;
  top_artists: { name: string; albums: number }[];
  computing?: boolean;
}

interface LiveActivity {
  running_tasks: { id: string; type: string; progress: string }[];
  recent_tasks: { id: string; type: string; status: string; updated_at: string }[];
  worker_slots: { max: number; active: number };
  systems: {
    postgres: boolean;
    navidrome: boolean;
    watcher: boolean;
  };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function Dashboard() {
  const { data: stats, loading: loadingStats } = useApi<Stats>("/api/stats");
  const { data: analytics, loading: loadingAnalytics, refetch: refetchAnalytics } = useApi<AnalyticsData>("/api/analytics");
  const { data: live, refetch: refetchLive } = useApi<LiveActivity>("/api/activity/live");
  const { recentlyPlayed, play: playTrack } = usePlayer();
  const navigate = useNavigate();

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
        <div className="grid grid-cols-4 gap-4 mb-8">
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

  const heroStats = [
    {
      label: "Artists",
      value: formatNumber(stats?.artists ?? 0),
      icon: Users,
      color: "border-l-cyan-500",
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
      <div className="grid grid-cols-4 gap-4 mb-8">
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
      <div className="grid grid-cols-3 gap-4 mb-8">
        <Card className="bg-card col-span-2">
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
                  <Radio size={14} className="text-muted-foreground" />
                  <span>Navidrome</span>
                </div>
                <div className={`w-2 h-2 rounded-full ${systems?.navidrome ? "bg-green-500" : "bg-red-500"}`} />
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
              </div>
            </div>
          </CardContent>
        </Card>
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
                  onClick={() => navigate(`/album/${encPath(album.artist)}/${encPath(album.name)}`)}
                  className="flex-shrink-0 w-[140px] group text-left"
                >
                  <div className="relative w-[140px] h-[140px] rounded-lg overflow-hidden bg-secondary mb-2">
                    <img
                      src={`/api/cover/${encPath(album.artist)}/${encPath(album.name)}`}
                      alt={album.name}
                      loading="lazy"
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center -z-10">
                      <Disc3 size={28} className="text-primary/40" />
                    </div>
                  </div>
                  <div className="text-xs font-medium truncate">{album.name}</div>
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

      {/* Recently Played */}
      {recentlyPlayed.length > 0 && (
        <Card className="bg-card mb-8">
          <CardHeader>
            <CardTitle className="text-sm">Recently Played</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {recentlyPlayed.map((track) => (
                <button
                  key={track.id}
                  onClick={() => playTrack(track)}
                  className="flex-shrink-0 w-[120px] group text-left"
                >
                  <div className="relative w-[120px] h-[120px] rounded-lg overflow-hidden bg-secondary mb-2">
                    {track.albumCover ? (
                      <img
                        src={track.albumCover}
                        alt={track.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
                        <Music size={24} className="text-primary/50" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <Play size={24} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" fill="white" />
                    </div>
                  </div>
                  <div className="text-xs font-medium truncate">{track.title}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{track.artist}</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Row 4: Format donut + Decade bar */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <Card className="bg-card col-span-1">
          <CardHeader>
            <CardTitle className="text-sm">Format Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics?.formats && Object.keys(analytics.formats).length > 0 ? (
              <FormatDonut data={analytics.formats} />
            ) : stats?.formats && Object.keys(stats.formats).length > 0 ? (
              <FormatDonut data={stats.formats} />
            ) : (
              <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                <Loader2 size={18} className="animate-spin mr-2" />
                <span className="text-sm">{analytics?.computing ? "Computing analytics..." : loadingAnalytics ? "Loading..." : "No data"}</span>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="bg-card col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Albums by Decade</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics?.decades && Object.keys(analytics.decades).length > 0 ? (
              <DecadeBar data={analytics.decades} />
            ) : (
              <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                <Loader2 size={18} className="animate-spin mr-2" />
                <span className="text-sm">{analytics?.computing ? "Computing analytics..." : loadingAnalytics ? "Loading..." : "No data"}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 5: Extra stats + Import Queue */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-sm">Library Insights</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Duration</span>
                <span>{stats?.total_duration_hours ? `${stats.total_duration_hours}h` : "-"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Avg Bitrate</span>
                <span>{stats?.avg_bitrate ? `${Math.round(stats.avg_bitrate / 1000)}k` : "-"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Analyzed Tracks</span>
                <span>{formatNumber(stats?.analyzed_tracks ?? 0)}</span>
              </div>
              {(stats?.top_genres ?? []).length > 0 && (
                <div className="border-t border-border pt-3 mt-1">
                  <div className="text-xs text-muted-foreground mb-2">Top Genres</div>
                  <div className="flex flex-wrap gap-1.5">
                    {stats!.top_genres.slice(0, 8).map((g) => (
                      <Badge key={g.name} variant="secondary" className="text-[10px]">
                        {g.name} ({g.count})
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-sm">Import Queue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Pending Imports</span>
                <span>{stats?.pending_imports ?? 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Pending Tasks</span>
                <span>{stats?.pending_tasks ?? 0}</span>
              </div>
              <Button
                className="mt-2"
                variant="outline"
                onClick={() => navigate("/imports")}
              >
                <ArrowRight size={14} className="mr-2" />
                Go to Imports
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
