import { Link } from "react-router";

import { ImageCropUpload } from "@/components/ImageCropUpload";
import { Button } from "@/components/ui/button";
import { encPath, formatCompact, formatNumber, formatSize } from "@/lib/utils";
import {
  Calendar,
  Disc3,
  ExternalLink,
  HardDrive,
  Headphones,
  MapPin,
  Music,
  Play,
  Radio,
  AudioWaveform,
  RefreshCw,
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
  letter: string;
  albumCount: number;
  totalTracks: number;
  totalSizeMb: number;
  issueCount?: number;
  musicbrainz?: ArtistHeroMusicBrainz;
  lastfmListeners?: number;
  upcomingShow?: ArtistShowEvent;
  popularityScore: number;
  tags: string[];
  navidromeUrl?: string;
  topTracksAvailable: boolean;
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
  onPlayTopTracks: () => void;
  onPlayRadio: () => void;
  onEnrich: () => void;
  onAnalyze: () => void;
  onRepair: () => void;
  onDelete: () => void;
}

export function ArtistHeroSection({
  artistName,
  letter,
  albumCount,
  totalTracks,
  totalSizeMb,
  issueCount,
  musicbrainz,
  lastfmListeners,
  upcomingShow,
  popularityScore,
  tags,
  navidromeUrl,
  topTracksAvailable,
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
  onPlayTopTracks,
  onPlayRadio,
  onEnrich,
  onAnalyze,
  onRepair,
  onDelete,
}: ArtistHeroSectionProps) {
  return (
    <div
      className="relative h-[420px] md:h-[560px] overflow-hidden -mx-4 md:-mx-8 group/hero"
      style={{ width: "calc(100vw - var(--sidebar-w, 0px))" }}
    >
      <img
        key={bgCacheBust || "bg"}
        src={`/api/artist/${encPath(artistName)}/background?random=true${bgCacheBust ? `&t=${bgCacheBust}` : ""}`}
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

      <ImageCropUpload
        endpoint={`/api/artwork/upload-background/${encPath(artistName)}`}
        aspect={21 / 9}
        onUploaded={onBackgroundUploaded}
        className="absolute top-16 right-4 z-30 p-2 rounded-lg bg-black/50 text-white/60 hover:text-white hover:bg-black/70 opacity-0 group-hover/hero:opacity-100 transition-opacity cursor-pointer"
      />

      <div className="absolute inset-0 flex items-end">
        <div className="flex items-end gap-4 md:gap-6 w-full max-w-[1100px] px-4 md:px-8 pb-6 md:pb-8">
          <div className="relative group/photo w-[150px] h-[150px] md:w-[200px] md:h-[200px] rounded-xl overflow-hidden flex-shrink-0 ring-2 ring-white/10 shadow-2xl shadow-black/50">
            {!photoError ? (
              <img
                key={photoCacheBust || "photo"}
                src={`/api/artist/${encPath(artistName)}/photo?random=true${photoCacheBust ? `&t=${photoCacheBust}` : ""}`}
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
            <ImageCropUpload
              endpoint={`/api/artwork/upload-artist-photo/${encPath(artistName)}`}
              aspect={1}
              onUploaded={onPhotoUploaded}
              className="absolute bottom-1 right-1 p-1.5 rounded-md bg-black/60 text-white/70 hover:text-white hover:bg-black/80 opacity-0 group-hover/photo:opacity-100 transition-opacity"
            />
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
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-300 hover:bg-orange-500/20 transition-colors text-xs mb-2"
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
                <div className="w-[60px] h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${popularityScore}%`, background: "linear-gradient(90deg, #06b6d433, #06b6d4)" }}
                  />
                </div>
                <span className="text-xs text-white/40">{popularityScore}%</span>
              </div>
            )}

            {tags.length > 0 && (
              <div className="hidden md:flex gap-1.5 flex-wrap mb-3">
                {tags.slice(0, 8).map((tag) => (
                  <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-white/8 text-white/60 border border-white/10">
                    {tag.toLowerCase()}
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              {topTracksAvailable && (
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/80 text-primary-foreground"
                  onClick={onPlayTopTracks}
                >
                  <Play size={14} className="mr-1 fill-current" /> Play Top Tracks
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="border-white/20 text-white/70 hover:text-white hover:bg-white/10"
                onClick={onPlayRadio}
              >
                <Radio size={14} className="mr-1" /> Artist Radio
              </Button>
              {navidromeUrl && (
                <Button size="sm" variant="outline" className="border-white/20 text-white/70 hover:text-white hover:bg-white/10" asChild>
                  <a href={navidromeUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={14} className="mr-1" /> Navidrome
                  </a>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="border-white/20 text-white/70 hover:text-white hover:bg-white/10"
                disabled={enriching}
                onClick={onEnrich}
              >
                <RefreshCw size={14} className={`mr-1 ${enriching ? "animate-spin" : ""}`} /> {enriching ? "Enriching..." : "Enrich"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-white/20 text-white/70 hover:text-white hover:bg-white/10"
                onClick={onAnalyze}
              >
                <AudioWaveform size={14} className="mr-1" /> Analyze
              </Button>
              {(issueCount ?? 0) > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-500/30 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                  onClick={onRepair}
                >
                  <Wrench size={14} className="mr-1" /> Repair ({issueCount})
                </Button>
              )}
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-500/30 text-red-400 hover:text-red-300 hover:bg-red-500/10"
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
