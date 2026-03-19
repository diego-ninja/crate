import { useEffect } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { GridSkeleton } from "@/components/ui/grid-skeleton";
import { useApi } from "@/hooks/use-api";
import { FormatDonut } from "@/components/charts/FormatDonut";
import { DecadeBar } from "@/components/charts/DecadeBar";
import { formatNumber, encPath } from "@/lib/utils";
import { Users, Disc3, Music, HardDrive, Loader2, ArrowRight, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
}

interface AnalyticsData {
  formats: Record<string, number>;
  decades: Record<string, number>;
  top_artists: { name: string; albums: number }[];
}

interface ActivityData {
  tasks: { id: string; type: string; status: string; created_at: string; updated_at: string }[];
  pending_imports: number;
  last_scan: string | null;
}

interface Status {
  scanning: boolean;
  last_scan: string | null;
  issue_count: number;
  progress: string;
}

export function Dashboard() {
  const { data: stats, loading: loadingStats } = useApi<Stats>("/api/stats");
  const { data: status } = useApi<Status>("/api/status");
  const { data: analytics, loading: loadingAnalytics, refetch: refetchAnalytics } = useApi<AnalyticsData & { computing?: boolean }>("/api/analytics");
  const { data: activity } = useApi<ActivityData>("/api/activity/recent");
  const { recentlyPlayed, play: playTrack } = usePlayer();
  const navigate = useNavigate();

  // Auto-retry analytics if computing in background
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
      color: "border-l-violet-500",
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

  const topArtists = analytics?.top_artists ?? [];
  const recentTasks = activity?.tasks ?? [];

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

      {/* Row 2: Format donut + Decade bar */}
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

      {/* Row 3: Top 10 Artists + Recent Activity */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-sm">Top Artists</CardTitle>
          </CardHeader>
          <CardContent>
            {topArtists.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artist</TableHead>
                    <TableHead className="text-right">Albums</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topArtists.slice(0, 10).map((a) => (
                    <TableRow key={a.name}>
                      <TableCell>
                        <button
                          onClick={() => navigate(`/artist/${encPath(a.name)}`)}
                          className="text-primary hover:underline text-sm"
                        >
                          {a.name}
                        </button>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {a.albums}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : loadingAnalytics ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-8">
                No data
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-sm">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {recentTasks.length > 0 ? (
              <div className="flex flex-col gap-3">
                {recentTasks.map((t) => (
                  <div key={t.id} className="flex items-start gap-3 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-foreground flex items-center gap-2">
                        <span className="capitalize">{t.type.replace(/_/g, " ")}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1 py-0 ${
                            t.status === "completed"
                              ? "text-green-500 border-green-500/30"
                              : t.status === "running"
                                ? "text-blue-500 border-blue-500/30"
                                : t.status === "failed"
                                  ? "text-red-500 border-red-500/30"
                                  : "text-muted-foreground"
                          }`}
                        >
                          {t.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(t.updated_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-8">
                No recent activity
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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

      {/* Row 4: Library Health + Import Queue */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-sm">Library Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Last Scan</span>
                <span>
                  {status?.last_scan ?? stats?.last_scan
                    ? new Date((status?.last_scan ?? stats?.last_scan)!).toLocaleString()
                    : "Never"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Issues</span>
                <span className={status?.issue_count ? "text-orange-500" : "text-green-500"}>
                  {status?.issue_count ?? 0}
                </span>
              </div>
              {status?.scanning && (
                <div className="flex items-center gap-2 text-sm text-blue-500">
                  <Loader2 size={14} className="animate-spin" />
                  <span>Scan in progress...</span>
                </div>
              )}
              <Button
                className="mt-2"
                variant="outline"
                onClick={() => navigate("/health")}
              >
                <ArrowRight size={14} className="mr-2" />
                Go to Health Scan
              </Button>
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
                <span>{stats?.pending_imports ?? activity?.pending_imports ?? 0}</span>
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
