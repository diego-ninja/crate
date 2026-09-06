import type { ReactNode } from "react";
import { StatCard } from "@/components/artist/ArtistPageBits";
import { ArtistBioText } from "@crate/ui/domain/ArtistBioText";
import { AIButton } from "@/components/ui/AIButton";
import type {
  ArtistExternalLink,
  LastfmData,
  MusicBrainzData,
  SpotifyData,
} from "@/components/artist/artistPageTypes";
import { MusicContextMenu } from "@/components/ui/music-context-menu";
import { Skeleton } from "@crate/ui/shadcn/skeleton";
import type { TopTrack } from "@/hooks/use-artist-data";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { formatCompact, formatDuration } from "@/lib/utils";
import {
  BarChart3,
  Calendar,
  ChevronDown,
  ChevronUp,
  Globe,
  Headphones,
  MapPin,
  Music,
  Users,
} from "lucide-react";

interface ArtistOverviewSectionProps {
  bioText: string;
  bioExpanded: boolean;
  onToggleBioExpanded: () => void;
  topTracks: TopTrack[];
  musicbrainz?: MusicBrainzData;
  activeMembersCount: number;
  lastfm?: LastfmData;
  spotify?: SpotifyData;
  externalLinks: ArtistExternalLink[];
  enrichmentLoading: boolean;
  canResearchBio?: boolean;
  onResearchBio?: () => void;
}

function Biography({
  text,
  expanded,
  canResearch,
  onToggle,
  onResearch,
}: {
  text: string;
  expanded: boolean;
  canResearch: boolean;
  onToggle: () => void;
  onResearch?: () => void;
}) {
  if (!text) return null;
  return (
    <div className="max-w-3xl">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white/70">Biography</h3>
        {canResearch && onResearch ? (
          <AIButton type="button" onClick={onResearch}>
            Research with AI
          </AIButton>
        ) : null}
      </div>
      <p className="text-sm leading-relaxed text-white/60">
        <ArtistBioText text={text} maxChars={400} expanded={expanded} />
      </p>
      {text.length > 400 ? (
        <button
          onClick={onToggle}
          className="mt-2 flex items-center gap-1 text-xs text-primary hover:text-primary/80"
        >
          {expanded ? (
            <>
              <ChevronUp size={12} /> Less
            </>
          ) : (
            <>
              <ChevronDown size={12} /> More
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}

function TopTracks({ tracks }: { tracks: TopTrack[] }) {
  if (tracks.length === 0) return null;
  return (
    <div className="max-w-2xl">
      <h3 className="mb-2 text-sm font-semibold text-white/70">Top Tracks</h3>
      <div className="space-y-0.5">
        {tracks.slice(0, 5).map((track, index) => {
          const coverUrl =
            albumCoverApiUrl({
              albumId: track.album_id,
              albumSlug: track.album_slug,
              artistName: track.artist,
              albumName: track.album,
            }) || undefined;
          return (
            <MusicContextMenu
              key={track.id}
              type="track"
              artist={track.artist}
              artistId={track.artist_id}
              artistSlug={track.artist_slug}
              album={track.album || ""}
              albumId={track.album_id}
              albumSlug={track.album_slug}
              trackId={track.id}
              trackTitle={track.title}
              albumCover={coverUrl}
            >
              <div className="group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-white/5">
                <span className="w-5 text-right text-xs text-white/30">
                  {index + 1}
                </span>
                <span className="flex-1 truncate text-sm text-white/80">
                  {track.title}
                </span>
                <span className="text-xs text-white/30">
                  {formatDuration(track.duration)}
                </span>
              </div>
            </MusicContextMenu>
          );
        })}
      </div>
    </div>
  );
}

function OverviewStats({
  musicbrainz,
  activeMembersCount,
  lastfm,
  spotify,
}: Pick<
  ArtistOverviewSectionProps,
  "musicbrainz" | "activeMembersCount" | "lastfm" | "spotify"
>) {
  type OverviewStat = { label: string; value: string; icon: ReactNode };
  const stats: (OverviewStat | null)[] = [
    musicbrainz?.type
      ? { label: "Type", value: musicbrainz.type, icon: <Users size={14} /> }
      : null,
    musicbrainz?.begin_date
      ? {
          label: "Formed",
          value: musicbrainz.begin_date,
          icon: <Calendar size={14} />,
        }
      : null,
    musicbrainz?.country
      ? {
          label: "Country",
          value: musicbrainz.country,
          icon: <MapPin size={14} />,
        }
      : null,
    activeMembersCount > 0
      ? {
          label: "Active Members",
          value: String(activeMembersCount),
          icon: <Users size={14} />,
        }
      : null,
    lastfm?.listeners
      ? {
          label: "Listeners",
          value: formatCompact(lastfm.listeners),
          icon: <Headphones size={14} />,
        }
      : null,
    spotify?.followers
      ? {
          label: "Followers",
          value: formatCompact(spotify.followers),
          icon: <Users size={14} />,
        }
      : null,
    spotify?.popularity
      ? {
          label: "Popularity",
          value: `${spotify.popularity}%`,
          icon: <BarChart3 size={14} />,
        }
      : null,
    lastfm?.playcount
      ? {
          label: "Scrobbles",
          value: formatCompact(lastfm.playcount),
          icon: <Music size={14} />,
        }
      : null,
  ];
  const visibleStats = stats.filter(
    (stat): stat is OverviewStat => stat !== null,
  );

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-white/70">Stats</h3>
      <div className="grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {visibleStats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>
    </div>
  );
}

function ExternalLinks({ links }: { links: ArtistExternalLink[] }) {
  if (links.length === 0) return null;
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-white/70">Links</h3>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-1.5 text-xs transition-colors hover:border-white/20 hover:bg-white/5 ${link.color}`}
          >
            <Globe size={12} /> {link.label}
          </a>
        ))}
      </div>
    </div>
  );
}

function EnrichmentLoading() {
  return (
    <div className="max-w-3xl space-y-3">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-4 w-32" />
    </div>
  );
}

export function ArtistOverviewSection({
  bioText,
  bioExpanded,
  onToggleBioExpanded,
  topTracks,
  musicbrainz,
  activeMembersCount,
  lastfm,
  spotify,
  externalLinks,
  enrichmentLoading,
  canResearchBio = false,
  onResearchBio,
}: ArtistOverviewSectionProps) {
  return (
    <div className="space-y-8">
      <Biography
        text={bioText}
        expanded={bioExpanded}
        canResearch={canResearchBio}
        onToggle={onToggleBioExpanded}
        onResearch={onResearchBio}
      />
      <TopTracks tracks={topTracks} />
      <OverviewStats
        musicbrainz={musicbrainz}
        activeMembersCount={activeMembersCount}
        lastfm={lastfm}
        spotify={spotify}
      />
      <ExternalLinks links={externalLinks} />
      {enrichmentLoading ? <EnrichmentLoading /> : null}
    </div>
  );
}
