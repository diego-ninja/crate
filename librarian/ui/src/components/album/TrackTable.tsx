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
import { Play, Pause } from "lucide-react";
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

export function TrackTable({ tracks, navidromeSongs, artist, albumCover, audiomuseData }: TrackTableProps) {
  const { play, playAll, pause, resume, isPlaying, queue, currentIndex } = usePlayer();
  const currentTrack = queue[currentIndex];

  function findNavidromeSong(track: Track, index: number): NavidromeSong | undefined {
    if (!navidromeSongs) return undefined;
    const trackNum = parseInt(track.tags.tracknumber || String(index + 1), 10);
    return navidromeSongs.find((s) => s.track === trackNum)
      ?? navidromeSongs.find((s) => s.title.toLowerCase() === (track.tags.title || "").toLowerCase());
  }

  function toPlayerTrack(track: Track, ndSong: NavidromeSong): PlayerTrack {
    return {
      id: ndSong.id,
      title: track.tags.title || track.filename,
      artist: artist || track.tags.artist || "",
      albumCover,
    };
  }

  function handlePlayTrack(track: Track, index: number) {
    const ndSong = findNavidromeSong(track, index);
    if (!ndSong) return;
    // Build full queue starting from this track
    const allPlayerTracks: PlayerTrack[] = [];
    let startIdx = 0;
    tracks.forEach((t, i) => {
      const nd = findNavidromeSong(t, i);
      if (nd) {
        if (i === index) startIdx = allPlayerTracks.length;
        allPlayerTracks.push(toPlayerTrack(t, nd));
      }
    });
    if (allPlayerTracks.length > 1) {
      playAll(allPlayerTracks, startIdx);
    } else {
      play(toPlayerTrack(track, ndSong));
    }
  }

  const hasNavidrome = navidromeSongs && navidromeSongs.length > 0;

  // Only show AudioMuse columns if at least one track has data
  const hasAudiomuse = audiomuseData && Object.keys(audiomuseData).length > 0;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {hasNavidrome && <TableHead className="w-10" />}
          <TableHead className="w-10">#</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Format</TableHead>
          <TableHead>Bitrate</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Size</TableHead>
          {hasAudiomuse && <TableHead className="text-muted-foreground font-mono text-xs">BPM</TableHead>}
          {hasAudiomuse && <TableHead className="text-muted-foreground text-xs">Key</TableHead>}
          {hasAudiomuse && <TableHead className="text-muted-foreground text-xs">Energy</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {tracks.map((t, i) => {
          const ndSong = hasNavidrome ? findNavidromeSong(t, i) : undefined;
          const isCurrentTrack = ndSong && currentTrack?.id === ndSong.id;
          const isCurrentPlaying = isCurrentTrack && isPlaying;
          const amTrack = ndSong && audiomuseData ? audiomuseData[ndSong.id] : undefined;
          return (
            <TableRow key={t.filename} className={cn(isCurrentTrack && "bg-primary/5")}>
              {hasNavidrome && (
                <TableCell>
                  {ndSong && (
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
                  )}
                </TableCell>
              )}
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
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
