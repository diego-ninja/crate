import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MusicContextMenu } from "@/components/ui/music-context-menu";
import { SimilarTracksPanel } from "@/components/track/SimilarTracksPanel";
import { Button } from "@/components/ui/button";
import { BarChart3, Download } from "lucide-react";
import { StarRating } from "@/components/ui/star-rating";
import { api } from "@/lib/api";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { ResponsiveRadar } from "@nivo/radar";
import { useState } from "react";
import { formatDuration, formatBitrate, formatBadgeClass } from "@/lib/utils";

interface Track {
  id?: number;
  filename: string;
  format: string;
  size_mb: number;
  bitrate: number | null;
  length_sec: number;
  rating?: number;
  tags: Record<string, string>;
  path?: string;
}

export interface AudioAnalysisTrack {
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
  artist?: string;
  artistId?: number;
  artistSlug?: string;
  album?: string;
  albumId?: number;
  albumSlug?: string;
  albumCover?: string;
  analysisData?: Record<string, AudioAnalysisTrack>;
}


function EnergyBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 rounded-full bg-primary/20" style={{ width: 40 }}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct * 100}%`, opacity: 0.4 + pct * 0.6 }} />
      </div>
      <span className="text-xs text-muted-foreground font-mono">{Math.round(pct * 100)}</span>
    </div>
  );
}

const FEATURE_BARS: { key: keyof AudioAnalysisTrack; label: string }[] = [
  { key: "danceability", label: "Danceability" },
  { key: "valence", label: "Valence" },
  { key: "acousticness", label: "Acousticness" },
  { key: "instrumentalness", label: "Instrumental" },
  { key: "energy", label: "Energy" },
  { key: "spectral_complexity", label: "Complexity" },
];

function TrackAudioInfo({ track }: { track: AudioAnalysisTrack }) {
  const hasFeatures = FEATURE_BARS.some((f) => track[f.key] != null);
  if (!hasFeatures && track.loudness == null && !track.mood) return null;

  const radarData = FEATURE_BARS.map((f) => ({
    feature: f.label,
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
          className="bg-card border border-border p-4 w-[320px] text-foreground shadow-xl z-[200]"
        >
          <div className="text-[11px] font-semibold text-white/70 mb-2">Audio Profile</div>
          {hasRadar && (
            <div className="w-[200px] h-[200px] mx-auto mb-3">
              <ResponsiveRadar
                data={radarData}
                keys={["value"]}
                indexBy="feature"
                maxValue={1}
                margin={{ top: 20, right: 40, bottom: 20, left: 40 }}
                gridShape="circular"
                gridLevels={3}
                dotSize={4}
                dotColor="#16161e"
                dotBorderWidth={1}
                colors={["#06b6d4"]}
                fillOpacity={0.2}
                borderWidth={1}
                borderColor="#16161e"
                gridLabelOffset={12}
                theme={{
                  text: { fill: "#9ca3af", fontSize: 9 },
                  grid: { line: { stroke: "#ffffff15" } },
                  tooltip: { container: { background: "#16161e", color: "#f1f5f9", borderRadius: "8px", fontSize: 11, border: "1px solid #ffffff15", padding: "6px 10px" } },
                }}
              />
            </div>
          )}
          <div className="space-y-1">
            {FEATURE_BARS.map((f) => {
              const val = track[f.key] as number | null;
              if (val == null) return null;
              return (
                <div key={f.key} className="flex items-center gap-2">
                  <span className="text-[10px] text-white/50 w-[70px] shrink-0">{f.label}</span>
                  <div className="h-1.5 flex-1 bg-primary/10 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.round(val * 100)}%`, opacity: 0.4 + val * 0.6 }}
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

export function TrackTable({
  tracks,
  artist,
  artistId,
  artistSlug,
  album,
  albumId,
  albumSlug,
  albumCover,
  analysisData,
}: TrackTableProps) {
  const [ratings, setRatings] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    for (const t of tracks) if (t.id != null) init[t.id] = t.rating ?? 0;
    return init;
  });
  const [similarTrack, setSimilarTrack] = useState<{ path: string; title: string; artist: string } | null>(null);

  function handleRate(trackId: number | undefined, path: string | undefined, rating: number) {
    if (trackId != null) setRatings(prev => ({ ...prev, [trackId]: rating }));
    api("/api/track/rate", "POST", { track_id: trackId, path, rating }).catch(() => {
      // revert on failure
      if (trackId != null) setRatings(prev => ({ ...prev, [trackId]: 0 }));
    });
  }

  function getTrackId(track: Track): string {
    if (track.id != null) return String(track.id);
    return track.path ?? `${artist}/${track.filename}`;
  }

  // Only show AudioAnalysis columns if at least one track has data
  // Only show audio columns if at least one track in THIS album has data
  const hasAnalysis = analysisData && tracks.some((t) => {
    const title = (t.tags.title || t.filename).toLowerCase();
    return analysisData[title] != null;
  });

  return (
    <>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Format</TableHead>
          <TableHead>Bitrate</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead className="w-28">Rating</TableHead>
          <TableHead>Size</TableHead>
          {hasAnalysis && <TableHead className="text-muted-foreground font-mono text-xs">BPM</TableHead>}
          {hasAnalysis && <TableHead className="text-muted-foreground text-xs">Key</TableHead>}
          {hasAnalysis && <TableHead className="text-muted-foreground text-xs">Energy</TableHead>}
          {hasAnalysis && <TableHead className="w-8" />}
          <TableHead className="w-8" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {tracks.map((t, i) => {
          const trackId = getTrackId(t);
          const trackTitle = (t.tags.title || t.filename).toLowerCase();
          const amTrack = analysisData ? (analysisData[trackTitle] ?? undefined) : undefined;
          return (
            <MusicContextMenu
              key={t.filename}
              type="track"
              artist={artist || t.tags.artist || ""}
              artistId={artistId}
              artistSlug={artistSlug}
              album={album || t.tags.album || ""}
              albumId={albumId}
              albumSlug={albumSlug}
              trackId={trackId}
              trackTitle={t.tags.title || t.filename}
              albumCover={albumCover}
              onFindSimilar={t.path ? () => setSimilarTrack({ path: t.path!, title: t.tags.title || t.filename, artist: artist || t.tags.artist || "" }) : undefined}
            >
            <TableRow>
              <TableCell className="text-muted-foreground">
                {t.tags.tracknumber || i + 1}
              </TableCell>
              <TableCell>{t.tags.title || t.filename}</TableCell>
              <TableCell>
                <span className={formatBadgeClass(t.format)}>
                  {t.format.replace(".", "").toUpperCase()}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground font-mono text-sm">
                {formatBitrate(t.bitrate)}
              </TableCell>
              <TableCell className="text-muted-foreground font-mono text-sm">
                {formatDuration(t.length_sec)}
              </TableCell>
              <TableCell>
                <StarRating
                  value={t.id != null ? (ratings[t.id] ?? 0) : 0}
                  onChange={(r) => handleRate(t.id, t.path, r)}
                  size={13}
                />
              </TableCell>
              <TableCell className="text-muted-foreground font-mono text-sm">
                {t.size_mb} MB
              </TableCell>
              {hasAnalysis && (
                <TableCell className="text-muted-foreground font-mono text-sm">
                  {amTrack?.tempo != null ? Math.round(amTrack.tempo) : null}
                </TableCell>
              )}
              {hasAnalysis && (
                <TableCell>
                  {amTrack?.key != null ? (
                    <Badge variant="outline" className="text-[11px] px-1.5 py-0 font-mono border-white/15 text-white/60">
                      {amTrack.key}{amTrack.scale ? ` ${amTrack.scale === "major" ? "maj" : amTrack.scale === "minor" ? "min" : amTrack.scale}` : ""}
                    </Badge>
                  ) : null}
                </TableCell>
              )}
              {hasAnalysis && (
                <TableCell>
                  {amTrack?.energy != null ? <EnergyBar value={amTrack.energy} /> : null}
                </TableCell>
              )}
              {hasAnalysis && (
                <TableCell>
                  {amTrack ? <TrackAudioInfo track={amTrack} /> : null}
                </TableCell>
              )}
              <TableCell>
                {t.path && (
                  <a
                    href={`/api/download/track/${t.path}`}
                    download
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Download track"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Download size={13} />
                  </a>
                )}
              </TableCell>
            </TableRow>
            </MusicContextMenu>
          );
        })}
      </TableBody>
    </Table>
    {similarTrack && (
      <SimilarTracksPanel
        trackPath={similarTrack.path}
        trackTitle={similarTrack.title}
        artist={similarTrack.artist}
        open={!!similarTrack}
        onClose={() => setSimilarTrack(null)}
      />
    )}
  </>
  );
}
