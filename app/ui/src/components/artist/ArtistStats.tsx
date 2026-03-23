import { useApi } from "@/hooks/use-api";
import { encPath } from "@/lib/utils";
import { Loader2 } from "lucide-react";
// Badge available if needed for quality indicators
import { ResponsivePie } from "@nivo/pie";
import { ResponsiveBar } from "@nivo/bar";
import { ResponsiveRadar } from "@nivo/radar";

const NIVO_THEME = {
  axis: { ticks: { text: { fill: "#6b7280", fontSize: 11 } } },
  grid: { line: { stroke: "#374151" } },
  tooltip: { container: { background: "#1f2937", color: "#f3f4f6", borderRadius: "8px", fontSize: 12, border: "1px solid #374151" } },
  labels: { text: { fill: "#9ca3af", fontSize: 10 } },
};

interface ArtistStatsData {
  formats: { id: string; value: number }[];
  albums_timeline: { name: string; year: string; track_count: number; popularity: number | null; lastfm_listeners: number | null }[];
  audio_by_album: { album: string; avg_bpm: number | null; avg_energy: number | null; avg_danceability: number | null; avg_valence: number | null; avg_acousticness: number | null }[];
  top_tracks_by_popularity: { title: string; album: string; popularity: number; lastfm_listeners: number }[];
  genres: { name: string; weight: number }[];
}

export function ArtistStats({ name }: { name: string }) {
  const { data, loading } = useApi<ArtistStatsData>(`/api/artist-stats/${encPath(name)}`);

  if (loading) return <div className="py-8 text-center text-muted-foreground"><Loader2 size={18} className="animate-spin inline mr-2" />Loading stats...</div>;
  if (!data) return <div className="py-8 text-center text-muted-foreground">No stats available</div>;

  const radarData = data.audio_by_album.length > 0
    ? data.audio_by_album.map((a) => ({
        album: a.album.length > 15 ? a.album.slice(0, 15) + "..." : a.album,
        energy: a.avg_energy ?? 0,
        danceability: a.avg_danceability ?? 0,
        valence: a.avg_valence ?? 0,
        acousticness: a.avg_acousticness ?? 0,
      }))
    : [];

  return (
    <div className="space-y-6">
      {data.albums_timeline.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h4 className="text-sm font-semibold mb-3">Discography Timeline</h4>
          <div className="h-[200px]">
            <ResponsiveBar
              data={data.albums_timeline
                .filter(a => a.year)
                .map(a => ({
                  album: a.name.length > 18 ? a.name.slice(0, 18) + "..." : a.name,
                  tracks: a.track_count,
                  year: a.year,
                }))}
              keys={["tracks"]}
              indexBy="album"
              margin={{ top: 10, right: 10, bottom: 50, left: 40 }}
              padding={0.3}
              colors={["#8b5cf6"]}
              borderRadius={3}
              enableLabel={true}
              labelTextColor="#fff"
              axisBottom={{ tickRotation: -35 }}
              theme={NIVO_THEME}
              animate={true}
              motionConfig="gentle"
              tooltip={({ data: d }) => (
                <div style={{ background: "#1f2937", color: "#f3f4f6", padding: "6px 10px", borderRadius: "6px", fontSize: 11, border: "1px solid #374151" }}>
                  <strong>{String(d.album)}</strong> ({String(d.year)})<br />{String(d.tracks)} tracks
                </div>
              )}
            />
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.formats.length > 0 && (
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="text-sm font-semibold mb-3">Formats</h4>
            <div className="h-[180px]">
              <ResponsivePie
                data={data.formats}
                margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                innerRadius={0.6} padAngle={2} cornerRadius={4}
                colors={["#06b6d4", "#8b5cf6", "#f59e0b", "#ef4444"]}
                borderWidth={0} enableArcLinkLabels={true}
                arcLinkLabelsColor={{ from: "color" }} arcLinkLabelsTextColor="#9ca3af"
                arcLinkLabelsThickness={2} arcLabelsTextColor="#fff"
                theme={NIVO_THEME}
              />
            </div>
          </div>
        )}
        {data.genres.length > 0 && (
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="text-sm font-semibold mb-3">Genre Profile</h4>
            <div className="h-[180px]">
              <ResponsiveBar
                data={data.genres.map((g) => ({ genre: g.name.length > 14 ? g.name.slice(0, 14) + "..." : g.name, weight: Math.round(g.weight * 100) }))}
                keys={["weight"]} indexBy="genre" layout="horizontal"
                margin={{ top: 5, right: 20, bottom: 5, left: 100 }}
                padding={0.3} colors={["#06b6d4"]} borderRadius={3}
                enableLabel={true} labelTextColor="#fff"
                theme={NIVO_THEME} animate={true} motionConfig="gentle"
              />
            </div>
          </div>
        )}
      </div>

      {data.top_tracks_by_popularity.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h4 className="text-sm font-semibold mb-3">Most Popular Tracks</h4>
          <div className="h-[250px]">
            <ResponsiveBar
              data={data.top_tracks_by_popularity.slice(0, 10).reverse().map((t) => ({
                track: t.title.length > 20 ? t.title.slice(0, 20) + "..." : t.title,
                listeners: t.lastfm_listeners || t.popularity,
              }))}
              keys={["listeners"]} indexBy="track" layout="horizontal"
              margin={{ top: 5, right: 20, bottom: 5, left: 160 }}
              padding={0.3} colors={["#22c55e"]} borderRadius={3}
              enableLabel={true} labelTextColor="#fff"
              theme={NIVO_THEME} animate={true} motionConfig="gentle"
            />
          </div>
        </div>
      )}

      {radarData.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h4 className="text-sm font-semibold mb-3">Audio Profile by Album</h4>
          <div className="h-[300px]">
            <ResponsiveRadar
              data={radarData}
              keys={["energy", "danceability", "valence", "acousticness"]}
              indexBy="album"
              maxValue={1}
              margin={{ top: 30, right: 60, bottom: 30, left: 60 }}
              curve="linearClosed"
              gridLabelOffset={16}
              dotSize={8}
              dotColor={{ theme: "background" }}
              dotBorderWidth={2}
              colors={["#ef4444", "#06b6d4", "#f59e0b", "#22c55e"]}
              fillOpacity={0.2}
              theme={{ ...NIVO_THEME, labels: { text: { fill: "#9ca3af", fontSize: 11 } } }}
              animate={true} motionConfig="gentle"
              legends={[{ anchor: "top-left", direction: "column", itemWidth: 80, itemHeight: 20, symbolSize: 10, symbolShape: "circle" }]}
            />
          </div>
        </div>
      )}
      {(() => {
        const albumPop = data.albums_timeline
          .filter(a => (a.lastfm_listeners ?? 0) > 0 || (a.popularity ?? 0) > 0)
          .sort((a, b) => (b.lastfm_listeners ?? b.popularity ?? 0) - (a.lastfm_listeners ?? a.popularity ?? 0))
          .slice(0, 8);
        if (!albumPop.length) return null;
        return (
          <div className="bg-card border border-border rounded-lg p-4">
            <h4 className="text-sm font-semibold mb-3">Top Albums</h4>
            <div className="h-[200px]">
              <ResponsiveBar
                data={albumPop.reverse().map(a => ({
                  album: a.name.length > 20 ? a.name.slice(0, 20) + "..." : a.name,
                  listeners: a.lastfm_listeners ?? a.popularity ?? 0,
                }))}
                keys={["listeners"]}
                indexBy="album"
                layout="horizontal"
                margin={{ top: 5, right: 20, bottom: 5, left: 160 }}
                padding={0.3}
                colors={["#f59e0b"]}
                borderRadius={3}
                enableLabel={true}
                labelTextColor="#fff"
                theme={NIVO_THEME}
                animate={true}
                motionConfig="gentle"
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
