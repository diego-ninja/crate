import { useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import {
  Play,
  ExternalLink,
  Music,
  HardDrive,
  Clock,
  Disc3,
  BrainCircuit,
  Loader2,
} from "lucide-react";
import { encPath, formatDuration, formatSize } from "@/lib/utils";
import { usePlayer, type Track } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface NavidromeAlbumData {
  id: string;
  name: string;
  songs: { id: string; title: string; track: number; duration: number }[];
  navidrome_url: string;
}

interface AlbumHeaderProps {
  artist: string;
  album: string;
  albumTags: {
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    musicbrainz_albumid?: string | null;
  };
  trackCount: number;
  totalLengthSec: number;
  totalSizeMb: number;
  hasCover: boolean;
  navidromeData?: NavidromeAlbumData | null;
  hasAnalysis?: boolean;
  onAnalysisComplete?: () => void;
  children?: React.ReactNode;
}

export function AlbumHeader({
  artist,
  album,
  albumTags,
  trackCount,
  totalLengthSec,
  totalSizeMb,
  hasCover,
  navidromeData,
  hasAnalysis,
  onAnalysisComplete,
  children,
}: AlbumHeaderProps) {
  const { playAll } = usePlayer();
  const coverUrl = `/api/cover/${encPath(artist)}/${encPath(album)}`;
  const [coverLoaded, setCoverLoaded] = useState(false);
  const [coverError, setCoverError] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  async function handleAnalyze() {
    setAnalyzing(true);
    try {
      const res = await api<{ task_id: string }>(`/api/analyze/album/${encPath(artist)}/${encPath(album)}`, "POST");
      const taskId = res.task_id;
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string }>(`/api/tasks/${taskId}`);
          if (task.status === "completed") {
            clearInterval(poll);
            setAnalyzing(false);
            toast.success("Analysis complete");
            onAnalysisComplete?.();
          } else if (task.status === "failed") {
            clearInterval(poll);
            setAnalyzing(false);
            toast.error("Analysis failed");
          }
        } catch { /* keep polling */ }
      }, 3000);
      setTimeout(() => { clearInterval(poll); setAnalyzing(false); }, 120000);
    } catch {
      setAnalyzing(false);
      toast.error("Failed to start analysis");
    }
  }
  const displayName = albumTags.album || album;
  const displayArtist = albumTags.artist || artist;
  const letter = displayName.charAt(0).toUpperCase();

  function handlePlayAll() {
    if (!navidromeData?.songs.length) return;
    const tracks: Track[] = navidromeData.songs.map((s) => ({
      id: s.id,
      title: s.title,
      artist: displayArtist,
      albumCover: coverUrl,
    }));
    playAll(tracks);
  }

  const [bgLoaded, setBgLoaded] = useState(false);
  const bgUrl = `/api/artist/${encPath(artist)}/background`;

  return (
    <div className="relative h-[300px] overflow-hidden -mx-8 -mt-8 mb-8">
      {/* Artist background image (panoramic from fanart.tv) */}
      <img
        src={bgUrl}
        alt=""
        className={`absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-1000 ${bgLoaded ? "opacity-40" : "opacity-0"}`}
        onLoad={() => setBgLoaded(true)}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0a] via-[#0a0a0a]/80 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-[#0a0a0a]/40" />

      {/* Noise texture */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
      }} />

      {/* Content */}
      <div className="absolute inset-0 flex items-end px-8 pb-6">
        <div className="flex items-end gap-6 max-w-4xl w-full">
          {/* Cover art */}
          <ImageLightbox src={coverUrl} alt={`${displayName} cover art`}>
            <div className="w-[200px] h-[200px] rounded-lg overflow-hidden flex-shrink-0 ring-2 ring-white/10 shadow-2xl shadow-black/50">
              {!coverError ? (
                <img
                  src={coverUrl}
                  alt={displayName}
                  className={`w-full h-full object-cover transition-opacity duration-500 ${coverLoaded ? "opacity-100" : "opacity-0"}`}
                  onLoad={() => setCoverLoaded(true)}
                  onError={() => setCoverError(true)}
                />
              ) : null}
              {(coverError || !coverLoaded) && (
                <div className={`absolute inset-0 bg-gradient-to-br from-violet-600/40 to-violet-900/20 flex items-center justify-center transition-opacity duration-500 ${coverLoaded && !coverError ? "opacity-0" : "opacity-100"}`}>
                  <span className="text-5xl font-black text-white/40">{letter}</span>
                </div>
              )}
            </div>
          </ImageLightbox>

          {/* Album info */}
          <div className="flex-1 min-w-0 pb-1">
            {/* Breadcrumb */}
            <div className="text-xs text-white/40 mb-2">
              <Link to="/browse" className="hover:text-white/70 transition-colors">Browse</Link>
              <span className="mx-1.5">/</span>
              <Link to={`/artist/${encPath(artist)}`} className="hover:text-white/70 transition-colors">{artist}</Link>
              <span className="mx-1.5">/</span>
              <span className="text-white/60">{displayName}</span>
            </div>

            {/* Album title */}
            <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white leading-none mb-1.5 truncate">
              {displayName}
            </h1>

            {/* Artist link */}
            <Link
              to={`/artist/${encPath(artist)}`}
              className="text-base text-white/60 hover:text-white transition-colors"
            >
              {displayArtist}
            </Link>

            {/* Stats row */}
            <div className="flex items-center gap-4 text-sm text-white/50 mt-3 mb-3 flex-wrap">
              {albumTags.year && (
                <span className="text-white/70 font-medium">{albumTags.year}</span>
              )}
              <span className="flex items-center gap-1.5"><Disc3 size={14} />{trackCount} tracks</span>
              <span className="flex items-center gap-1.5"><Clock size={14} />{formatDuration(totalLengthSec)}</span>
              <span className="flex items-center gap-1.5"><HardDrive size={14} />{formatSize(totalSizeMb)}</span>
              {albumTags.genre && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/8 text-white/60 border border-white/10">
                  {albumTags.genre}
                </span>
              )}
              {hasCover ? (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  <Music size={10} className="mr-0.5" /> Cover
                </Badge>
              ) : (
                <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30 text-[10px] px-1.5 py-0">
                  No cover
                </Badge>
              )}
              {albumTags.musicbrainz_albumid ? (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  MBID {albumTags.musicbrainz_albumid.slice(0, 8)}
                </Badge>
              ) : (
                <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/30 text-[10px] px-1.5 py-0">
                  No MBID
                </Badge>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 flex-wrap">
              {navidromeData && (
                <>
                  <Button
                    size="sm"
                    className="bg-violet-600 hover:bg-violet-500 text-white"
                    onClick={handlePlayAll}
                    disabled={!navidromeData.songs.length}
                  >
                    <Play size={14} className="mr-1 fill-current" /> Play All
                  </Button>
                  {navidromeData.navidrome_url && (
                    <Button size="sm" variant="outline" className="border-white/20 text-white/70 hover:text-white hover:bg-white/10" asChild>
                      <a href={navidromeData.navidrome_url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink size={14} className="mr-1" /> Navidrome
                      </a>
                    </Button>
                  )}
                </>
              )}
              <Button
                size="sm"
                variant="outline"
                className="border-white/20 text-white/70 hover:text-white hover:bg-white/10"
                onClick={handleAnalyze}
                disabled={analyzing}
              >
                {analyzing ? (
                  <><Loader2 size={14} className="animate-spin mr-1" /> Analyzing...</>
                ) : (
                  <><BrainCircuit size={14} className="mr-1" /> {hasAnalysis ? "Re-analyze" : "Analyze Audio"}</>
                )}
              </Button>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
