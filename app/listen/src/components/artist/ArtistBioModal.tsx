import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import {
  artistGenreSlug,
  type ArtistData,
  type ArtistInfo,
} from "@/components/artist/artist-model";
import {
  AppModal,
  ModalBody,
  ModalCloseButton,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import {
  GenrePillRow,
  type GenreProfileItem,
} from "@crate/ui/domain/genres/GenrePill";
import { ArtistBioText } from "@crate/ui/domain/ArtistBioText";
import { api } from "@/lib/api";
import { CrateImage } from "@/components/artwork/CrateImage";
import { openExternalUrl } from "@/lib/external-links";
import { formatCompact } from "@/lib/utils";
import { Globe, ChevronDown, ChevronUp } from "@crate/ui/icons";

interface MBMember {
  name: string;
  attributes?: string[];
  begin?: string;
  end?: string;
}
interface EnrichmentData {
  lastfm?: {
    bio?: string;
    tags?: string[];
    similar?: { name: string; match: number }[];
    listeners?: number;
  };
  spotify?: { followers?: number; popularity?: number };
  musicbrainz?: {
    country?: string;
    area?: string;
    begin_date?: string;
    type?: string;
    members?: MBMember[];
    urls?: Record<string, string>;
  };
}

interface ArtistBioModalProps {
  open: boolean;
  artist: ArtistData;
  artistInfo?: ArtistInfo;
  photoUrl: string;
  tags: string[];
  onClose: () => void;
}

const LINK_LABELS: Record<string, string> = {
  "official homepage": "Website",
  discogs: "Discogs",
  wikidata: "Wikidata",
  bandcamp: "Bandcamp",
  youtube: "YouTube",
  "social network": "Social",
  "streaming music": "Streaming",
};

function linkLabel(type: string, url: string): string {
  const lower = type.toLowerCase();
  for (const [key, label] of Object.entries(LINK_LABELS)) {
    if (lower.includes(key)) return label;
  }
  if (url.includes("bandcamp.com")) return "Bandcamp";
  if (url.includes("youtube.com")) return "YouTube";
  if (url.includes("instagram.com")) return "Instagram";
  if (url.includes("twitter.com") || url.includes("x.com")) return "X";
  if (url.includes("facebook.com")) return "Facebook";
  return type || "Link";
}

function BioStats({
  listeners,
  playcount,
  spotifyFollowers,
  spotifyPopularity,
}: {
  listeners: number;
  playcount: number;
  spotifyFollowers: number;
  spotifyPopularity: number;
}) {
  const stats = [
    listeners > 0
      ? { value: formatCompact(listeners), label: "listeners" }
      : null,
    playcount > 0
      ? { value: formatCompact(playcount), label: "scrobbles" }
      : null,
    spotifyFollowers > 0
      ? { value: formatCompact(spotifyFollowers), label: "followers" }
      : null,
    spotifyPopularity > 0
      ? { value: `${spotifyPopularity}%`, label: "popularity" }
      : null,
  ].filter((stat): stat is { value: string; label: string } => stat !== null);

  if (stats.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label}>
          <div className="text-xl font-bold text-white/90">{stat.value}</div>
          <div className="text-[11px] text-white/40">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}

function BioDescription({
  bio,
  expanded,
  onToggle,
}: {
  bio: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!bio) return null;
  return (
    <div>
      <p className="text-sm leading-7 text-white/70 sm:text-[15px]">
        <ArtistBioText text={bio} maxChars={500} expanded={expanded} />
      </p>
      {bio.length > 500 ? (
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

function MemberList({ members }: { members: MBMember[] }) {
  if (members.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
        Members
      </h3>
      <div className="space-y-1">
        {members.map((member) => (
          <div
            key={`${member.name}-${member.begin ?? ""}-${member.end ?? ""}`}
            className="flex items-center justify-between border-b border-white/5 py-1.5 last:border-0"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/80">{member.name}</span>
              {member.attributes?.length ? (
                <span className="text-[11px] text-white/30">
                  {member.attributes.join(", ")}
                </span>
              ) : null}
            </div>
            <span className="text-[11px] text-white/25">
              {member.begin ?? "?"} - {member.end ?? "present"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LibraryStats({ artist }: { artist: ArtistData }) {
  return (
    <div className="flex gap-6 text-[11px] text-white/35">
      <span>
        <strong className="text-white/60">{artist.albums.length}</strong> albums
      </span>
      <span>
        <strong className="text-white/60">{artist.total_tracks}</strong> tracks
      </span>
      <span>
        <strong className="text-white/60">
          {artist.total_size_mb > 1024
            ? `${(artist.total_size_mb / 1024).toFixed(1)} GB`
            : `${artist.total_size_mb} MB`}
        </strong>
      </span>
    </div>
  );
}

function ExternalLinks({ urls }: { urls: { type: string; url: string }[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((link) => (
        <a
          key={`${link.type}-${link.url}`}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            event.preventDefault();
            void openExternalUrl(link.url);
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-white/50 transition-colors hover:border-white/20 hover:bg-white/5 hover:text-white/70"
        >
          <Globe size={11} /> {linkLabel(link.type, link.url)}
        </a>
      ))}
    </div>
  );
}

export function ArtistBioModal({
  open,
  artist,
  artistInfo,
  photoUrl,
  tags,
  onClose,
}: ArtistBioModalProps) {
  const navigate = useNavigate();
  const bio = artistInfo?.bio ?? "";
  const [bioExpanded, setBioExpanded] = useState(false);
  const [enrichment, setEnrichment] = useState<EnrichmentData | null>(null);

  useEffect(() => {
    if (!open || !artist.id || enrichment) return;
    api<EnrichmentData>(`/api/artists/${artist.id}/enrichment`)
      .then(setEnrichment)
      .catch(() => {});
  }, [open, artist.id, enrichment]);

  const mb = enrichment?.musicbrainz;
  const members = mb?.members?.filter((member) => member.name) ?? [];
  const urls = mb?.urls
    ? Object.entries(mb.urls).map(([type, url]) => ({ type, url }))
    : [];
  const listeners = artistInfo?.listeners ?? enrichment?.lastfm?.listeners ?? 0;
  const playcount = artistInfo?.playcount ?? 0;
  const spotifyFollowers = enrichment?.spotify?.followers ?? 0;
  const spotifyPopularity = enrichment?.spotify?.popularity ?? 0;
  const genreItems: GenreProfileItem[] =
    artist.genre_profile && artist.genre_profile.length > 0
      ? artist.genre_profile
      : tags.map((tag) => ({
          name: tag,
          slug: artistGenreSlug(tag),
          source: "artist",
        }));

  return (
    <AppModal
      open={open}
      onClose={onClose}
      maxWidthClassName="sm:max-w-2xl"
      overlayClassName="bg-black/58"
      panelClassName="listen-glass-panel flex min-h-0 w-full max-w-2xl flex-col overflow-hidden border-0 sm:max-h-[92vh]"
      mobileSafeArea
    >
      <ModalHeader
        data-testid="artist-bio-header"
        className="relative top-auto z-auto border-b-0 bg-transparent backdrop-blur-none"
      >
        <div className="flex items-start justify-between gap-4 px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-start gap-4">
            <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl bg-white/5 shadow-xl">
              <CrateImage
                src={photoUrl}
                alt={artist.name}
                className="h-full w-full object-cover"
                onError={(event) => {
                  (event.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold text-foreground sm:text-2xl">
                {artist.name}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {mb?.begin_date ? <span>Since {mb.begin_date}</span> : null}
                {mb?.country ? (
                  <span>
                    {mb.area ? `${mb.area}, ${mb.country}` : mb.country}
                  </span>
                ) : null}
              </div>
              {genreItems.length > 0 ? (
                <GenrePillRow
                  items={genreItems}
                  max={3}
                  className="mt-3"
                  onSelect={(item) => {
                    navigate(
                      `/explore?genre=${encodeURIComponent(
                        item.slug || artistGenreSlug(item.name),
                      )}`,
                    );
                    onClose();
                  }}
                />
              ) : null}
            </div>
          </div>
          <ModalCloseButton
            onClick={onClose}
            className="flex-shrink-0 text-white/62 transition-[color,filter,transform] hover:-translate-y-px hover:text-primary hover:drop-shadow-[0_0_10px_rgba(34,211,238,0.34)]"
          />
        </div>
      </ModalHeader>

      <ModalBody className="flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
        <BioStats
          listeners={listeners}
          playcount={playcount}
          spotifyFollowers={spotifyFollowers}
          spotifyPopularity={spotifyPopularity}
        />
        <BioDescription
          bio={bio}
          expanded={bioExpanded}
          onToggle={() => setBioExpanded((expanded) => !expanded)}
        />
        <MemberList members={members} />
        <LibraryStats artist={artist} />
        <ExternalLinks urls={urls} />
      </ModalBody>
    </AppModal>
  );
}
