import { useTranslation } from "react-i18next";
import { Search, X } from "@crate/ui/icons";

import { cn } from "@/lib/utils";

interface FilterablePlaylistTrack {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
}

function normalizeFilterQuery(value: string): string[] {
  return value.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

export function filterPlaylistTracks<T extends FilterablePlaylistTrack>(
  tracks: T[],
  query: string,
): T[] {
  const terms = normalizeFilterQuery(query);
  if (!terms.length) return tracks;

  return tracks.filter((track) => {
    const haystack = `${track.title || ""} ${track.artist || ""} ${
      track.album || ""
    }`.toLowerCase();
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
  const { t } = useTranslation();
  const filtering = query.trim().length > 0;
  const countLabel = filtering
    ? t("playlist.filter.filteredCount", {
        filtered: filteredCount,
        total: totalCount,
      })
    : `${totalCount}`;

  return (
    <div className={cn("flex w-full", className)}>
      <div className="relative min-w-0 flex-1">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-primary/40"
        />
        <input
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("playlist.filter.placeholder")}
          className="h-11 w-full rounded-lg border border-border-quiet bg-surface-canvas/10 pl-10 pr-28 text-base text-text-primary outline-none transition-[border-color,box-shadow] placeholder:text-text-muted focus:border-accent-action/40 focus:ring-2 focus:ring-primary/20 sm:pr-36"
        />
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium uppercase tracking-[0.18em] text-accent-action/85">
          {countLabel}
          <span className="ml-1 text-accent-action/65">
            {t("playlist.filter.tracks")}
          </span>
        </div>
        {filtering ? (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="absolute right-24 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-text-primary/8 hover:text-text-primary/75 sm:right-32"
            aria-label={t("playlist.filter.clear")}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
