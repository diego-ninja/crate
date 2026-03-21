import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, Pause, BarChart3 } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
} from "recharts";
import { formatDuration, formatBitrate } from "@/lib/utils";
import { usePlayer, type Track as PlayerTrack } from "@/contexts/PlayerContext";
import { cn } from "@/lib/utils";

interface Track {
  filename: string;
  format: string;
  size_mb: number;
  bitrate: number | null;
  length_sec: number;
  tags: Record<string, string>;
  path?: string;
}

interface NavidromeSong {
  id: string;
  title: string;
  track: number;
  duration: number;
}

interface AudioMuseTrack {
  tempo: number | null;
  key: string | null;
  scale: string | null;
  energy: number | null;
  mood: Record<string, number> | null;
  danceability: number | null;
  valence: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  loudness: number | null;
  dynamic_range: number | null;
  spectral_complexity: number | null;
}

interface TrackTableProps {
  tracks: Track[];
  navidromeSongs?: NavidromeSong[];
  artist?: string;
  albumCover?: string;
  audiomuseData?: Record<string, AudioMuseTrack>;
}

function formatBadgeClass(format: string): string {
  const f = format.replace(".", "").toLowerCase();
  if (f === "flac") return "bg-green-500/15 text-green-500 border-0";
  if (f === "mp3") return "bg-blue-500/15 text-blue-500 border-0";
  if (f === "m4a") return "bg-orange-500/15 text-orange-500 border-0";
  return "";
}

function EnergyBar({ value }: { value: number }) {
  // 0-1: blue (low) → green (mid) → red (high)
  const pct = Math.max(0, Math.min(1, value));
  const r = pct < 0.5 ? Math.round(pct * 2 * 80) : Math.round(80 + (pct - 0.5) * 2 * 175);
  const g = pct < 0.5 ? Math.round(100 + pct * 2 * 55) : Math.round(155 - (pct - 0.5) * 2 * 155);
  const b = pct < 0.5 ? Math.round(220 - pct * 2 * 180) : 0;
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="h-1.5 rounded-full"
        style={{ width: 40, background: `rgb(${r},${g},${b})`, opacity: 0.85 }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct * 100}%`, background: `rgb(${r},${g},${b})` }}
        />
      </div>
      <span className="text-xs text-muted-foreground font-mono">{Math.round(pct * 100)}</span>
    </div>
  );
}

const FEATURE_BARS: { key: keyof AudioMuseTrack; label: string; color: string }[] = [
  { key: "danceability", label: "Danceability", color: "#a855f7" },
  { key: "valence", label: "Valence", color: "#eab308" },
  { key: "acousticness", label: "Acousticness", color: "#22c55e" },
  { key: "instrumentalness", label: "Instrumental", color: "#3b82f6" },
  { key: "energy", label: "Energy", color: "#f97316" },
  { key: "spectral_complexity", label: "Complexity", color: "#06b6d4" },
];

function TrackAudioInfo({ track }: { track: AudioMuseTrack }) {
  const hasFeatures = FEATURE_BARS.some((f) => track[f.key] != null);
  if (!hasFeatures && track.loudness == null && !track.mood) return null;

  const radarData = FEATURE_BARS.map((f) => ({
    feature: f.label.slice(0, 5),
    value: (track[f.key] as number | null) ?? 0,
  }));
  const hasRadar = radarData.some((d) => d.value > 0);

  const topMoods = track.mood
    ? Object.entries(track.mood)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
    : [];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary">
            <BarChart3 size={13} />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="left"
          className="bg-[#3b4252] border border-white/10 p-4 w-[280px] text-foreground"
        >
          <div className="text-[11px] font-semibold text-white/70 mb-2">Audio Profile</div>
          {hasRadar && (
            <div className="w-[120px] h-[120px] mx-auto mb-2">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                  <PolarGrid stroke="rgba(255,255,255,0.08)" />
                  <PolarAngleAxis dataKey="feature" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 9 }} />
                  <Radar dataKey="value" fill="#88c0d0" fillOpacity={0.3} stroke="#88c0d0" />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="space-y-1">
            {FEATURE_BARS.map((f) => {
              const val = track[f.key] as number | null;
              if (val == null) return null;
              return (
                <div key={f.key} className="flex items-center gap-2">
                  <span className="text-[10px] text-white/50 w-[70px] shrink-0">{f.label}</span>
                  <div className="h-1.5 flex-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.round(val * 100)}%`, background: f.color }}
                    />
                  </div>
                  <span className="text-[10px] text-white/40 font-mono w-[28px] text-right">
                    {Math.round(val * 100)}
                  </span>
                </div>
              );
            })}
          </div>
          {track.loudness != null && (
            <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-white/5">
              <span className="text-[10px] text-white/50 w-[70px] shrink-0">Loudness</span>
              <span className="text-[10px] text-white/60 font-mono">{track.loudness.toFixed(1)} dB</span>
            </div>
          )}
          {topMoods.length > 0 && (
            <div className="flex gap-1 pt-2 flex-wrap">
              {topMoods.map(([mood, score]) => (
                <span
                  key={mood}
                  className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/8 text-white/60 border border-white/10"
                >
                  {mood} {Math.round(score * 100)}%
                </span>
              ))}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function TrackTable({ tracks, navidromeSongs, artist, albumCover, audiomuseData }: TrackTableProps) {
  const { play, playAll, pause, resume, isPlaying, queue, currentIndex } = usePlayer();
  const currentTrack = queue[currentIndex];

  const hasNavidrome = navidromeSongs && navidromeSongs.length > 0;

  function findNavidromeSong(track: Track, index: number): NavidromeSong | undefined {
    if (!navidromeSongs) return undefined;
    const trackNum = parseInt(track.tags.tracknumber || String(index + 1), 10);
    return navidromeSongs.find((s) => s.track === trackNum)
      ?? navidromeSongs.find((s) => s.title.toLowerCase() === (track.tags.title || "").toLowerCase());
  }

  function getTrackId(track: Track, index: number): string {
    const ndSong = findNavidromeSong(track, index);
    if (ndSong) return ndSong.id;
    // Fallback: use relative file path for direct streaming
    return track.path ?? `${artist}/${track.filename}`;
  }

  function toPlayerTrack(track: Track, index: number): PlayerTrack {
    return {
      id: getTrackId(track, index),
      title: track.tags.title || track.filename,
      artist: artist || track.tags.artist || "",
      albumCover,
    };
  }

  function handlePlayTrack(track: Track, index: number) {
    const allPlayerTracks: PlayerTrack[] = [];
    let startIdx = 0;
    tracks.forEach((t, i) => {
      if (i === index) startIdx = allPlayerTracks.length;
      allPlayerTracks.push(toPlayerTrack(t, i));
    });
    if (allPlayerTracks.length > 1) {
      playAll(allPlayerTracks, startIdx);
    } else {
      play(toPlayerTrack(track, index));
    }
  }

  // Only show AudioMuse columns if at least one track has data
  // Only show audio columns if at least one track in THIS album has data
  const hasAudiomuse = audiomuseData && tracks.some((t) => {
    const title = (t.tags.title || t.filename).toLowerCase();
    return audiomuseData[title] != null;
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10" />
          <TableHead className="w-10">#</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Format</TableHead>
          <TableHead>Bitrate</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Size</TableHead>
          {hasAudiomuse && <TableHead className="text-muted-foreground font-mono text-xs">BPM</TableHead>}
          {hasAudiomuse && <TableHead className="text-muted-foreground text-xs">Key</TableHead>}
          {hasAudiomuse && <TableHead className="text-muted-foreground text-xs">Energy</TableHead>}
          {hasAudiomuse && <TableHead className="w-8" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {tracks.map((t, i) => {
          const trackId = getTrackId(t, i);
          const isCurrentTrack = currentTrack?.id === trackId;
          const isCurrentPlaying = isCurrentTrack && isPlaying;
          const trackTitle = (t.tags.title || t.filename).toLowerCase();
          const ndSong = hasNavidrome ? findNavidromeSong(t, i) : undefined;
          const amTrack = audiomuseData ? (audiomuseData[trackTitle] ?? audiomuseData[ndSong?.id ?? ""]) : undefined;
          return (
            <TableRow key={t.filename} className={cn(isCurrentTrack && "bg-primary/5")}>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-7 w-7",
                    isCurrentTrack ? "text-primary" : "text-muted-foreground hover:text-primary"
                  )}
                  onClick={() => {
                    if (isCurrentPlaying) {
                      pause();
                    } else if (isCurrentTrack) {
                      resume();
                    } else {
                      handlePlayTrack(t, i);
                    }
                  }}
                >
                  {isCurrentPlaying ? (
                    <Pause size={14} fill="currentColor" />
                  ) : isCurrentTrack ? (
                    <Play size={14} fill="currentColor" />
                  ) : (
                    <Play size={14} />
                  )}
                </Button>
              </TableCell>
              <TableCell className={cn("text-muted-foreground", isCurrentTrack && "text-primary")}>
                {t.tags.tracknumber || i + 1}
              </TableCell>
              <TableCell className={cn(isCurrentTrack && "text-primary font-medium")}>{t.tags.title || t.filename}</TableCell>
              <TableCell>
                <Badge className={formatBadgeClass(t.format)}>
                  {t.format.replace(".", "").toUpperCase()}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground font-mono text-sm">
                {formatBitrate(t.bitrate)}
              </TableCell>
              <TableCell className="text-muted-foreground font-mono text-sm">
                {formatDuration(t.length_sec)}
              </TableCell>
              <TableCell className="text-muted-foreground font-mono text-sm">
                {t.size_mb} MB
              </TableCell>
              {hasAudiomuse && (
                <TableCell className="text-muted-foreground font-mono text-sm">
                  {amTrack?.tempo != null ? Math.round(amTrack.tempo) : null}
                </TableCell>
              )}
              {hasAudiomuse && (
                <TableCell>
                  {amTrack?.key != null ? (
                    <Badge variant="outline" className="text-[11px] px-1.5 py-0 font-mono border-white/15 text-white/60">
                      {amTrack.key}{amTrack.scale ? ` ${amTrack.scale === "major" ? "maj" : amTrack.scale === "minor" ? "min" : amTrack.scale}` : ""}
                    </Badge>
                  ) : null}
                </TableCell>
              )}
              {hasAudiomuse && (
                <TableCell>
                  {amTrack?.energy != null ? <EnergyBar value={amTrack.energy} /> : null}
                </TableCell>
              )}
              {hasAudiomuse && (
                <TableCell>
                  {amTrack ? <TrackAudioInfo track={amTrack} /> : null}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
