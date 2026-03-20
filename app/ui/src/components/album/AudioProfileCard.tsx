import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Music, Gauge, Key, Volume2 } from "lucide-react";
import type { AudioMuseTrack } from "@/pages/Album";

interface AudioProfileCardProps {
  audiomuseData: Record<string, AudioMuseTrack>;
}

function avg(values: (number | null | undefined)[]): number {
  const valid = values.filter((v): v is number => v != null);
  return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
}

function dominantKey(tracks: AudioMuseTrack[]): string | null {
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

const FEATURE_COLORS: Record<string, string> = {
  Danceability: "#88c0d0",
  Valence: "#ebcb8b",
  Acousticness: "#a3be8c",
  Energy: "#d08770",
  Complexity: "#b48ead",
  Instrumental: "#81a1c1",
};

export function AudioProfileCard({ audiomuseData }: AudioProfileCardProps) {
  const tracks = Object.values(audiomuseData);
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

  const radarData = Object.entries(features).map(([feature, value]) => ({ feature, value }));
  const barData = Object.entries(features)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value: Math.round(value * 100) }));

  const hasRadarData = radarData.some((d) => d.value > 0);

  const avgBpm = avg(tracks.map((t) => t.tempo));
  const key = dominantKey(tracks);
  const avgLoudness = avg(tracks.map((t) => t.loudness));
  const avgEnergy = avg(tracks.map((t) => t.energy));

  // Aggregate moods
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
      {/* Header */}
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Music size={14} className="text-primary" />
          Audio Profile
        </h4>
        <span className="text-xs text-muted-foreground">{withData.length} tracks analyzed</span>
      </div>

      <div className="p-5">
        {/* Top: Big stats + Radar */}
        <div className="flex flex-col md:flex-row gap-6 items-start">
          {/* Left: Key metrics */}
          <div className="grid grid-cols-2 gap-3 md:w-[220px] shrink-0">
            <StatBox
              icon={<Gauge size={16} />}
              label="Avg BPM"
              value={avgBpm > 0 ? String(Math.round(avgBpm)) : "—"}
              color="text-primary"
            />
            <StatBox
              icon={<Key size={16} />}
              label="Key"
              value={key || "—"}
              color="text-[#ebcb8b]"
            />
            <StatBox
              icon={<Volume2 size={16} />}
              label="Loudness"
              value={avgLoudness ? `${avgLoudness.toFixed(1)} dB` : "—"}
              color="text-[#d08770]"
            />
            <StatBox
              icon={<Music size={16} />}
              label="Energy"
              value={avgEnergy > 0 ? `${Math.round(avgEnergy * 100)}%` : "—"}
              color="text-[#a3be8c]"
            />
          </div>

          {/* Center: Radar chart */}
          {hasRadarData && (
            <div className="hidden md:flex flex-1 justify-center">
              <div className="w-[220px] h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                    <PolarGrid stroke="rgba(136,192,208,0.15)" />
                    <PolarAngleAxis
                      dataKey="feature"
                      tick={{ fill: "rgba(236,239,244,0.5)", fontSize: 10 }}
                    />
                    <Radar
                      dataKey="value"
                      fill="#88c0d0"
                      fillOpacity={0.25}
                      stroke="#88c0d0"
                      strokeWidth={2}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Right: Feature bars */}
          <div className="flex-1 md:max-w-[280px]">
            <div className="hidden md:block h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={80}
                    tick={{ fill: "rgba(236,239,244,0.5)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={10}>
                    {barData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={FEATURE_COLORS[entry.name] || "#88c0d0"}
                        fillOpacity={0.7}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Mobile: simple bars */}
            <div className="md:hidden space-y-2">
              {barData.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground w-[70px] shrink-0">{d.name}</span>
                  <div className="h-2 flex-1 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${d.value}%`,
                        background: FEATURE_COLORS[d.name] || "#88c0d0",
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono w-[30px] text-right">{d.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom: Mood tags */}
        {topMoods.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Mood:</span>
              {topMoods.map(([mood, score]) => (
                <Badge
                  key={mood}
                  variant="secondary"
                  className="text-[11px] px-2 py-0.5"
                >
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
