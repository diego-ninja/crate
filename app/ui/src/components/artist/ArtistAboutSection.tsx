import type {
  ArtistExternalLink,
  LastfmData,
  MusicBrainzData,
  SpotifyData,
} from "@/components/artist/artistPageTypes";
import { formatCompact, formatNumber, formatSize } from "@/lib/utils";
import { ArtistBioText } from "@crate/ui/domain/ArtistBioText";
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

function Biography({
  text,
  expanded,
  onToggle,
}: {
  text: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!text) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-white/70">Biography</h3>
      <p className="text-sm leading-relaxed text-white/60">
        <ArtistBioText text={text} maxChars={600} expanded={expanded} />
      </p>
      {text.length > 600 ? (
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

function Members({
  members,
}: {
  members: NonNullable<MusicBrainzData["members"]>;
}) {
  if (members.length === 0) return null;
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-white/70">Members</h3>
      <div className="space-y-2">
        {members.map((member) => (
          <div
            key={`${member.name}-${member.begin ?? ""}-${member.end ?? ""}`}
            className="flex items-center justify-between border-b border-white/5 py-2 last:border-0"
          >
            <div>
              <span className="text-sm text-white/80">{member.name}</span>
              {member.attributes?.length ? (
                <span className="ml-2 text-xs text-white/40">
                  {member.attributes.join(", ")}
                </span>
              ) : null}
            </div>
            <span className="text-xs text-white/30">
              {member.begin ?? "?"} - {member.end ?? "present"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Numbers({
  lastfm,
  spotify,
}: {
  lastfm?: LastfmData;
  spotify?: SpotifyData;
}) {
  const values = [
    lastfm?.listeners
      ? { value: formatCompact(lastfm.listeners), label: "listeners" }
      : null,
    spotify?.followers
      ? { value: formatCompact(spotify.followers), label: "followers" }
      : null,
    lastfm?.playcount
      ? { value: formatCompact(lastfm.playcount), label: "scrobbles" }
      : null,
    spotify?.popularity
      ? { value: `${spotify.popularity}%`, label: "popularity" }
      : null,
  ].filter((item): item is { value: string; label: string } => item !== null);

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-white/70">Numbers</h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {values.map((item) => (
          <div key={item.label}>
            <div className="text-2xl font-bold text-white/90">{item.value}</div>
            <div className="text-xs text-white/40">{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Formation({ musicbrainz }: { musicbrainz?: MusicBrainzData }) {
  if (!musicbrainz?.begin_date && !musicbrainz?.country) return null;
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-white/70">Formation</h3>
      <div className="flex gap-6 text-sm text-white/50">
        {musicbrainz.begin_date ? (
          <div>
            <span className="font-medium text-white/70">
              {musicbrainz.begin_date}
            </span>{" "}
            formed
          </div>
        ) : null}
        {musicbrainz.country ? (
          <div>
            <span className="font-medium text-white/70">
              {musicbrainz.country}
            </span>
          </div>
        ) : null}
        {musicbrainz.area ? (
          <div>
            <span className="font-medium text-white/70">
              {musicbrainz.area}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LibraryStats({
  albumCount,
  totalTracks,
  totalSizeMb,
}: Pick<
  ArtistAboutSectionProps,
  "albumCount" | "totalTracks" | "totalSizeMb"
>) {
  return (
    <div className="flex gap-6 text-sm text-white/40">
      <div>
        <span className="font-medium text-white/70">{albumCount}</span> albums
        in library
      </div>
      <div>
        <span className="font-medium text-white/70">
          {formatNumber(totalTracks)}
        </span>{" "}
        tracks
      </div>
      <div>
        <span className="font-medium text-white/70">
          {formatSize(totalSizeMb)}
        </span>
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
      <Biography
        text={bioText}
        expanded={bioExpanded}
        onToggle={onToggleBioExpanded}
      />
      <Members members={musicbrainz?.members ?? []} />
      <Numbers lastfm={lastfm} spotify={spotify} />
      <Formation musicbrainz={musicbrainz} />
      <LibraryStats
        albumCount={albumCount}
        totalTracks={totalTracks}
        totalSizeMb={totalSizeMb}
      />
      <ExternalLinks links={externalLinks} />
    </div>
  );
}
