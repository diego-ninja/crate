import { useState } from "react";
import { BarChart3, Download, FileText, Loader2 } from "lucide-react";
import { ResponsiveRadar } from "@nivo/radar";

import { SimilarTracksPanel } from "@/components/track/SimilarTracksPanel";
import { Badge } from "@crate/ui/shadcn/badge";
import { Button } from "@crate/ui/shadcn/button";

import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@crate/ui/shadcn/table";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@crate/ui/shadcn/tooltip";
import { MusicContextMenu } from "@/components/ui/music-context-menu";
import { trackDownloadApiPath } from "@/lib/library-routes";
import { formatDuration, formatBitrate } from "@/lib/utils";

interface Track {
  id?: number;
  entity_uid?: string;
  filename: string;
  format: string;
  size_mb: number;
  bitrate: number | null;
  sample_rate?: number | null;
  bit_depth?: number | null;
  length_sec: number;
  popularity?: number | null;
  popularity_score?: number | null;
  popularity_confidence?: number | null;
  lyrics?: TrackLyricsStatus;
  stream_variants?: TrackStreamVariant[];
  tags: Record<string, string>;
  path?: string;
}

export interface TrackLyricsStatus {
  status?: string;
  found?: boolean;
  has_plain?: boolean;
  has_synced?: boolean;
  provider?: string;
  updated_at?: string | null;
}

interface TrackStreamVariant {
  id: string;
  preset: string;
  status: string;
  delivery_format: string;
  delivery_codec: string;
  delivery_bitrate: number;
  delivery_sample_rate?: number | null;
  bytes?: number | null;
  error?: string | null;
  task_id?: string | null;
  task_status?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
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
  syncingLyricsTrackKey?: string | null;
  onSyncTrackLyrics?: (track: Track) => void | Promise<void>;
}

function EnergyBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-md bg-primary/10">
        <div className="h-full rounded-md bg-primary" style={{ width: `${pct * 100}%`, opacity: 0.4 + pct * 0.6 }} />
      </div>
      <span className="w-7 text-right font-mono text-xs text-muted-foreground">{Math.round(pct * 100)}</span>
    </div>
  );
}

function PopularityBar({
  score,
  confidence,
}: {
  score: number | null | undefined;
  confidence: number | null | undefined;
}) {
  if (score == null || score <= 0) return null;
  const pct = Math.max(0, Math.min(1, score));
  const confidencePct = Math.max(0, Math.min(1, confidence ?? 0));

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex min-w-[104px] items-center gap-2">
            <div className="h-1.5 w-14 overflow-hidden rounded-md bg-primary/10">
              <div
                className="h-full rounded-md bg-primary"
                style={{ width: `${pct * 100}%`, opacity: 0.45 + confidencePct * 0.45 }}
              />
            </div>
            <span className="w-8 text-right font-mono text-xs text-muted-foreground">
              {Math.round(pct * 100)}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="border border-white/10 bg-popover-surface text-foreground shadow-[0_20px_48px_rgba(0,0,0,0.34)] backdrop-blur-xl"
        >
          <div className="space-y-1 text-xs">
            <div>Popularity {Math.round(pct * 100)}%</div>
            {confidence != null ? (
              <div className="text-white/60">Confidence {Math.round(confidencePct * 100)}%</div>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function formatBytes(bytes: number | null | undefined) {
  const value = Number(bytes || 0);
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / Math.pow(1024, index);
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

function variantTone(status: string) {
  if (status === "ready") return "border-emerald-400/35 bg-emerald-400/10 text-emerald-200";
  if (status === "failed") return "border-red-400/35 bg-red-500/10 text-red-200";
  if (status === "running") return "border-cyan-400/35 bg-cyan-400/10 text-cyan-200";
  if (status === "pending") return "border-amber-400/35 bg-amber-400/10 text-amber-200";
  return "border-white/15 bg-white/[0.04] text-white/50";
}

function variantLabel(variant: TrackStreamVariant) {
  const codec = (variant.delivery_codec || variant.delivery_format || "").toUpperCase();
  return `${codec} ${variant.delivery_bitrate}k`;
}

function TrackVariantBadges({ variants }: { variants: TrackStreamVariant[] | undefined }) {
  if (!variants?.length) {
    return <span className="text-xs text-white/25">None</span>;
  }

  const visible = variants.slice(0, 2);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex min-w-[112px] flex-wrap gap-1">
            {visible.map((variant) => (
              <span
                key={variant.id}
                className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none ${variantTone(variant.status)}`}
              >
                {variantLabel(variant)}
              </span>
            ))}
            {variants.length > visible.length ? (
              <span className="inline-flex items-center rounded-md border border-white/12 bg-white/[0.04] px-1.5 py-0.5 text-[10px] leading-none text-white/45">
                +{variants.length - visible.length}
              </span>
            ) : null}
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="w-[260px] border border-white/10 bg-popover-surface text-foreground shadow-[0_20px_48px_rgba(0,0,0,0.34)] backdrop-blur-xl"
        >
          <div className="space-y-2 text-xs">
            <div className="font-semibold text-white/75">Playback variants</div>
            {variants.map((variant) => (
              <div key={variant.id} className="rounded-md border border-white/8 bg-white/[0.03] px-2 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-white/75">{variant.preset}</span>
                  <span className={`rounded-md border px-1.5 py-0.5 text-[10px] ${variantTone(variant.status)}`}>
                    {variant.status}
                  </span>
                </div>
                <div className="mt-1 text-white/45">
                  {variantLabel(variant)}
                  {variant.delivery_sample_rate ? ` / ${Math.round(variant.delivery_sample_rate / 1000)}kHz` : ""}
                  {" - "}
                  {formatBytes(variant.bytes)}
                </div>
                {variant.task_status ? (
                  <div className="mt-1 text-white/30">Task {variant.task_status}</div>
                ) : null}
                {variant.error ? (
                  <div className="mt-1 line-clamp-2 text-red-200/70">{variant.error}</div>
                ) : null}
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function normalizeLyricsStatus(lyrics: TrackLyricsStatus | undefined) {
  if (lyrics?.has_synced || lyrics?.status === "synced") return "synced";
  if (lyrics?.has_plain || lyrics?.status === "txt" || lyrics?.status === "plain") return "txt";
  return "none";
}

function lyricsTone(status: string) {
  if (status === "synced") return "border-amber-300/45 bg-amber-300/10 text-amber-200";
  if (status === "txt") return "border-cyan-300/40 bg-cyan-300/10 text-cyan-200";
  return "border-white/10 bg-white/[0.03] text-white/35";
}

function lyricsLabel(status: string) {
  if (status === "synced") return "SYNCED";
  if (status === "txt") return "TXT";
  return "NONE";
}

function LyricsBadge({
  lyrics,
  busy = false,
  onClick,
}: {
  lyrics?: TrackLyricsStatus;
  busy?: boolean;
  onClick?: () => void;
}) {
  const status = normalizeLyricsStatus(lyrics);
  const label = lyricsLabel(status);
  const actionLabel = busy ? "Syncing lyrics..." : "Sync lyrics for this track";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!busy) onClick?.();
            }}
            className={`inline-flex min-w-[68px] items-center justify-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-none transition-colors hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-70 ${lyricsTone(status)}`}
            aria-label={`${actionLabel}: ${label}`}
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />}
            {label}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="border border-white/10 bg-popover-surface text-foreground shadow-[0_20px_48px_rgba(0,0,0,0.34)] backdrop-blur-xl"
        >
          <div className="space-y-1 text-xs">
            <div>{busy ? "Syncing lyrics..." : label === "NONE" ? "No lyrics cached" : label === "TXT" ? "Plain lyrics cached" : "Synced lyrics cached"}</div>
            <div className="text-white/50">{actionLabel}</div>
            {lyrics?.updated_at ? <div className="text-white/50">Updated {new Date(lyrics.updated_at).toLocaleString()}</div> : null}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
  const hasFeatures = FEATURE_BARS.some((feature) => track[feature.key] != null);
  if (!hasFeatures && track.loudness == null && !track.mood) return null;

  const radarData = FEATURE_BARS.map((feature) => ({
    feature: feature.label,
    value: (track[feature.key] as number | null) ?? 0,
  }));
  const hasRadar = radarData.some((item) => item.value > 0);
  const topMoods = track.mood
    ? Object.entries(track.mood).sort((a, b) => b[1] - a[1]).slice(0, 3)
    : [];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-primary">
            <BarChart3 size={13} />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="left"
          className="w-[320px] border border-white/10 bg-popover-surface p-4 text-foreground shadow-[0_24px_64px_rgba(0,0,0,0.42)] backdrop-blur-xl"
        >
          <div className="mb-2 text-[11px] font-semibold text-white/70">Audio Profile</div>
          {hasRadar ? (
            <div className="mx-auto mb-3 h-[200px] w-[200px]">
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
                  tooltip: {
                    container: {
                      background: "#16161e",
                      color: "#f1f5f9",
                      borderRadius: "8px",
                      fontSize: 11,
                      border: "1px solid #ffffff15",
                      padding: "6px 10px",
                    },
                  },
                }}
              />
            </div>
          ) : null}
          <div className="space-y-1">
            {FEATURE_BARS.map((feature) => {
              const value = track[feature.key] as number | null;
              if (value == null) return null;
              return (
                <div key={feature.key} className="flex items-center gap-2">
                  <span className="w-[70px] shrink-0 text-[10px] text-white/50">{feature.label}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-md bg-primary/10">
                    <div
                      className="h-full rounded-md bg-primary"
                      style={{ width: `${Math.round(value * 100)}%`, opacity: 0.4 + value * 0.6 }}
                    />
                  </div>
                  <span className="w-[28px] text-right font-mono text-[10px] text-white/40">
                    {Math.round(value * 100)}
                  </span>
                </div>
              );
            })}
          </div>
          {track.loudness != null ? (
            <div className="mt-2 flex items-center gap-2 border-t border-white/5 pt-1.5">
              <span className="w-[70px] shrink-0 text-[10px] text-white/50">Loudness</span>
              <span className="font-mono text-[10px] text-white/60">{track.loudness.toFixed(1)} dB</span>
            </div>
          ) : null}
          {topMoods.length > 0 ? (
            <div className="flex flex-wrap gap-1 pt-2">
              {topMoods.map(([mood, score]) => (
                <span
                  key={mood}
                  className="rounded-md border border-white/10 bg-white/8 px-1.5 py-0.5 text-[9px] text-white/60"
                >
                  {mood} {Math.round(score * 100)}%
                </span>
              ))}
            </div>
          ) : null}
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
  syncingLyricsTrackKey,
  onSyncTrackLyrics,
}: TrackTableProps) {
  const [similarTrack, setSimilarTrack] = useState<{ path: string; title: string; artist: string } | null>(null);

  function getTrackId(track: Track): string {
    if (track.id != null) return String(track.id);
    return track.path ?? `${artist}/${track.filename}`;
  }

  function getTrackLyricsSyncKey(track: Track): string {
    if (track.id != null) return `id:${track.id}`;
    if (track.entity_uid) return `uid:${track.entity_uid}`;
    if (track.path) return `path:${track.path}`;
    return `file:${track.filename}`;
  }

  const hasAnalysis = analysisData && tracks.some((track) => {
    const title = (track.tags.title || track.filename).toLowerCase();
    return analysisData[title] != null;
  });

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-right">#</TableHead>
            <TableHead>Track</TableHead>
            <TableHead>Format</TableHead>
            <TableHead>Bitrate</TableHead>
            <TableHead>Variants</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Popularity</TableHead>
            <TableHead>Size</TableHead>
            {hasAnalysis ? <TableHead>BPM</TableHead> : null}
            {hasAnalysis ? <TableHead>Key</TableHead> : null}
            {hasAnalysis ? <TableHead>Energy</TableHead> : null}
            <TableHead className="w-[86px]">Lyrics</TableHead>
            {hasAnalysis ? <TableHead className="w-10" /> : null}
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tracks.map((track, index) => {
            const trackId = getTrackId(track);
            const lyricsSyncKey = getTrackLyricsSyncKey(track);
            const trackTitle = (track.tags.title || track.filename).toLowerCase();
            const analyzedTrack = analysisData ? (analysisData[trackTitle] ?? undefined) : undefined;

            return (
              <MusicContextMenu
                key={track.filename}
                type="track"
                artist={artist || track.tags.artist || ""}
                artistId={artistId}
                artistSlug={artistSlug}
                album={album || track.tags.album || ""}
                albumId={albumId}
                albumSlug={albumSlug}
                trackId={trackId}
                trackTitle={track.tags.title || track.filename}
                albumCover={albumCover}
                onFindSimilar={track.path ? () => setSimilarTrack({ path: track.path!, title: track.tags.title || track.filename, artist: artist || track.tags.artist || "" }) : undefined}
              >
                <TableRow>
                  <TableCell className="text-right text-xs text-white/30">
                    {track.tags.tracknumber || index + 1}
                  </TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white/88">{track.tags.title || track.filename}</div>
                      {track.tags.artist && artist !== track.tags.artist ? (
                        <div className="truncate text-[11px] text-white/38">{track.tags.artist}</div>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const fmt = track.format.replace(".", "").toLowerCase();
                      const fmtUp = fmt.toUpperCase();
                      const isLossless = ["flac", "alac", "wav", "aiff"].includes(fmt);
                      const depth = track.bit_depth || 16;
                      const rateKhz = track.sample_rate ? (track.sample_rate / 1000) : 44.1;
                      const rateStr = `${rateKhz % 1 ? rateKhz.toFixed(1) : rateKhz}kHz`;
                      const isHiRes = isLossless && (depth > 16 || rateKhz > 48);
                      const label = isLossless ? `${fmtUp} ${depth}/${rateStr}` : fmtUp;
                      return (
                        <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap ${
                          isHiRes ? "border-amber-400/50 text-amber-300 bg-amber-400/10" :
                          isLossless ? "border-cyan-400/40 text-cyan-300 bg-cyan-400/8" :
                          "border-white/15 text-muted-foreground"
                        }`}>{label}</span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {formatBitrate(track.bitrate)}
                  </TableCell>
                  <TableCell>
                    <TrackVariantBadges variants={track.stream_variants} />
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {formatDuration(track.length_sec)}
                  </TableCell>
                  <TableCell>
                    <PopularityBar
                      score={track.popularity_score ?? ((track.popularity ?? 0) > 0 ? (track.popularity ?? 0) / 100 : null)}
                      confidence={track.popularity_confidence}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {track.size_mb} MB
                  </TableCell>
                  {hasAnalysis ? (
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {analyzedTrack?.tempo != null ? Math.round(analyzedTrack.tempo) : null}
                    </TableCell>
                  ) : null}
                  {hasAnalysis ? (
                    <TableCell>
                      {analyzedTrack?.key != null ? (
                        <Badge variant="outline" className="px-1.5 py-0 font-mono text-[11px] text-white/60">
                          {analyzedTrack.key}{analyzedTrack.scale ? ` ${analyzedTrack.scale === "major" ? "maj" : analyzedTrack.scale === "minor" ? "min" : analyzedTrack.scale}` : ""}
                        </Badge>
                      ) : null}
                    </TableCell>
                  ) : null}
                  {hasAnalysis ? (
                    <TableCell>
                      {analyzedTrack?.energy != null ? <EnergyBar value={analyzedTrack.energy} /> : null}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <LyricsBadge
                      lyrics={track.lyrics}
                      busy={syncingLyricsTrackKey === lyricsSyncKey}
                      onClick={onSyncTrackLyrics ? () => void onSyncTrackLyrics(track) : undefined}
                    />
                  </TableCell>
                  {hasAnalysis ? (
                    <TableCell>
                      {analyzedTrack ? <TrackAudioInfo track={analyzedTrack} /> : null}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    {track.entity_uid || track.id || track.path ? (
                      <a
                        href={trackDownloadApiPath({
                          entityUid: track.entity_uid,
                          id: track.id,
                          path: track.path,
                        }) || "#"}
                        download
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/5 hover:text-white"
                        title="Download track"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Download size={14} />
                      </a>
                    ) : null}
                  </TableCell>
                </TableRow>
              </MusicContextMenu>
            );
          })}
        </TableBody>
      </Table>

      {similarTrack ? (
        <SimilarTracksPanel
          trackPath={similarTrack.path}
          trackTitle={similarTrack.title}
          artist={similarTrack.artist}
          open={!!similarTrack}
          onClose={() => setSimilarTrack(null)}
        />
      ) : null}
    </>
  );
}
