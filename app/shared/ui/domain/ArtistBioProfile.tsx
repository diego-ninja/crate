import { ChevronDown, ChevronUp, Globe, X } from "@crate/ui/icons";
import type { ReactNode } from "react";

import {
  ArtistBioText,
  truncateArtistBio,
} from "@crate/ui/domain/ArtistBioText";
import {
  GenrePillRow,
  type GenreProfileItem,
} from "@crate/ui/domain/genres/GenrePill";
import {
  ModalBody,
  ModalCloseButton,
  ModalHeader,
} from "@crate/ui/primitives/AppModal";
import { cn } from "@crate/ui/lib/cn";
import { formatCompact, formatSize } from "../../web/utils";

export interface ArtistBioMember {
  name: string;
  roles?: string[];
  begin?: string | null;
  end?: string | null;
}

export interface ArtistBioStats {
  listeners?: number;
  playcount?: number;
  spotifyFollowers?: number;
  spotifyPopularity?: number;
}

export interface ArtistBioLibraryStats {
  albums: number;
  tracks: number;
  sizeMb: number;
}

export interface ArtistBioExternalLink {
  type: string;
  url: string;
}

export interface ArtistBioProfileProps {
  artistName: string;
  photoUrl?: string;
  photoContent?: ReactNode;
  meta?: string[];
  genres?: GenreProfileItem[];
  bio: string;
  bioExpanded?: boolean;
  onBioToggle?: () => void;
  members?: ArtistBioMember[];
  stats?: ArtistBioStats;
  libraryStats?: ArtistBioLibraryStats;
  urls?: ArtistBioExternalLink[];
  onClose?: () => void;
  onGenreSelect?: (item: GenreProfileItem) => void;
  onExternalLink?: (url: string) => void;
  scrollableBody?: boolean;
  className?: string;
}

const EMPTY_META: string[] = [];
const EMPTY_GENRES: GenreProfileItem[] = [];
const EMPTY_MEMBERS: ArtistBioMember[] = [];
const EMPTY_URLS: ArtistBioExternalLink[] = [];
const MEMBER_MONTH_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});
const MEMBER_DAY_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

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

function formatMemberDate(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  if (!normalized) return fallback;

  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(normalized);
  if (!match) return normalized;

  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : undefined;
  const day = match[3] ? Number(match[3]) : undefined;
  if (!month) return String(year);
  if (month < 1 || month > 12 || (day !== undefined && (day < 1 || day > 31))) {
    return normalized;
  }

  const date = new Date(Date.UTC(year, month - 1, day ?? 1));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    (day !== undefined && date.getUTCDate() !== day)
  ) {
    return normalized;
  }

  return (
    day !== undefined ? MEMBER_DAY_FORMATTER : MEMBER_MONTH_FORMATTER
  ).format(date);
}

function splitBioParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function ArtistBioMembers({ members }: { members: ArtistBioMember[] }) {
  const current = members.filter((member) => !member.end);
  const former = members.filter((member) => member.end);

  if (!members.length) return null;

  return (
    <div className="space-y-5">
      {current.length > 0 ? (
        <ArtistBioMemberTable
          caption="Current members"
          members={current}
          current
        />
      ) : null}
      {former.length > 0 ? (
        <ArtistBioMemberTable caption="Former members" members={former} />
      ) : null}
    </div>
  );
}

function ArtistBioMemberTable({
  caption,
  current = false,
  members,
}: {
  caption: string;
  current?: boolean;
  members: ArtistBioMember[];
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-meta">
        {caption}
      </h3>
      <div className="overflow-x-auto rounded-lg border border-border-quiet-subtle">
        <table
          aria-label={caption}
          className="w-full min-w-[28rem] text-left text-sm"
        >
          <thead className="bg-surface-quiet-subtle text-xs uppercase tracking-wider text-text-meta">
            <tr>
              <th className="px-3 py-2 font-medium">Member</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">
                {current ? "Since" : "From"}
              </th>
              {!current ? <th className="px-3 py-2 font-medium">To</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-quiet-subtle">
            {members.map((member) => (
              <tr
                key={`${member.name}-${member.begin ?? ""}-${member.end ?? ""}`}
              >
                <td className="px-3 py-2 font-medium text-text-hero">
                  {member.name}
                </td>
                <td className="px-3 py-2 text-text-secondary">
                  {member.roles?.join(", ") || "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-text-quiet">
                  {formatMemberDate(member.begin, "Unknown")}
                </td>
                {!current ? (
                  <td className="whitespace-nowrap px-3 py-2 text-text-quiet">
                    {formatMemberDate(member.end, "Unknown")}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ArtistBioStats({ stats }: { stats?: ArtistBioStats }) {
  if (!stats) return null;
  const items = [
    [stats.listeners, "listeners"],
    [stats.playcount, "scrobbles"],
    [stats.spotifyFollowers, "followers"],
    [stats.spotifyPopularity, "popularity"],
  ].filter(([value]) => typeof value === "number" && value > 0) as [
    number,
    string,
  ][];

  if (!items.length) return null;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map(([value, label]) => (
        <div key={label}>
          <div className="text-xl font-bold text-text-hero">
            {label === "popularity" ? `${value}%` : formatCompact(value)}
          </div>
          <div className="text-xs text-text-meta">{label}</div>
        </div>
      ))}
    </div>
  );
}

function ArtistBioLibraryStats({ stats }: { stats?: ArtistBioLibraryStats }) {
  if (!stats) return null;

  return (
    <div className="flex gap-6 text-xs text-text-quiet">
      <span>
        <strong className="text-text-secondary">{stats.albums}</strong> albums
      </span>
      <span>
        <strong className="text-text-secondary">{stats.tracks}</strong> tracks
      </span>
      <span>
        <strong className="text-text-secondary">
          {formatSize(stats.sizeMb)}
        </strong>
      </span>
    </div>
  );
}

function ArtistBioExternalLinks({
  links,
  onOpen,
}: {
  links: ArtistBioExternalLink[];
  onOpen?: (url: string) => void;
}) {
  if (!links.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <a
          key={`${link.type}-${link.url}`}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={(event) => {
            if (!onOpen) return;
            event.preventDefault();
            onOpen(link.url);
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border-quiet px-2.5 py-1 text-xs text-text-muted-strong transition-colors hover:border-border-interactive hover:bg-surface-quiet-subtle hover:text-text-secondary-strong"
        >
          <Globe size={11} /> {linkLabel(link.type, link.url)}
        </a>
      ))}
    </div>
  );
}

export function ArtistBioProfile({
  artistName,
  photoUrl,
  photoContent,
  meta = EMPTY_META,
  genres = EMPTY_GENRES,
  bio,
  bioExpanded = true,
  onBioToggle,
  members = EMPTY_MEMBERS,
  stats,
  libraryStats,
  urls = EMPTY_URLS,
  onClose,
  onGenreSelect,
  onExternalLink,
  scrollableBody = true,
  className,
}: ArtistBioProfileProps) {
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <ModalHeader
        data-testid="artist-bio-header"
        className="relative top-auto z-auto shrink-0 border-b-0 bg-transparent backdrop-blur-none"
      >
        <div className="flex items-start justify-between gap-4 p-5 sm:px-6">
          <div className="flex min-w-0 items-start gap-4">
            <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-surface-quiet-subtle shadow-xl">
              {photoContent ??
                (photoUrl ? (
                  <img
                    src={photoUrl}
                    alt={artistName}
                    className="size-full object-cover"
                  />
                ) : null)}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold text-text-primary sm:text-2xl">
                {artistName}
              </h2>
              {meta.length > 0 ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
                  {meta.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              ) : null}
              <GenrePillRow
                items={genres}
                max={3}
                className="mt-3"
                onSelect={onGenreSelect}
              />
            </div>
          </div>
          {onClose ? (
            <ModalCloseButton
              onClick={onClose}
              className="shrink-0 text-text-secondary transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action-strong"
            />
          ) : (
            <X aria-hidden="true" className="invisible size-6 shrink-0" />
          )}
        </div>
      </ModalHeader>
      <ModalBody
        className={cn(
          "min-h-0 flex-1 space-y-6 p-5 sm:px-6",
          scrollableBody
            ? "overflow-y-auto overscroll-contain"
            : "overflow-visible",
        )}
      >
        <ArtistBioStats stats={stats} />
        {bio ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-meta">
              Biography
            </h3>
            <div className="space-y-4 text-sm leading-7 text-text-secondary-strong sm:text-[0.9375rem]">
              {splitBioParagraphs(
                bioExpanded ? bio : truncateArtistBio(bio, 500),
              ).map((paragraph) => (
                <p key={paragraph}>
                  <ArtistBioText text={paragraph} expanded />
                </p>
              ))}
            </div>
            {bio.length > 500 && onBioToggle ? (
              <button
                type="button"
                onClick={onBioToggle}
                className="mt-2 flex items-center gap-1 text-xs text-accent-action hover:text-accent-action-hover"
              >
                {bioExpanded ? (
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
        ) : null}
        <ArtistBioMembers members={members} />
        <ArtistBioLibraryStats stats={libraryStats} />
        <ArtistBioExternalLinks links={urls} onOpen={onExternalLink} />
      </ModalBody>
    </div>
  );
}
