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
  Download,
  Heart,
} from "lucide-react";
import { encPath, formatDuration, formatSize } from "@/lib/utils";
import { usePlayer, type Track } from "@/contexts/PlayerContext";
import { useFavorites } from "@/hooks/use-favorites";
import { ImageCropUpload } from "@/components/ImageCropUpload";
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
  genres?: string[];
  hasAnalysis?: boolean;
  onAnalysisComplete?: () => void;
  children?: React.ReactNode;
  tracks?: { filename: string; path?: string; title?: string }[];
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
  genres: _genres,
  hasAnalysis: _hasAnalysis,
  onAnalysisComplete,
  children,
  tracks: trackList,
}: AlbumHeaderProps) {
  const { playAll } = usePlayer();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [coverCacheBust, setCoverCacheBust] = useState("");
  const coverUrl = `/api/cover/${encPath(artist)}/${encPath(album)}${coverCacheBust ? `?t=${coverCacheBust}` : ""}`;
  const albumFavId = navidromeData?.id || `${artist}/${album}`;
  const [coverLoaded, setCoverLoaded] = useState(false);
  const [coverError, setCoverError] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  async function handleEnrich() {
    setAnalyzing(true);
    try {
      const res = await api<{ task_id: string }>(`/api/enrich/album/${encPath(artist)}/${encPath(album)}`, "POST");
      toast.success("Enriching album (MBID, covers, analysis, bliss)...");
      const taskId = res.task_id;
      const poll = setInterval(async () => {
        try {
          onAnalysisComplete?.();
          const task = await api<{ status: string }>(`/api/tasks/${taskId}`);
          if (task.status === "completed") {
            clearInterval(poll);
            setAnalyzing(false);
            toast.success("Album enrichment complete");
            onAnalysisComplete?.();
          } else if (task.status === "failed") {
            clearInterval(poll);
            setAnalyzing(false);
            toast.error("Enrichment failed");
          }
        } catch { /* keep polling */ }
      }, 4000);
      setTimeout(() => { clearInterval(poll); setAnalyzing(false); }, 120000);
    } catch {
      setAnalyzing(false);
      toast.error("Failed to start enrichment");
    }
  }
  const displayName = albumTags.album || album;
  const displayArtist = albumTags.artist || artist;
  const letter = displayName.charAt(0).toUpperCase();

  function handlePlayAll() {
    // Prefer Navidrome streaming, fallback to direct file streaming
    if (navidromeData?.songs.length) {
      const tracks: Track[] = navidromeData.songs.map((s) => ({
        id: s.id,
        title: s.title,
        artist: displayArtist,
        albumCover: coverUrl,
      }));
      playAll(tracks);
    } else if (trackList?.length) {
      const tracks: Track[] = trackList.map((t) => ({
        id: (t.path || "").replace(/^\/music\//, ""),
        title: t.title || t.filename.replace(/\.\w+$/, ""),
        artist: displayArtist,
        albumCover: coverUrl,
      }));
      playAll(tracks);
    }
  }

  const [bgLoaded, setBgLoaded] = useState(false);
  const bgUrl = `/api/artist/${encPath(artist)}/background`;

  return (
    <div
      className="relative h-[360px] md:h-[420px] overflow-hidden -ml-4 -mr-4 md:-ml-8 md:-mr-8 -mt-16 md:-mt-[6.5rem] mb-6"
      style={{ width: "calc(100vw - var(--sidebar-w, 0px))" }}
    >
      {/* Artist background image */}
      <img
        src={bgUrl}
        alt=""
        className={`absolute inset-0 w-full h-full object-cover object-[right_20%] transition-opacity duration-1000 ${bgLoaded ? "opacity-60" : "opacity-0"}`}
        onLoad={() => setBgLoaded(true)}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />

      {/* Gradient overlays */}
      <div className="absolute inset-0" style={{
        background: "linear-gradient(to right, var(--gradient-bg) 0%, var(--gradient-bg-85) 25%, var(--gradient-bg-40) 50%, transparent 75%)",
      }} />
      <div className="absolute inset-0" style={{
        background: "linear-gradient(to top, var(--gradient-bg) 0%, var(--gradient-bg-90) 15%, var(--gradient-bg-40) 40%, transparent 70%)",
      }} />
      <div className="absolute inset-0" style={{
        background: "linear-gradient(to bottom, var(--gradient-bg-50) 0%, transparent 30%)",
      }} />

      {/* Content */}
      <div className="absolute inset-0 flex items-end">
        <div className="flex items-end gap-4 md:gap-6 w-full max-w-[1100px] px-4 md:px-8 pb-6 md:pb-8">
          {/* Cover art with upload overlay */}
          <div className="relative group/cover flex-shrink-0">
            <ImageLightbox src={coverUrl} alt={`${displayName} cover art`}>
              <div className="w-[150px] h-[150px] md:w-[200px] md:h-[200px] rounded-lg overflow-hidden ring-2 ring-white/10 shadow-2xl shadow-black/50">
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
                  <div className={`absolute inset-0 bg-gradient-to-br from-primary/40 to-primary/20 flex items-center justify-center transition-opacity duration-500 ${coverLoaded && !coverError ? "opacity-0" : "opacity-100"}`}>
                    <span className="text-5xl font-black text-white/40">{letter}</span>
                  </div>
                )}
              </div>
            </ImageLightbox>
            <ImageCropUpload
              endpoint={`/api/artwork/upload-cover/${encPath(artist)}/${encPath(album)}`}
              aspect={1}
              onUploaded={() => { setCoverError(false); setCoverLoaded(false); setCoverCacheBust(String(Date.now())); }}
            />
          </div>

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
            <h1 className="text-xl md:text-4xl font-black tracking-tight text-white leading-none mb-1.5 truncate">
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
              {(navidromeData?.songs.length || trackList?.length) ? (
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/80 text-white"
                  onClick={handlePlayAll}
                >
                  <Play size={14} className="mr-1 fill-current" /> Play All
                </Button>
              ) : null}
              {navidromeData?.navidrome_url && (
                <Button size="sm" variant="outline" className="border-white/20 text-white/70 hover:text-white hover:bg-white/10" asChild>
                  <a href={navidromeData.navidrome_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={14} className="mr-1" /> Navidrome
                  </a>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="border-white/20 text-white/70 hover:text-white hover:bg-white/10"
                onClick={handleEnrich}
                disabled={analyzing}
              >
                {analyzing ? (
                  <><Loader2 size={14} className="animate-spin mr-1" /> Enriching...</>
                ) : (
                  <><BrainCircuit size={14} className="mr-1" /> Enrich</>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-white/20 text-white/70 hover:text-white hover:bg-white/10"
                asChild
              >
                <a href={`/api/download/album/${encPath(artist)}/${encPath(album)}`} download>
                  <Download size={14} className="mr-1" /> Download
                </a>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className={`border-white/20 hover:bg-white/10 ${isFavorite(albumFavId) ? "text-red-500 border-red-500/30" : "text-white/70 hover:text-white"}`}
                onClick={() => toggleFavorite(albumFavId, "album")}
              >
                <Heart size={14} className={`mr-1 ${isFavorite(albumFavId) ? "fill-red-500" : ""}`} />
                {isFavorite(albumFavId) ? "Favorited" : "Favorite"}
              </Button>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


