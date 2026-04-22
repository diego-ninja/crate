import type { ArtistExternalLink, LastfmData, MusicBrainzData, SpotifyData } from "@/components/artist/artistPageTypes";
import { formatCompact, formatNumber, formatSize } from "@/lib/utils";
import { ChevronDown, ChevronUp, Globe } from "lucide-react";

interface ArtistAboutSectionProps {
  bioText: string;
  bioExpanded: boolean;
  onToggleBioExpanded: () => void;
  musicbrainz?: MusicBrainzData;
  lastfm?: LastfmData;
  spotify?: SpotifyData;
  externalLinks: ArtistExternalLink[];
  albumCount: number;
  totalTracks: number;
  totalSizeMb: number;
}

export function ArtistAboutSection({
  bioText,
  bioExpanded,
  onToggleBioExpanded,
  musicbrainz,
  lastfm,
  spotify,
  externalLinks,
  albumCount,
  totalTracks,
  totalSizeMb,
}: ArtistAboutSectionProps) {
  return (
    <div className="max-w-3xl space-y-8">
      {bioText && (
        <div>
          <h3 className="text-sm font-semibold text-white/70 mb-2">Biography</h3>
          <p className="text-sm text-white/60 leading-relaxed whitespace-pre-line">
            {bioExpanded ? bioText : bioText.slice(0, 600)}
            {!bioExpanded && bioText.length > 600 && "..."}
          </p>
          {bioText.length > 600 && (
            <button
              onClick={onToggleBioExpanded}
              className="text-xs text-primary hover:text-primary/80 mt-2 flex items-center gap-1"
            >
              {bioExpanded ? <><ChevronUp size={12} /> Less</> : <><ChevronDown size={12} /> More</>}
            </button>
          )}
        </div>
      )}

      {musicbrainz?.members && musicbrainz.members.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white/70 mb-3">Members</h3>
          <div className="space-y-2">
            {musicbrainz.members.map((member, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div>
                  <span className="text-sm text-white/80">{member.name}</span>
                  {member.attributes && member.attributes.length > 0 && (
                    <span className="text-xs text-white/40 ml-2">{member.attributes.join(", ")}</span>
                  )}
                </div>
                <span className="text-xs text-white/30">
                  {member.begin ?? "?"} - {member.end ?? "present"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-white/70 mb-3">Numbers</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {(lastfm?.listeners ?? 0) > 0 && (
            <div>
              <div className="text-2xl font-bold text-white/90">{formatCompact(lastfm!.listeners!)}</div>
              <div className="text-xs text-white/40">listeners</div>
            </div>
          )}
          {(spotify?.followers ?? 0) > 0 && (
            <div>
              <div className="text-2xl font-bold text-white/90">{formatCompact(spotify!.followers!)}</div>
              <div className="text-xs text-white/40">followers</div>
            </div>
          )}
          {(lastfm?.playcount ?? 0) > 0 && (
            <div>
              <div className="text-2xl font-bold text-white/90">{formatCompact(lastfm!.playcount!)}</div>
              <div className="text-xs text-white/40">scrobbles</div>
            </div>
          )}
          {(spotify?.popularity ?? 0) > 0 && (
            <div>
              <div className="text-2xl font-bold text-white/90">{spotify!.popularity}%</div>
              <div className="text-xs text-white/40">popularity</div>
            </div>
          )}
        </div>
      </div>

      {(musicbrainz?.begin_date || musicbrainz?.country) && (
        <div>
          <h3 className="text-sm font-semibold text-white/70 mb-3">Formation</h3>
          <div className="flex gap-6 text-sm text-white/50">
            {musicbrainz?.begin_date && <div><span className="text-white/70 font-medium">{musicbrainz.begin_date}</span> formed</div>}
            {musicbrainz?.country && <div><span className="text-white/70 font-medium">{musicbrainz.country}</span></div>}
            {musicbrainz?.area && <div><span className="text-white/70 font-medium">{musicbrainz.area}</span></div>}
          </div>
        </div>
      )}

      <div className="flex gap-6 text-sm text-white/40">
        <div><span className="text-white/70 font-medium">{albumCount}</span> albums in library</div>
        <div><span className="text-white/70 font-medium">{formatNumber(totalTracks)}</span> tracks</div>
        <div><span className="text-white/70 font-medium">{formatSize(totalSizeMb)}</span></div>
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
                className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-white/10 hover:border-white/20 hover:bg-white/5 transition-colors ${link.color}`}
              >
                <Globe size={12} /> {link.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
