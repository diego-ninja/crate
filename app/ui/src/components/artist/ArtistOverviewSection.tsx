import { StatCard } from "@/components/artist/ArtistPageBits";
import { MusicContextMenu } from "@/components/ui/music-context-menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { TopTrack } from "@/hooks/use-artist-data";
import { encPath, formatCompact, formatDuration } from "@/lib/utils";
import {
  BarChart3,
  Calendar,
  ChevronDown,
  ChevronUp,
  Globe,
  Headphones,
  MapPin,
  Music,
  Pause,
  Play,
  Users,
} from "lucide-react";

interface MusicBrainzMember {
  name: string;
  type?: string;
  begin?: string;
  end?: string | null;
  attributes?: string[];
}

interface MusicBrainzData {
  type?: string;
  begin_date?: string;
  country?: string;
  members?: MusicBrainzMember[];
}

interface LastfmData {
  listeners?: number;
  playcount?: number;
}

interface SpotifyData {
  followers?: number;
  popularity?: number;
}

interface ExternalLink {
  label: string;
  url: string;
  color: string;
}

interface ArtistOverviewSectionProps {
  bioText: string;
  bioExpanded: boolean;
  onToggleBioExpanded: () => void;
  topTracks: TopTrack[];
  currentTrackId?: string;
  trackPlaying: boolean;
  onPause: () => void;
  onResume: () => void;
  onPlayTopTrack: (track: TopTrack, index: number) => void;
  musicbrainz?: MusicBrainzData;
  activeMembersCount: number;
  lastfm?: LastfmData;
  spotify?: SpotifyData;
  externalLinks: ExternalLink[];
  enrichmentLoading: boolean;
}

export function ArtistOverviewSection({
  bioText,
  bioExpanded,
  onToggleBioExpanded,
  topTracks,
  currentTrackId,
  trackPlaying,
  onPause,
  onResume,
  onPlayTopTrack,
  musicbrainz,
  activeMembersCount,
  lastfm,
  spotify,
  externalLinks,
  enrichmentLoading,
}: ArtistOverviewSectionProps) {
  return (
    <div className="space-y-8">
      {bioText && (
        <div className="max-w-3xl">
          <h3 className="text-sm font-semibold text-white/70 mb-2">Biography</h3>
          <p className="text-sm text-white/60 leading-relaxed whitespace-pre-line">
            {bioExpanded ? bioText : bioText.slice(0, 400)}
            {!bioExpanded && bioText.length > 400 && "..."}
          </p>
          {bioText.length > 400 && (
            <button
              onClick={onToggleBioExpanded}
              className="text-xs text-primary hover:text-primary/80 mt-2 flex items-center gap-1"
            >
              {bioExpanded ? <><ChevronUp size={12} /> Less</> : <><ChevronDown size={12} /> More</>}
            </button>
          )}
        </div>
      )}

      {topTracks.length > 0 && (
        <div className="max-w-2xl">
          <h3 className="text-sm font-semibold text-white/70 mb-2">Top Tracks</h3>
          <div className="space-y-0.5">
            {topTracks.slice(0, 5).map((track, i) => {
              const isCurrent = currentTrackId === track.id;
              const isCurrentPlaying = isCurrent && trackPlaying;
              return (
                <MusicContextMenu
                  key={track.id}
                  type="track"
                  artist={track.artist}
                  album={track.album || ""}
                  trackId={track.id}
                  trackTitle={track.title}
                  albumCover={track.album ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}` : undefined}
                >
                  <button
                    onClick={() => {
                      if (isCurrentPlaying) onPause();
                      else if (isCurrent) onResume();
                      else onPlayTopTrack(track, i);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group text-left ${isCurrent ? "bg-white/[0.03]" : ""}`}
                  >
                    {isCurrent ? (
                      isCurrentPlaying ? <Pause size={13} className="text-primary w-5 fill-current" /> : <Play size={13} className="text-primary w-5 fill-current" />
                    ) : (
                      <>
                        <span className="w-5 text-right text-xs text-white/30 group-hover:hidden">{i + 1}</span>
                        <Play size={13} className="text-primary hidden group-hover:block w-5 fill-current" />
                      </>
                    )}
                    <span className={`flex-1 text-sm truncate ${isCurrent ? "text-primary" : "text-white/80"}`}>{track.title}</span>
                    <span className="text-xs text-white/30">{formatDuration(track.duration)}</span>
                  </button>
                </MusicContextMenu>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-white/70 mb-3">Stats</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-w-3xl">
          {musicbrainz?.type && <StatCard label="Type" value={musicbrainz.type} icon={<Users size={14} />} />}
          {musicbrainz?.begin_date && <StatCard label="Formed" value={musicbrainz.begin_date} icon={<Calendar size={14} />} />}
          {musicbrainz?.country && <StatCard label="Country" value={musicbrainz.country} icon={<MapPin size={14} />} />}
          {activeMembersCount > 0 && <StatCard label="Active Members" value={String(activeMembersCount)} icon={<Users size={14} />} />}
          {(lastfm?.listeners ?? 0) > 0 && <StatCard label="Listeners" value={formatCompact(lastfm!.listeners!)} icon={<Headphones size={14} />} />}
          {(spotify?.followers ?? 0) > 0 && <StatCard label="Followers" value={formatCompact(spotify!.followers!)} icon={<Users size={14} />} />}
          {(spotify?.popularity ?? 0) > 0 && <StatCard label="Popularity" value={`${spotify!.popularity}%`} icon={<BarChart3 size={14} />} />}
          {(lastfm?.playcount ?? 0) > 0 && <StatCard label="Scrobbles" value={formatCompact(lastfm!.playcount!)} icon={<Music size={14} />} />}
        </div>
      </div>

      {externalLinks.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white/70 mb-3">Links</h3>
          <div className="flex gap-2 flex-wrap">
            {externalLinks.map((link) => (
              <a
                key={link.label}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-white/10 hover:border-white/20 hover:bg-white/5 transition-colors ${link.color}`}
              >
                <Globe size={12} /> {link.label}
              </a>
            ))}
          </div>
        </div>
      )}

      {enrichmentLoading && (
        <div className="space-y-3 max-w-3xl">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-4 w-32" />
        </div>
      )}
    </div>
  );
}
