import { ResponsiveRadar } from "@nivo/radar";
import { ResponsiveBar } from "@nivo/bar";
import { Badge } from "@/components/ui/badge";
import { Music, Gauge, Key, Volume2 } from "lucide-react";
import type { AudioAnalysisTrack } from "@/components/album/TrackTable";

interface AudioProfileCardProps {
  analysisData: Record<string, AudioAnalysisTrack>;
}

function avg(values: (number | null | undefined)[]): number {
  const valid = values.filter((v): v is number => v != null);
  return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
}

function dominantKey(tracks: AudioAnalysisTrack[]): string | null {
  const counts: Record<string, number> = {};
  for (const t of tracks) {
    if (t.key) {
      const label = `${t.key}${t.scale ? ` ${t.scale === "major" ? "maj" : "min"}` : ""}`;
      counts[label] = (counts[label] || 0) + 1;
    }
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? null;
}

const NIVO_THEME = {
  axis: { ticks: { text: { fill: "#6b7280", fontSize: 11 } } },
  grid: { line: { stroke: "var(--color-border)" } },
  tooltip: { container: { background: "var(--color-card)", color: "var(--color-foreground)", borderRadius: "8px", fontSize: 12, border: "1px solid var(--color-border)" } },
  labels: { text: { fill: "#9ca3af", fontSize: 10 } },
};

const PRIMARY_COLOR = "#06b6d4";

export function AudioProfileCard({ analysisData }: AudioProfileCardProps) {
  const tracks = Object.values(analysisData);
  const withData = tracks.filter((t) => t.tempo != null || t.energy != null);
  if (withData.length === 0) return null;

  const features = {
    Danceability: avg(tracks.map((t) => t.danceability)),
    Valence: avg(tracks.map((t) => t.valence)),
    Acousticness: avg(tracks.map((t) => t.acousticness)),
    Energy: avg(tracks.map((t) => t.energy)),
    Complexity: avg(tracks.map((t) => t.spectral_complexity)),
    Instrumental: avg(tracks.map((t) => t.instrumentalness)),
  };

  const radarDataFormatted = Object.entries(features).map(([feature, value]) => ({
    feature,
    value: Math.round(value * 100),
  }));

  const barData = Object.entries(features)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value: Math.round(value * 100) }));

  const hasRadarData = radarDataFormatted.some((d) => d.value > 0);

  const avgBpm = avg(tracks.map((t) => t.tempo));
  const key = dominantKey(tracks);
  const avgLoudness = avg(tracks.map((t) => t.loudness));
  const avgEnergy = avg(tracks.map((t) => t.energy));

  const moodSums: Record<string, number> = {};
  let moodCount = 0;
  for (const t of tracks) {
    if (t.mood) {
      moodCount++;
      for (const [m, v] of Object.entries(t.mood)) {
        moodSums[m] = (moodSums[m] || 0) + v;
      }
    }
  }
  const topMoods = moodCount > 0
    ? Object.entries(moodSums)
        .map(([m, v]) => [m, v / moodCount] as [string, number])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
    : [];

  return (
    <div className="mb-8 rounded-xl border border-border bg-card/50 backdrop-blur-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Music size={14} className="text-primary" />
          Audio Profile
        </h4>
        <span className="text-xs text-muted-foreground">{withData.length} tracks analyzed</span>
      </div>

      <div className="p-5">
        <div className="flex flex-col md:flex-row gap-6 items-start">
          <div className="grid grid-cols-2 gap-3 md:w-[220px] shrink-0">
            <StatBox icon={<Gauge size={16} />} label="Avg BPM" value={avgBpm > 0 ? String(Math.round(avgBpm)) : "\u2014"} color="text-primary" />
            <StatBox icon={<Key size={16} />} label="Key" value={key || "\u2014"} color="text-primary" />
            <StatBox icon={<Volume2 size={16} />} label="Loudness" value={avgLoudness ? `${avgLoudness.toFixed(1)} dB` : "\u2014"} color="text-primary" />
            <StatBox icon={<Music size={16} />} label="Energy" value={avgEnergy > 0 ? `${Math.round(avgEnergy * 100)}%` : "\u2014"} color="text-primary" />
          </div>

          {hasRadarData && (
            <div className="hidden md:block flex-1">
              <div className="h-[220px] max-w-[300px] mx-auto">
                <ResponsiveRadar
                  data={radarDataFormatted}
                  keys={["value"]}
                  indexBy="feature"
                  maxValue={100}
                  margin={{ top: 25, right: 50, bottom: 25, left: 50 }}
                  curve="linearClosed"
                  gridLabelOffset={14}
                  dotSize={6}
                  dotColor={{ theme: "background" }}
                  dotBorderWidth={2}
                  colors={["#06b6d4"]}
                  fillOpacity={0.2}
                  theme={NIVO_THEME}
                  animate={true}
                  motionConfig="gentle"
                />
              </div>
            </div>
          )}

          <div className="flex-1 md:max-w-[280px]">
            <div className="hidden md:block h-[200px]">
              <ResponsiveBar
                data={barData}
                keys={["value"]}
                indexBy="name"
                layout="horizontal"
                margin={{ top: 0, right: 30, bottom: 0, left: 80 }}
                padding={0.35}
                colors={() => PRIMARY_COLOR}
                borderRadius={3}
                enableLabel={true}
                label={(d) => `${d.value}%`}
                labelTextColor="#fff"
                theme={NIVO_THEME}
                animate={true}
                motionConfig="gentle"
                axisLeft={{ tickSize: 0, tickPadding: 8 }}
                axisBottom={null}
                enableGridX={false}
              />
            </div>

            <div className="md:hidden space-y-2">
              {barData.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground w-[70px] shrink-0">{d.name}</span>
                  <div className="h-2 flex-1 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500 bg-primary"
                      style={{ width: `${d.value}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono w-[30px] text-right">{d.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {topMoods.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Mood:</span>
              {topMoods.map(([mood, score]) => (
                <Badge key={mood} variant="secondary" className="text-[11px] px-2 py-0.5">
                  {mood} <span className="text-muted-foreground ml-1">{Math.round(score * 100)}%</span>
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="bg-secondary/50 rounded-lg p-3">
      <div className={`flex items-center gap-1.5 mb-1 ${color}`}>
        {icon}
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="text-lg font-bold text-foreground font-mono">{value}</div>
    </div>
  );
}
