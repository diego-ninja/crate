import { Link } from "react-router";

import { ImageCropUpload } from "@/components/ImageCropUpload";
import { GenrePillRow, type GenreProfileItem } from "@/components/genres/GenrePill";
import { Button } from "@crate/ui/shadcn/button";
import { CratePill } from "@crate/ui/primitives/CrateBadge";
import { artistBackgroundApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";
import { formatCompact, formatNumber, formatSize } from "@/lib/utils";
import {
  Calendar,
  Disc3,
  HardDrive,
  Headphones,
  MapPin,
  Music,
  AudioWaveform,
  RefreshCw,
  FolderSync,
  Loader2,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";

import type { ArtistShowEvent } from "./ArtistShowsSection";

interface ArtistHeroMusicBrainz {
  type?: string;
  begin_date?: string;
  country?: string;
  area?: string;
}

interface ArtistHeroSectionProps {
  artistName: string;
  artistId?: number;
  artistSlug?: string;
  imageVersion?: string | null;
  letter: string;
  albumCount: number;
  totalTracks: number;
  totalSizeMb: number;
  issueCount?: number;
  isV2?: boolean;
  migrating?: boolean;
  onMigrateV2?: () => void;
  musicbrainz?: ArtistHeroMusicBrainz;
  lastfmListeners?: number;
  upcomingShow?: ArtistShowEvent;
  popularityScore: number;
  genreProfile?: GenreProfileItem[];
  tags: string[];
  enriching: boolean;
  isAdmin: boolean;
  photoLoaded: boolean;
  photoError: boolean;
  photoCacheBust: string;
  bgCacheBust: string;
  bgLoaded: boolean;
  onBackgroundLoad: () => void;
  onPhotoLoad: () => void;
  onPhotoError: () => void;
  onBackgroundUploaded: () => void;
  onPhotoUploaded: () => void;
  onEnrich: () => void;
  onAnalyze: () => void;
  onRepair: () => void;
  onDelete: () => void;
}

export function ArtistHeroSection({
  artistName,
  artistId,
  artistSlug,
  imageVersion,
  letter,
  albumCount,
  totalTracks,
  totalSizeMb,
  issueCount,
  isV2,
  migrating,
  onMigrateV2,
  musicbrainz,
  lastfmListeners,
  upcomingShow,
  popularityScore,
  genreProfile,
  tags,
  enriching,
  isAdmin,
  photoLoaded,
  photoError,
  photoCacheBust,
  bgCacheBust,
  bgLoaded,
  onBackgroundLoad,
  onPhotoLoad,
  onPhotoError,
  onBackgroundUploaded,
  onPhotoUploaded,
  onEnrich,
  onAnalyze,
  onRepair,
  onDelete,
}: ArtistHeroSectionProps) {
  const backgroundUrl = artistBackgroundApiUrl({ artistId, artistSlug, artistName }, { version: imageVersion });
  const photoUrl = artistPhotoApiUrl({ artistId, artistSlug, artistName }, { version: imageVersion });
  const backgroundSrc = `${backgroundUrl}?v=stable-hero-bg-v2${bgCacheBust ? `&t=${bgCacheBust}` : ""}`;
  const photoSrc = `${photoUrl}?v=stable-hero-photo${photoCacheBust ? `&t=${photoCacheBust}` : ""}`;

  return (
    <div
      className="relative h-[420px] overflow-hidden -mx-4 md:-mx-8 md:h-[560px] group/hero"
    >
      <img
        key={bgCacheBust || "bg"}
        src={backgroundSrc}
        alt=""
        className={`absolute inset-0 w-full h-full object-cover object-[right_20%] transition-opacity duration-1000 ${bgLoaded ? "opacity-60" : "opacity-0"}`}
        onLoad={onBackgroundLoad}
        onError={() => {}}
      />
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to right, var(--gradient-bg) 0%, var(--gradient-bg-85) 25%, var(--gradient-bg-40) 50%, transparent 75%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to top, var(--gradient-bg) 0%, var(--gradient-bg-90) 15%, var(--gradient-bg-40) 40%, transparent 70%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to bottom, var(--gradient-bg-50) 0%, transparent 30%)",
        }}
      />

      {isAdmin ? (
        <ImageCropUpload
          endpoint={artistId != null ? `/api/artwork/artists/${artistId}/upload-background` : ""}
          aspect={21 / 9}
          onUploaded={onBackgroundUploaded}
          label="Edit hero"
          className="absolute bottom-6 right-4 z-30 inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-black/65 px-3 py-2 text-xs font-medium text-white/85 shadow-lg shadow-black/30 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white md:bottom-8 md:right-8"
        />
      ) : null}

      <div className="absolute inset-0 flex items-end">
        <div className="mx-auto flex w-full max-w-[1160px] items-end gap-4 px-4 pb-6 md:gap-6 md:px-8 md:pb-8">
          <div className="relative group/photo w-[150px] h-[150px] md:w-[200px] md:h-[200px] rounded-md overflow-hidden flex-shrink-0 ring-2 ring-white/10 shadow-2xl shadow-black/50">
            {!photoError ? (
              <img
                key={photoCacheBust || "photo"}
                src={photoSrc}
                alt={artistName}
                className={`w-full h-full object-cover transition-opacity duration-500 ${photoLoaded ? "opacity-100" : "opacity-0"}`}
                onLoad={onPhotoLoad}
                onError={onPhotoError}
              />
            ) : null}
            {(photoError || !photoLoaded) && (
              <div className={`w-full h-full bg-gradient-to-br from-primary/40 to-primary/20 flex items-center justify-center ${photoLoaded && !photoError ? "hidden" : ""}`}>
                <span className="text-5xl font-black text-white/40">{letter}</span>
              </div>
            )}
            {isAdmin ? (
              <ImageCropUpload
                endpoint={artistId != null ? `/api/artwork/artists/${artistId}/upload-photo` : ""}
                aspect={1}
                onUploaded={onPhotoUploaded}
                className="absolute bottom-2 right-2 z-20 inline-flex items-center gap-1 rounded-md border border-white/15 bg-black/60 px-2 py-1.5 text-xs font-medium text-white/75 opacity-0 shadow-lg shadow-black/30 transition-all duration-200 group-hover/photo:translate-y-0 group-hover/photo:opacity-100 hover:bg-black/80 hover:text-white"
              />
            ) : null}
          </div>

          <div className="flex-1 min-w-0 pb-1">
            <div className="text-xs text-white/40 mb-2">
              <Link to="/browse" className="hover:text-white/70 transition-colors">Browse</Link>
              <span className="mx-1.5">/</span>
              <span className="text-white/60">{artistName}</span>
            </div>

            <h1 className="text-2xl md:text-5xl font-black tracking-tight text-white leading-none mb-2 truncate">
              {artistName}
            </h1>

            {(musicbrainz?.country || musicbrainz?.begin_date) && (
              <div className="hidden md:flex items-center gap-3 text-sm text-white/50 mb-2">
                {musicbrainz?.country && (
                  <span className="flex items-center gap-1"><MapPin size={13} />{musicbrainz.area ? `${musicbrainz.area}, ` : ""}{musicbrainz.country}</span>
                )}
                {musicbrainz?.begin_date && (
                  <span className="flex items-center gap-1"><Calendar size={13} />Est. {musicbrainz.begin_date}</span>
                )}
                {musicbrainz?.type && (
                  <span className="flex items-center gap-1"><Users size={13} />{musicbrainz.type}</span>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 md:gap-4 text-xs md:text-sm text-white/50 mb-2 flex-wrap">
              <span className="flex items-center gap-1.5"><Disc3 size={14} />{albumCount} albums</span>
              <span className="flex items-center gap-1.5"><Music size={14} />{formatNumber(totalTracks)} tracks</span>
              <span className="flex items-center gap-1.5"><HardDrive size={14} />{formatSize(totalSizeMb)}</span>
              {(lastfmListeners ?? 0) > 0 && (
                <span className="flex items-center gap-1.5"><Headphones size={14} />{formatCompact(lastfmListeners!)} listeners</span>
              )}
            </div>

            {upcomingShow && (
              <a
                href={upcomingShow.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-orange-500/10 border border-orange-500/20 text-orange-300 hover:bg-orange-500/20 transition-colors text-xs mb-2"
              >
                <Calendar size={13} />
                <span className="font-medium">
                  Next show: {new Date(upcomingShow.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </span>
                <span className="text-orange-300/70">
                  {upcomingShow.venue}
                  {upcomingShow.city ? ` — ${[upcomingShow.city, upcomingShow.country].filter(Boolean).join(", ")}` : ""}
                </span>
              </a>
            )}

            {popularityScore > 0 && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-white/40">Popularity</span>
                <div className="w-[60px] h-1.5 bg-white/10 rounded-md overflow-hidden">
                  <div
                    className="h-full rounded-md"
                    style={{ width: `${popularityScore}%`, background: "linear-gradient(90deg, #06b6d433, #06b6d4)" }}
                  />
                </div>
                <span className="text-xs text-white/40">{popularityScore}%</span>
              </div>
            )}

            {genreProfile && genreProfile.length > 0 ? (
              <GenrePillRow items={genreProfile} max={6} className="mb-3" />
            ) : tags.length > 0 ? (
              <div className="hidden md:flex gap-1.5 flex-wrap mb-3">
                {tags.slice(0, 8).map((tag) => (
                  <CratePill key={tag} className="text-[11px]">
                    {tag.toLowerCase()}
                  </CratePill>
                ))}
              </div>
            ) : null}

            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant="default"
                disabled={enriching}
                onClick={onEnrich}
              >
                <RefreshCw size={14} className={`mr-1 ${enriching ? "animate-spin" : ""}`} /> {enriching ? "Enriching..." : "Enrich"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onAnalyze}
              >
                <AudioWaveform size={14} className="mr-1" /> Analyze
              </Button>
              {(issueCount ?? 0) > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-amber-400 hover:bg-amber-500/10"
                  onClick={onRepair}
                >
                  <Wrench size={14} className="mr-1" /> Repair ({issueCount})
                </Button>
              )}
              {isAdmin && isV2 === false && onMigrateV2 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-cyan-400 hover:bg-cyan-500/10"
                  disabled={migrating}
                  onClick={onMigrateV2}
                >
                  {migrating
                    ? <Loader2 size={14} className="mr-1 animate-spin" />
                    : <FolderSync size={14} className="mr-1" />}
                  {migrating ? "Migrating..." : "Migrate to V2"}
                </Button>
              )}
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-400 hover:bg-red-500/10"
                  onClick={onDelete}
                >
                  <Trash2 size={14} className="mr-1" /> Delete
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
