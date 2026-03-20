import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
} from "recharts";
import { Badge } from "@/components/ui/badge";
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
      const label = `${t.key}${t.scale ? ` ${t.scale === "major" ? "maj" : t.scale === "minor" ? "min" : t.scale}` : ""}`;
      counts[label] = (counts[label] || 0) + 1;
    }
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? null;
}

export function AudioProfileCard({ audiomuseData }: AudioProfileCardProps) {
  const tracks = Object.values(audiomuseData);
  const withData = tracks.filter((t) => t.tempo != null || t.energy != null);
  if (withData.length === 0) return null;

  const avgDanceability = avg(tracks.map((t) => t.danceability));
  const avgValence = avg(tracks.map((t) => t.valence));
  const avgAcousticness = avg(tracks.map((t) => t.acousticness));
  const avgEnergy = avg(tracks.map((t) => t.energy));
  const avgSpectralComplexity = avg(tracks.map((t) => t.spectral_complexity));
  const avgInstrumentalness = avg(tracks.map((t) => t.instrumentalness));

  const radarData = [
    { feature: "Dance", value: avgDanceability },
    { feature: "Valence", value: avgValence },
    { feature: "Acoustic", value: avgAcousticness },
    { feature: "Energy", value: avgEnergy },
    { feature: "Complex", value: avgSpectralComplexity },
    { feature: "Instr.", value: avgInstrumentalness },
  ];

  const hasRadarData = radarData.some((d) => d.value > 0);

  const avgBpm = avg(tracks.map((t) => t.tempo));
  const key = dominantKey(tracks);

  const loudnessValues = tracks.map((t) => t.loudness).filter((v): v is number => v != null);
  const loudnessRange =
    loudnessValues.length > 0
      ? { min: Math.min(...loudnessValues), max: Math.max(...loudnessValues) }
      : null;

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
    <div className="mb-6 rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <h4 className="text-sm font-semibold text-white/70 mb-3">Audio Profile</h4>
      <div className="flex flex-col md:flex-row gap-4 items-start">
        {hasRadarData && (
          <div className="hidden md:block w-[200px] h-[200px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
                <PolarGrid stroke="rgba(255,255,255,0.1)" />
                <PolarAngleAxis
                  dataKey="feature"
                  tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
                />
                <Radar
                  dataKey="value"
                  fill="#88c0d0"
                  fillOpacity={0.3}
                  stroke="#88c0d0"
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="flex-1 space-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {avgBpm > 0 && (
              <span className="text-white/50">
                Avg BPM <span className="text-white/80 font-mono">{Math.round(avgBpm)}</span>
              </span>
            )}
            {key && (
              <span className="text-white/50">
                Key <span className="text-white/80 font-mono">{key}</span>
              </span>
            )}
            {loudnessRange && (
              <span className="text-white/50">
                Loudness{" "}
                <span className="text-white/80 font-mono">
                  {loudnessRange.min.toFixed(1)} to {loudnessRange.max.toFixed(1)} dB
                </span>
              </span>
            )}
          </div>
          {/* Mobile: simple feature list instead of radar */}
          <div className="md:hidden space-y-1">
            {radarData.filter((d) => d.value > 0).map((d) => (
              <div key={d.feature} className="flex items-center gap-2">
                <span className="text-[11px] text-white/50 w-[60px]">{d.feature}</span>
                <div className="h-1 w-[80px] bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-cyan-500"
                    style={{ width: `${Math.round(d.value * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-white/40 font-mono">{Math.round(d.value * 100)}%</span>
              </div>
            ))}
          </div>
          {topMoods.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {topMoods.map(([mood, score]) => (
                <Badge
                  key={mood}
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 border-white/10 text-white/60"
                >
                  {mood} {Math.round(score * 100)}%
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
