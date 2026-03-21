import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GridSkeleton } from "@/components/ui/grid-skeleton";
import { useApi } from "@/hooks/use-api";
import { formatNumber } from "@/lib/utils";
import { BarChart3, Globe, Music, Disc3, Users, Zap, CheckCircle2 } from "lucide-react";
import { ResponsiveBar } from "@nivo/bar";
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveRadar } from "@nivo/radar";
import { Network } from "@nivo/network";

interface InsightsData {
  countries: Record<string, number>;
  formation_decades: Record<string, number>;
  bpm_distribution: { bpm: string; count: number }[];
  keys: { key: string; count: number }[];
  energy_danceability: { x: number; y: number; artist: string; title: string }[];
  formats: { id: string; value: number }[];
  bitrates: { id: string; value: number }[];
  top_genres: { genre: string; artists: number; albums: number }[];
  network: { nodes: { id: string }[]; links: { source: string; target: string }[] };
  popularity: { artist: string; popularity: number; listeners: number }[];
  albums_by_decade: Record<string, number>;
  completeness: {
    artists_total: number; artists_with_photo: number; artists_enriched: number;
    albums_total: number; albums_with_cover: number;
    tracks_total: number; tracks_analyzed: number;
  };
}

const NIVO_THEME = {
  text: { fill: "#9ca3af" },
  axis: { ticks: { text: { fill: "#6b7280", fontSize: 11 } }, legend: { text: { fill: "#9ca3af" } } },
  grid: { line: { stroke: "#374151", strokeWidth: 1 } },
  tooltip: { container: { background: "#1f2937", color: "#f3f4f6", borderRadius: "8px", fontSize: 12, border: "1px solid #374151" } },
  labels: { text: { fill: "#f3f4f6", fontSize: 11 } },
  legends: { text: { fill: "#9ca3af", fontSize: 11 } },
};

const COLORS = ["#06b6d4", "#8b5cf6", "#f59e0b", "#ef4444", "#22c55e", "#ec4899", "#3b82f6", "#14b8a6", "#f97316", "#a78bfa"];

function ProgressStat({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span>{formatNumber(value)} / {formatNumber(total)} ({pct}%)</span>
      </div>
      <div className="h-2 bg-secondary rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Insights() {
  const { data, loading } = useApi<InsightsData>("/api/insights");

  const decadeData = useMemo(() => {
    if (!data?.albums_by_decade) return [];
    return Object.entries(data.albums_by_decade)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([decade, count]) => ({ decade, albums: count }));
  }, [data?.albums_by_decade]);

  const formationData = useMemo(() => {
    if (!data?.formation_decades) return [];
    return Object.entries(data.formation_decades)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([decade, count]) => ({ decade, bands: count }));
  }, [data?.formation_decades]);

  const genreRadar = useMemo(() => {
    if (!data?.top_genres) return [];
    return data.top_genres.slice(0, 10).map((g) => ({
      genre: g.genre.length > 12 ? g.genre.slice(0, 12) + "..." : g.genre,
      artists: g.artists,
      albums: g.albums,
    }));
  }, [data?.top_genres]);

  const countryData = useMemo(() => {
    if (!data?.countries) return [];
    return Object.entries(data.countries)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15)
      .map(([country, count]) => ({ country, artists: count }));
  }, [data?.countries]);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-3">
          <BarChart3 size={24} className="text-primary" /> Insights
        </h1>
        <GridSkeleton count={6} columns="grid-cols-2" />
      </div>
    );
  }

  if (!data) {
    return <div className="text-center py-12 text-muted-foreground">No data available</div>;
  }

  const c = data.completeness;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-3">
        <BarChart3 size={24} className="text-primary" /> Insights
      </h1>

      {/* Row 1: Completeness + Formats + Bitrates */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="bg-card">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><CheckCircle2 size={14} /> Library Completeness</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <ProgressStat label="Artist Photos" value={c.artists_with_photo} total={c.artists_total} />
            <ProgressStat label="Enriched" value={c.artists_enriched} total={c.artists_total} />
            <ProgressStat label="Album Covers" value={c.albums_with_cover} total={c.albums_total} />
            <ProgressStat label="Audio Analyzed" value={c.tracks_analyzed} total={c.tracks_total} />
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Disc3 size={14} /> Formats</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[200px]">
              {data.formats.length > 0 ? (
                <ResponsivePie
                  data={data.formats}
                  margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                  innerRadius={0.55}
                  padAngle={2}
                  cornerRadius={4}
                  colors={COLORS}
                  borderWidth={0}
                  enableArcLinkLabels={true}
                  arcLinkLabelsColor={{ from: "color" }}
                  arcLinkLabelsTextColor="#9ca3af"
                  arcLinkLabelsThickness={2}
                  arcLabelsTextColor="#fff"
                  theme={NIVO_THEME}
                />
              ) : <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data</div>}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Music size={14} /> Bitrate Quality</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[200px]">
              {data.bitrates.length > 0 ? (
                <ResponsivePie
                  data={data.bitrates}
                  margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                  innerRadius={0.55}
                  padAngle={2}
                  cornerRadius={4}
                  colors={COLORS.slice(3)}
                  borderWidth={0}
                  enableArcLinkLabels={true}
                  arcLinkLabelsColor={{ from: "color" }}
                  arcLinkLabelsTextColor="#9ca3af"
                  arcLinkLabelsThickness={2}
                  arcLabelsTextColor="#fff"
                  theme={NIVO_THEME}
                />
              ) : <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data</div>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Albums by Decade + Countries */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card className="bg-card">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Disc3 size={14} /> Albums by Decade</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {decadeData.length > 0 ? (
                <ResponsiveBar
                  data={decadeData}
                  keys={["albums"]}
                  indexBy="decade"
                  margin={{ top: 10, right: 10, bottom: 40, left: 40 }}
                  padding={0.3}
                  colors={["#06b6d4"]}
                  borderRadius={4}
                  axisBottom={{ tickRotation: -45 }}
                  enableLabel={false}
                  theme={NIVO_THEME}
                  animate={true}
                  motionConfig="gentle"
                />
              ) : <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No data</div>}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Globe size={14} /> Artists by Country</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {countryData.length > 0 ? (
                <ResponsiveBar
                  data={countryData}
                  keys={["artists"]}
                  indexBy="country"
                  layout="horizontal"
                  margin={{ top: 10, right: 20, bottom: 10, left: 60 }}
                  padding={0.3}
                  colors={["#8b5cf6"]}
                  borderRadius={4}
                  enableLabel={true}
                  labelTextColor="#fff"
                  theme={NIVO_THEME}
                  animate={true}
                  motionConfig="gentle"
                />
              ) : <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No country data — enrich artists first</div>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Genre Radar + Popularity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card className="bg-card">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Zap size={14} /> Genre Radar</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {genreRadar.length > 0 ? (
                <ResponsiveRadar
                  data={genreRadar}
                  keys={["artists", "albums"]}
                  indexBy="genre"
                  maxValue="auto"
                  margin={{ top: 30, right: 60, bottom: 30, left: 60 }}
                  curve="linearClosed"
                  borderColor={{ from: "color" }}
                  gridLabelOffset={16}
                  dotSize={8}
                  dotColor={{ theme: "background" }}
                  dotBorderWidth={2}
                  colors={["#06b6d4", "#8b5cf6"]}
                  fillOpacity={0.25}
                  blendMode="normal"
                  theme={NIVO_THEME}
                  animate={true}
                  motionConfig="gentle"
                  legends={[{ anchor: "top-left", direction: "column", itemWidth: 80, itemHeight: 20, symbolSize: 10, symbolShape: "circle" }]}
                />
              ) : <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No genre data</div>}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Users size={14} /> Artist Popularity</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {data.popularity.length > 0 ? (
                <ResponsiveBar
                  data={data.popularity}
                  keys={["popularity"]}
                  indexBy="artist"
                  layout="horizontal"
                  margin={{ top: 10, right: 20, bottom: 10, left: 120 }}
                  padding={0.3}
                  colors={["#22c55e"]}
                  borderRadius={4}
                  enableLabel={true}
                  labelTextColor="#fff"
                  theme={NIVO_THEME}
                  animate={true}
                  motionConfig="gentle"
                />
              ) : <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No Spotify data</div>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 4: Band Formation + BPM */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card className="bg-card">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Users size={14} /> Band Formation by Decade</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[250px]">
              {formationData.length > 0 ? (
                <ResponsiveBar
                  data={formationData}
                  keys={["bands"]}
                  indexBy="decade"
                  margin={{ top: 10, right: 10, bottom: 40, left: 40 }}
                  padding={0.3}
                  colors={["#f59e0b"]}
                  borderRadius={4}
                  enableLabel={false}
                  theme={NIVO_THEME}
                  animate={true}
                  motionConfig="gentle"
                />
              ) : <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No formation data</div>}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Music size={14} /> BPM Distribution</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[250px]">
              {data.bpm_distribution.length > 0 ? (
                <ResponsiveBar
                  data={data.bpm_distribution}
                  keys={["count"]}
                  indexBy="bpm"
                  margin={{ top: 10, right: 10, bottom: 40, left: 40 }}
                  padding={0.2}
                  colors={["#ef4444"]}
                  borderRadius={3}
                  enableLabel={false}
                  axisBottom={{ tickRotation: -45 }}
                  theme={NIVO_THEME}
                  animate={true}
                  motionConfig="gentle"
                />
              ) : <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No BPM data — analyze tracks first</div>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 5: Keys + Artist Network */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card className="bg-card">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Music size={14} /> Key Distribution</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {data.keys.length > 0 ? (
                <ResponsivePie
                  data={data.keys.slice(0, 12).map((k) => ({ id: k.key, value: k.count }))}
                  margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                  innerRadius={0.4}
                  padAngle={1}
                  cornerRadius={3}
                  colors={COLORS}
                  borderWidth={0}
                  enableArcLinkLabels={true}
                  arcLinkLabelsColor={{ from: "color" }}
                  arcLinkLabelsTextColor="#9ca3af"
                  arcLinkLabelsThickness={2}
                  arcLabelsTextColor="#fff"
                  theme={NIVO_THEME}
                />
              ) : <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No key data</div>}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Users size={14} /> Artist Network</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {data.network.nodes.length > 0 ? (
                <Network
                  data={data.network}
                  width={500}
                  height={280}
                  margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                  repulsivity={300}
                  iterations={120}
                  linkDistance={60}
                  centeringStrength={0.5}
                  nodeSize={(n: { id: string }) => {
                    const connections = data.network.links.filter((l) => l.source === n.id || l.target === n.id).length;
                    return connections * 4 + 10;
                  }}
                  nodeColor={(n: { id: string }) => {
                    const isSource = data.network.links.some((l) => l.source === n.id);
                    return isSource ? "#06b6d4" : "#6b7280";
                  }}
                  nodeBorderWidth={2}
                  nodeBorderColor={{ from: "color", modifiers: [["darker", 0.6]] }}
                  linkThickness={1.5}
                  linkColor="#4b5563"
                  animate={true}
                  motionConfig="gentle"
                />
              ) : <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No similar artist data</div>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
