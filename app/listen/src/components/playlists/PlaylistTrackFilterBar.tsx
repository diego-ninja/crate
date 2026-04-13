import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

interface FilterablePlaylistTrack {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
}

function normalizeFilterQuery(value: string): string[] {
  return value
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function filterPlaylistTracks<T extends FilterablePlaylistTrack>(
  tracks: T[],
  query: string,
): T[] {
  const terms = normalizeFilterQuery(query);
  if (!terms.length) return tracks;

  return tracks.filter((track) => {
    const haystack = `${track.title || ""} ${track.artist || ""} ${track.album || ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function PlaylistTrackFilterBar({
  query,
  onQueryChange,
  totalCount,
  filteredCount,
  className,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  totalCount: number;
  filteredCount: number;
  className?: string;
}) {
  const filtering = query.trim().length > 0;
  const countLabel = filtering ? `${filteredCount} of ${totalCount}` : `${totalCount}`;

  return (
    <div className={cn("flex w-full", className)}>
      <div className="relative min-w-0 flex-1">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35"
        />
        <input
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter by title, artist or album"
          className="h-11 w-full rounded-xl border border-white/10 bg-black/10 pl-10 pr-28 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/20 sm:pr-36"
        />
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium uppercase tracking-[0.18em] text-primary/85">
          {countLabel}
          <span className="ml-1 text-primary/65">tracks</span>
        </div>
        {filtering ? (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="absolute right-24 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/8 hover:text-white/75 sm:right-32"
            aria-label="Clear filter"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
