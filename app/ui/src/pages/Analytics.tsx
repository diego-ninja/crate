import { useNavigate } from "react-router";
import { useApi } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { FormatDonut } from "@/components/charts/FormatDonut";
import { DecadeBar } from "@/components/charts/DecadeBar";
import { BitrateChart } from "@/components/charts/BitrateChart";
import { encPath, formatNumber } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface AnalyticsData {
  total_duration_hours: number;
  avg_tracks_per_album: number;
  formats: Record<string, number>;
  bitrates: Record<string, number>;
  decades: Record<string, number>;
  genres: Record<string, number>;
  sizes_by_format_gb: Record<string, number>;
  top_artists: { name: string; albums: number }[];
}

export function Analytics() {
  const { data, loading } = useApi<AnalyticsData>("/api/analytics");
  const navigate = useNavigate();

  if (loading) {
    return (
      <div>
        <h2 className="font-semibold mb-4">Library Analytics</h2>
        <div className="grid grid-cols-2 gap-4 mb-8">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 gap-8 mb-8">
          <Skeleton className="h-[300px] rounded-lg" />
          <Skeleton className="h-[300px] rounded-lg" />
          <Skeleton className="h-[300px] rounded-lg" />
          <Skeleton className="h-[300px] rounded-lg" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div>
      <h2 className="font-semibold mb-4">Library Analytics</h2>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <Card className="bg-card">
          <CardContent className="pt-6 text-center">
            <div className="text-2xl font-bold">{data.total_duration_hours}h</div>
            <div className="text-xs text-muted-foreground mt-1">
              Total Playtime
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="pt-6 text-center">
            <div className="text-2xl font-bold">
              {data.avg_tracks_per_album}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Avg Tracks/Album
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-8 mb-8">
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-sm">By Format</CardTitle>
          </CardHeader>
          <CardContent>
            <FormatDonut data={data.formats} />
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-sm">By Bitrate</CardTitle>
          </CardHeader>
          <CardContent>
            <BitrateChart data={data.bitrates} />
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-sm">By Decade</CardTitle>
          </CardHeader>
          <CardContent>
            <DecadeBar data={data.decades} />
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardHeader>
            <CardTitle className="text-sm">Top Genres</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList data={data.genres} color="#f97316" />
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card mb-8">
        <CardHeader>
          <CardTitle className="text-sm">Storage by Format</CardTitle>
        </CardHeader>
        <CardContent>
          <BarList data={data.sizes_by_format_gb} suffix=" GB" />
        </CardContent>
      </Card>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-sm">
            Top Artists (by album count)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Artist</TableHead>
                <TableHead>Albums</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.top_artists.map((a) => (
                <TableRow key={a.name}>
                  <TableCell>
                    <button
                      onClick={() =>
                        navigate(`/artist/${encPath(a.name)}`)
                      }
                      className="text-primary hover:underline"
                    >
                      {a.name}
                    </button>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.albums}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function BarList({
  data,
  color = "#88c0d0",
  suffix = "",
}: {
  data: Record<string, number>;
  color?: string;
  suffix?: string;
}) {
  const entries = Object.entries(data);
  if (!entries.length)
    return <div className="text-muted-foreground text-sm">No data</div>;
  const max = Math.max(...entries.map(([, v]) => v));

  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([k, v]) => {
        const pct = max > 0 ? (v / max) * 100 : 0;
        return (
          <div key={k} className="flex items-center gap-2 text-sm">
            <div className="w-[120px] text-right text-muted-foreground truncate flex-shrink-0">
              {k}
            </div>
            <div className="flex-1 bg-secondary rounded h-5 overflow-hidden">
              <div
                className="h-full rounded"
                style={{
                  width: `${pct}%`,
                  background: color,
                  minWidth: 2,
                }}
              />
            </div>
            <div className="w-[60px] text-xs text-muted-foreground">
              {formatNumber(v)}
              {suffix}
            </div>
          </div>
        );
      })}
    </div>
  );
}
