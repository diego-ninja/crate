import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { artistGenreSlug, type ArtistData, type ArtistInfo } from "@/components/artist/artist-model";
import { AppModal, ModalBody, ModalCloseButton, ModalHeader } from "@crate-ui/primitives/AppModal";
import { api } from "@/lib/api";
import { formatCompact } from "@/lib/utils";
import { Globe, ChevronDown, ChevronUp } from "lucide-react";

interface MBMember { name: string; attributes?: string[]; begin?: string; end?: string }
interface EnrichmentData {
  lastfm?: { bio?: string; tags?: string[]; similar?: { name: string; match: number }[]; listeners?: number };
  spotify?: { followers?: number; popularity?: number };
  musicbrainz?: { country?: string; area?: string; begin_date?: string; type?: string; members?: MBMember[]; urls?: Record<string, string> };
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
  "discogs": "Discogs",
  "wikidata": "Wikidata",
  "bandcamp": "Bandcamp",
  "youtube": "YouTube",
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
    api<EnrichmentData>(`/api/artists/${artist.id}/enrichment`).then(setEnrichment).catch(() => {});
  }, [open, artist.id, enrichment]);

  const mb = enrichment?.musicbrainz;
  const members = mb?.members?.filter((m) => m.name) ?? [];
  const urls = mb?.urls ? Object.entries(mb.urls).map(([type, url]) => ({ type, url })) : [];
  const listeners = artistInfo?.listeners ?? enrichment?.lastfm?.listeners ?? 0;
  const playcount = artistInfo?.playcount ?? 0;
  const spotifyFollowers = enrichment?.spotify?.followers ?? 0;
  const spotifyPopularity = enrichment?.spotify?.popularity ?? 0;
  const displayBio = bioExpanded ? bio : bio.slice(0, 500);

  return (
    <AppModal open={open} onClose={onClose} maxWidthClassName="sm:max-w-2xl">
      <ModalHeader>
        <div className="flex items-start justify-between gap-4 px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-start gap-4">
            <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-2xl bg-white/5 shadow-xl">
              <img
                src={photoUrl}
                alt={artist.name}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold text-foreground sm:text-2xl">{artist.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {mb?.begin_date && <span>Since {mb.begin_date}</span>}
                {mb?.country && <span>{mb.area ? `${mb.area}, ${mb.country}` : mb.country}</span>}
              </div>
              {tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <button
                      key={tag}
                      className="rounded-full border border-white/10 bg-white/8 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-white/12 hover:text-white"
                      onClick={() => {
                        navigate(`/explore?genre=${encodeURIComponent(artistGenreSlug(tag))}`);
                        onClose();
                      }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <ModalCloseButton
            onClick={onClose}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
          />
        </div>
      </ModalHeader>

      <ModalBody className="max-h-[calc(92vh-124px)] px-5 py-5 sm:px-6 space-y-6">
        {/* Stats */}
        {(listeners > 0 || spotifyFollowers > 0) && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {listeners > 0 && (
              <div>
                <div className="text-xl font-bold text-white/90">{formatCompact(listeners)}</div>
                <div className="text-[11px] text-white/40">listeners</div>
              </div>
            )}
            {playcount > 0 && (
              <div>
                <div className="text-xl font-bold text-white/90">{formatCompact(playcount)}</div>
                <div className="text-[11px] text-white/40">scrobbles</div>
              </div>
            )}
            {spotifyFollowers > 0 && (
              <div>
                <div className="text-xl font-bold text-white/90">{formatCompact(spotifyFollowers)}</div>
                <div className="text-[11px] text-white/40">followers</div>
              </div>
            )}
            {spotifyPopularity > 0 && (
              <div>
                <div className="text-xl font-bold text-white/90">{spotifyPopularity}%</div>
                <div className="text-[11px] text-white/40">popularity</div>
              </div>
            )}
          </div>
        )}

        {/* Bio */}
        {bio && (
          <div>
            <p className="whitespace-pre-line text-sm leading-7 text-white/70 sm:text-[15px]">
              {displayBio}
              {!bioExpanded && bio.length > 500 && "..."}
            </p>
            {bio.length > 500 && (
              <button
                onClick={() => setBioExpanded(!bioExpanded)}
                className="mt-2 flex items-center gap-1 text-xs text-primary hover:text-primary/80"
              >
                {bioExpanded ? <><ChevronUp size={12} /> Less</> : <><ChevronDown size={12} /> More</>}
              </button>
            )}
          </div>
        )}

        {/* Members */}
        {members.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">Members</h3>
            <div className="space-y-1">
              {members.map((m, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white/80">{m.name}</span>
                    {m.attributes && m.attributes.length > 0 && (
                      <span className="text-[11px] text-white/30">{m.attributes.join(", ")}</span>
                    )}
                  </div>
                  <span className="text-[11px] text-white/25">{m.begin ?? "?"} - {m.end ?? "present"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Library stats */}
        <div className="flex gap-6 text-[11px] text-white/35">
          <span><strong className="text-white/60">{artist.albums.length}</strong> albums</span>
          <span><strong className="text-white/60">{artist.total_tracks}</strong> tracks</span>
          <span><strong className="text-white/60">{artist.total_size_mb > 1024 ? `${(artist.total_size_mb / 1024).toFixed(1)} GB` : `${artist.total_size_mb} MB`}</strong></span>
        </div>

        {/* External links */}
        {urls.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {urls.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-white/50 hover:border-white/20 hover:bg-white/5 hover:text-white/70 transition-colors"
              >
                <Globe size={11} /> {linkLabel(link.type, link.url)}
              </a>
            ))}
          </div>
        )}
      </ModalBody>
    </AppModal>
  );
}
