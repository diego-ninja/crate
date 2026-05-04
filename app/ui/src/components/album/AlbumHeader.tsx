import { useState } from "react";
import { Link } from "react-router";
import {
  BrainCircuit,
  Disc3,
  Download,
  Archive,
  FileJson,
  HardDrive,
  Loader2,
  Music,
  Clock,
  Tags,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

import { ImageLightbox } from "@crate/ui/primitives/ImageLightbox";
import { Button } from "@crate/ui/shadcn/button";
import { CratePill } from "@crate/ui/primitives/CrateBadge";
import { GenrePillRow, type GenreProfileItem } from "@/components/genres/GenrePill";
import { ImageCropUpload } from "@/components/ImageCropUpload";
import { api } from "@/lib/api";
import { albumActionApiPath, albumArtworkApiPath, albumCoverApiUrl, artistBackgroundApiUrl, artistPagePath } from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";
import { formatDuration, formatSize } from "@/lib/utils";

type AlbumMetadataAction = "lyrics" | "portable" | "export" | null;

interface AlbumHeaderProps {
  albumId?: number;
  albumEntityUid?: string;
  albumSlug?: string;
  artistId?: number;
  artistEntityUid?: string;
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
  onMetadataTaskQueued?: (action: Exclude<AlbumMetadataAction, null>, taskId: string) => void;
  isAdmin?: boolean;
  children?: React.ReactNode;
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message) return fallback;
  try {
    const parsed = JSON.parse(error.message) as { detail?: unknown; error?: unknown };
    const detail = parsed.detail ?? parsed.error;
    if (typeof detail === "string" && detail.trim()) return detail;
  } catch {
    // Use the original message below.
  }
  return error.message;
}

export function AlbumHeader({
  albumId,
  albumEntityUid,
  albumSlug,
  artistId,
  artistEntityUid,
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
  onMetadataTaskQueued,
  isAdmin = false,
  children,
}: AlbumHeaderProps) {
  const [coverCacheBust, setCoverCacheBust] = useState("");
  const [coverLoaded, setCoverLoaded] = useState(false);
  const [coverError, setCoverError] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [metadataAction, setMetadataAction] = useState<AlbumMetadataAction>(null);
  const [bgLoaded, setBgLoaded] = useState(false);

  const baseCoverUrl = albumCoverApiUrl({ albumId, albumEntityUid, albumSlug, artistName: artist, albumName: album });
  const coverUrl = `${baseCoverUrl}${coverCacheBust ? `${baseCoverUrl.includes("?") ? "&" : "?"}t=${coverCacheBust}` : ""}`;
  const bgUrl = artistBackgroundApiUrl({ artistId, artistEntityUid, artistSlug, artistName: artist });
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
    if (albumId == null && !albumEntityUid) {
      toast.error("Album reference missing");
      return;
    }
    setAnalyzing(true);
    try {
      const endpoint = albumActionApiPath({ albumId, albumEntityUid }, "enrich");
      if (!endpoint) throw new Error("album reference missing");
      const response = await api<{ task_id: string }>(endpoint, "POST");
      toast.success("Enriching album...");
      const task = await waitForTask(response.task_id, 120000);
      setAnalyzing(false);
      if (task.status === "completed") {
        toast.success("Album enrichment complete");
        onAnalysisComplete?.();
      } else if (task.status === "failed") {
        toast.error("Enrichment failed");
      }
    } catch {
      setAnalyzing(false);
      toast.error("Failed to start enrichment");
    }
  }

  async function queueAlbumMetadataAction(action: Exclude<AlbumMetadataAction, null>) {
    if (albumId == null && !albumEntityUid) {
      toast.error("Album reference missing");
      return;
    }

    const albumReference = {
      album_id: albumId,
      album_entity_uid: albumEntityUid,
    };

    setMetadataAction(action);
    try {
      if (action === "lyrics") {
        const response = await api<{ task_id: string }>("/api/manage/sync-lyrics", "POST", { ...albumReference, limit: 500 });
        onMetadataTaskQueued?.(action, response.task_id);
        toast.success("Lyrics sync queued");
      } else if (action === "portable") {
        const response = await api<{ task_id: string }>("/api/manage/portable-metadata", "POST", {
          ...albumReference,
          write_audio_tags: true,
          write_sidecars: true,
          limit: 1,
        });
        onMetadataTaskQueued?.(action, response.task_id);
        toast.success("Portable metadata queued");
      } else {
        const response = await api<{ task_id: string }>("/api/manage/portable-metadata/export-rich", "POST", {
          ...albumReference,
          include_audio: false,
          write_rich_tags: false,
          limit: 1,
        });
        onMetadataTaskQueued?.(action, response.task_id);
        toast.success("Rich metadata export queued");
      }
    } catch (error) {
      toast.error(apiErrorMessage(error, "Failed to queue metadata task"));
    } finally {
      setMetadataAction(null);
    }
  }

  return (
    <div
      className="relative mb-6 h-[420px] overflow-hidden -mx-4 md:-mx-8 md:h-[560px]"
    >
      <img
        src={bgUrl}
        alt=""
        className={`absolute inset-0 h-full w-full scale-[1.02] object-cover object-[right_20%] grayscale brightness-[0.48] contrast-110 transition-opacity duration-1000 ${bgLoaded ? "opacity-36" : "opacity-0"}`}
        onLoad={() => setBgLoaded(true)}
        onError={(event) => {
          (event.target as HTMLImageElement).style.display = "none";
        }}
      />
      <div className="absolute inset-0 bg-black/30" />

      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, transparent 0%, rgba(8, 10, 14, 0.14) 34%, rgba(8, 10, 14, 0.46) 60%, var(--surface-app) 100%)",
        }}
      />

      <div className="absolute inset-0 flex items-end">
        <div className="mx-auto flex w-full max-w-[1480px] items-end gap-4 px-4 pb-6 md:gap-6 md:px-8 md:pb-8">
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
                endpoint={albumArtworkApiPath({ albumId, albumEntityUid }, "upload-cover")}
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
                <a href={albumActionApiPath({ albumId, albumEntityUid }, "download") || "#"} download>
                  <Download size={14} className="mr-1" />
                  Download
                </a>
              </Button>
              {isAdmin ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void queueAlbumMetadataAction("lyrics")}
                    disabled={metadataAction !== null}
                  >
                    {metadataAction === "lyrics" ? <Loader2 size={14} className="mr-1 animate-spin" /> : <FileJson size={14} className="mr-1" />}
                    Lyrics
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void queueAlbumMetadataAction("portable")}
                    disabled={metadataAction !== null}
                  >
                    {metadataAction === "portable" ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Tags size={14} className="mr-1" />}
                    Metadata
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void queueAlbumMetadataAction("export")}
                    disabled={metadataAction !== null}
                  >
                    {metadataAction === "export" ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Archive size={14} className="mr-1" />}
                    Export
                  </Button>
                </>
              ) : null}
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
