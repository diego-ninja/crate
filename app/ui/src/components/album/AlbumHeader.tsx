import { useState } from "react";
import { Link } from "react-router";
import {
  BrainCircuit,
  Disc3,
  Download,
  HardDrive,
  Loader2,
  Music,
  Clock,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import { ImageLightbox } from "@crate/ui/primitives/ImageLightbox";
import { Button } from "@crate/ui/shadcn/button";
import { CratePill } from "@crate/ui/primitives/CrateBadge";
import { GenrePillRow, type GenreProfileItem } from "@/components/genres/GenrePill";
import { ImageCropUpload } from "@/components/ImageCropUpload";
import { api } from "@/lib/api";
import { albumCoverApiUrl, artistBackgroundApiUrl, artistPagePath } from "@/lib/library-routes";
import { formatDuration, formatSize } from "@/lib/utils";

interface AlbumHeaderProps {
  albumId?: number;
  albumSlug?: string;
  artistId?: number;
  artistSlug?: string;
  artist: string;
  album: string;
  displayName?: string;
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
  popularity?: number | null;
  popularityScore?: number | null;
  popularityConfidence?: number | null;
  genres?: string[];
  genreProfile?: GenreProfileItem[];
  hasAnalysis?: boolean;
  onAnalysisComplete?: () => void;
  isAdmin?: boolean;
  children?: React.ReactNode;
}

export function AlbumHeader({
  albumId,
  albumSlug,
  artistId,
  artistSlug,
  artist,
  album,
  displayName: explicitDisplayName,
  albumTags,
  trackCount,
  totalLengthSec,
  totalSizeMb,
  hasCover,
  popularity,
  popularityScore,
  genreProfile,
  onAnalysisComplete,
  isAdmin = false,
  children,
}: AlbumHeaderProps) {
  const [coverCacheBust, setCoverCacheBust] = useState("");
  const [coverLoaded, setCoverLoaded] = useState(false);
  const [coverError, setCoverError] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [bgLoaded, setBgLoaded] = useState(false);

  const baseCoverUrl = albumCoverApiUrl({ albumId, albumSlug, artistName: artist, albumName: album });
  const coverUrl = `${baseCoverUrl}${coverCacheBust ? `${baseCoverUrl.includes("?") ? "&" : "?"}t=${coverCacheBust}` : ""}`;
  const bgUrl = artistBackgroundApiUrl({ artistId, artistSlug, artistName: artist });
  const resolvedDisplayName = albumTags.album || explicitDisplayName || album;
  const displayArtist = albumTags.artist || artist;
  const letter = resolvedDisplayName.charAt(0).toUpperCase();
  const popularityPercent =
    popularityScore != null
      ? Math.round(popularityScore * 100)
      : typeof popularity === "number" && popularity > 0
        ? popularity
        : 0;

  async function handleEnrich() {
    if (albumId == null) {
      toast.error("Album ID missing");
      return;
    }
    setAnalyzing(true);
    try {
      const response = await api<{ task_id: string }>(`/api/albums/${albumId}/enrich`, "POST");
      toast.success("Enriching album...");
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string }>(`/api/tasks/${response.task_id}`);
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
        } catch {
          // keep polling while the task is alive
        }
      }, 4000);
      setTimeout(() => {
        clearInterval(poll);
        setAnalyzing(false);
      }, 120000);
    } catch {
      setAnalyzing(false);
      toast.error("Failed to start enrichment");
    }
  }

  return (
    <div
      className="relative mb-6 h-[420px] overflow-hidden -mx-4 md:-mx-8 md:h-[560px]"
    >
      <img
        src={bgUrl}
        alt=""
        className={`absolute inset-0 h-full w-full object-cover object-[right_20%] transition-opacity duration-1000 ${bgLoaded ? "opacity-55" : "opacity-0"}`}
        onLoad={() => setBgLoaded(true)}
        onError={(event) => {
          (event.target as HTMLImageElement).style.display = "none";
        }}
      />

      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to right, var(--gradient-bg) 0%, var(--gradient-bg-85) 28%, var(--gradient-bg-40) 52%, transparent 78%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to top, var(--gradient-bg) 0%, var(--gradient-bg-90) 18%, var(--gradient-bg-40) 42%, transparent 72%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to bottom, var(--gradient-bg-50) 0%, transparent 28%)",
        }}
      />

      <div className="absolute inset-0 flex items-end">
        <div className="mx-auto flex w-full max-w-[1160px] items-end gap-4 px-4 pb-6 md:gap-6 md:px-8 md:pb-8">
          <div className="relative group/cover flex-shrink-0">
            <ImageLightbox src={coverUrl} alt={`${resolvedDisplayName} cover art`}>
              <div className="h-[150px] w-[150px] overflow-hidden rounded-md ring-2 ring-white/10 shadow-2xl shadow-black/50 md:h-[200px] md:w-[200px]">
                {!coverError ? (
                  <img
                    src={coverUrl}
                    alt={resolvedDisplayName}
                    className={`h-full w-full object-cover transition-opacity duration-500 ${coverLoaded ? "opacity-100" : "opacity-0"}`}
                    onLoad={() => setCoverLoaded(true)}
                    onError={() => setCoverError(true)}
                  />
                ) : null}
                {(coverError || !coverLoaded) ? (
                  <div className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/40 to-primary/20 transition-opacity duration-500 ${coverLoaded && !coverError ? "opacity-0" : "opacity-100"}`}>
                    <span className="text-5xl font-black text-white/40">{letter}</span>
                  </div>
                ) : null}
              </div>
            </ImageLightbox>
            {isAdmin ? (
              <ImageCropUpload
                endpoint={albumId != null ? `/api/artwork/albums/${albumId}/upload-cover` : ""}
                aspect={1}
                onUploaded={() => {
                  setCoverError(false);
                  setCoverLoaded(false);
                  setCoverCacheBust(String(Date.now()));
                }}
                className="absolute bottom-2 right-2 z-20 inline-flex items-center gap-1 rounded-md border border-white/15 bg-black/60 px-2 py-1.5 text-xs font-medium text-white/75 opacity-0 shadow-lg shadow-black/30 transition-all duration-200 group-hover/cover:translate-y-0 group-hover/cover:opacity-100 hover:bg-black/80 hover:text-white"
              />
            ) : null}
          </div>

          <div className="min-w-0 flex-1 pb-1">
            <div className="mb-2 text-xs text-white/40">
              <Link to="/browse" className="transition-colors hover:text-white/70">Browse</Link>
              <span className="mx-1.5">/</span>
              <Link
                to={artistPagePath({ artistId, artistSlug, artistName: artist })}
                className="transition-colors hover:text-white/70"
              >
                {artist}
              </Link>
              <span className="mx-1.5">/</span>
              <span className="text-white/60">{resolvedDisplayName}</span>
            </div>

            <h1 className="mb-1.5 truncate text-xl font-black leading-none tracking-tight text-white md:text-4xl">
              {resolvedDisplayName}
            </h1>
            <Link
              to={artistPagePath({ artistId, artistSlug, artistName: artist })}
              className="text-base text-white/60 transition-colors hover:text-white"
            >
              {displayArtist}
            </Link>

            <div className="mb-3 mt-3 flex flex-wrap items-center gap-4 text-sm text-white/50">
              {albumTags.year ? <span className="font-medium text-white/72">{albumTags.year}</span> : null}
              <span className="flex items-center gap-1.5"><Disc3 size={14} />{trackCount} tracks</span>
              <span className="flex items-center gap-1.5"><Clock size={14} />{formatDuration(totalLengthSec)}</span>
              <span className="flex items-center gap-1.5"><HardDrive size={14} />{formatSize(totalSizeMb)}</span>
            </div>

            {popularityPercent > 0 ? (
              <div className="mb-3 flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs text-white/40">
                  <TrendingUp size={13} />
                  Popularity
                </span>
                <div className="h-1.5 w-[72px] overflow-hidden rounded-sm bg-white/10">
                  <div
                    className="h-full rounded-sm"
                    style={{ width: `${popularityPercent}%`, background: "linear-gradient(90deg, #06b6d433, #06b6d4)" }}
                  />
                </div>
                <span className="text-xs text-white/40">{popularityPercent}%</span>
              </div>
            ) : null}

            {genreProfile && genreProfile.length > 0 ? (
              <GenrePillRow items={genreProfile} max={6} className="mb-3" />
            ) : null}

            <div className="mb-4 flex flex-wrap gap-2">
              {hasCover ? (
                <CratePill icon={Music}>Cover</CratePill>
              ) : (
                <CratePill active>No cover</CratePill>
              )}
              {albumTags.musicbrainz_albumid ? (
                <CratePill>MBID {albumTags.musicbrainz_albumid.slice(0, 8)}</CratePill>
              ) : (
                <CratePill active>No MBID</CratePill>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="default"
                onClick={handleEnrich}
                disabled={analyzing}
              >
                {analyzing ? (
                  <>
                    <Loader2 size={14} className="mr-1 animate-spin" />
                    Enriching...
                  </>
                ) : (
                  <>
                    <BrainCircuit size={14} className="mr-1" />
                    Enrich
                  </>
                )}
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={albumId != null ? `/api/albums/${albumId}/download` : "#"} download>
                  <Download size={14} className="mr-1" />
                  Download
                </a>
              </Button>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
