import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { useApi } from "@/hooks/use-api";
import { GridSkeleton } from "@/components/ui/grid-skeleton";
import { albumCoverApiUrl, albumPagePath } from "@/lib/library-routes";
import { Calendar, Disc3, Trophy, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { ErrorState } from "@crate/ui/primitives/ErrorState";

interface TimelineAlbum {
  id?: number;
  slug?: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  album: string;
  tracks: number;
}

type TimelineData = Record<string, TimelineAlbum[]>;

function stripYearPrefix(name: string): string {
  return name.replace(/^\d{4}\s*[-\u2013]\s*/, "");
}

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border/50 bg-card px-4 py-3">
      <Icon size={18} className="text-primary/70 flex-shrink-0" />
      <div>
        <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className="text-sm font-semibold">{value}</div>
      </div>
    </div>
  );
}

export function Timeline() {
  const { data, loading, error, refetch } = useApi<TimelineData>("/api/timeline");
  const navigate = useNavigate();
  const [expandedYear, setExpandedYear] = useState<string | null>(null);

  const { sortedYears, maxAlbums, totalAlbums, firstYear, lastYear, bestYear, bestCount } = useMemo(() => {
    if (!data) return { sortedYears: [], maxAlbums: 0, totalAlbums: 0, firstYear: "", lastYear: "", bestYear: "", bestCount: 0 };

    const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b));
    const max = Math.max(...entries.map(([, a]) => a.length));
    const total = entries.reduce((sum, [, a]) => sum + a.length, 0);
    const best = entries.reduce<[string, TimelineAlbum[]] | null>((prev, curr) => {
      if (!prev) return curr;
      return curr[1].length > prev[1].length ? curr : prev;
    }, null);

    return {
      sortedYears: entries,
      maxAlbums: max,
      totalAlbums: total,
      firstYear: entries[0]?.[0] ?? "",
      lastYear: entries[entries.length - 1]?.[0] ?? "",
      bestYear: best?.[0] ?? "",
      bestCount: best?.[1].length ?? 0,
    };
  }, [data]);

  if (error) return <ErrorState message="Failed to load timeline" onRetry={refetch} />;
  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Library Timeline</h1>
        <GridSkeleton count={6} columns="grid-cols-3" />
      </div>
    );
  }

  if (!data || Object.keys(data).length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Library Timeline</h1>
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 size={16} className="animate-spin" />
          <span>Timeline data is being computed...</span>
        </div>
      </div>
    );
  }

  const expandedData = expandedYear ? data[expandedYear] ?? [] : [];

  function toggleYear(year: string) {
    setExpandedYear((prev) => (prev === year ? null : year));
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Library Timeline</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Album releases across your library
      </p>

      {/* Stats bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard icon={Calendar} label="Year Span" value={`${firstYear} \u2014 ${lastYear}`} />
        <StatCard icon={Disc3} label="Total Albums" value={totalAlbums} />
        <StatCard icon={Trophy} label="Most Prolific" value={`${bestYear} (${bestCount} albums)`} />
      </div>

      {/* Year bars */}
      <div className="space-y-1 mb-8">
        {sortedYears.map(([year, albums]) => {
          const pct = (albums.length / maxAlbums) * 100;
          const isExpanded = expandedYear === year;
          return (
            <button
              key={year}
              onClick={() => toggleYear(year)}
              className="w-full flex items-center gap-3 group hover:bg-secondary/20 rounded px-2 py-0.5 transition-colors"
            >
              <span className="text-sm font-mono w-12 text-muted-foreground text-right flex-shrink-0">{year}</span>
              <div className="flex-1 h-6 bg-secondary/20 rounded overflow-hidden">
                <div
                  className="h-full rounded transition-all duration-300 bg-primary/60 group-hover:bg-primary/80"
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground w-20 text-right flex-shrink-0">
                {albums.length} album{albums.length !== 1 ? "s" : ""}
              </span>
              {isExpanded
                ? <ChevronUp size={16} className="text-muted-foreground flex-shrink-0 transition-transform" />
                : <ChevronDown size={16} className="text-muted-foreground flex-shrink-0 transition-transform" />
              }
            </button>
          );
        })}
      </div>

      {/* Expanded year detail */}
      {expandedYear && expandedData.length > 0 && (
        <div className="mb-8 rounded-md border border-border/50 bg-card p-4">
          <h3 className="text-lg font-semibold mb-4">
            {expandedYear} — {expandedData.length} album{expandedData.length !== 1 ? "s" : ""}
          </h3>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {expandedData.map((album, i) => (
              <button
                key={`${album.artist}-${album.album}-${i}`}
                onClick={() => navigate(albumPagePath({ albumId: album.id, albumSlug: album.slug }))}
                className="flex-shrink-0 w-[140px] group text-left"
              >
                <div className="relative w-[140px] h-[140px] rounded-md overflow-hidden bg-secondary mb-2">
                  <img
                    src={albumCoverApiUrl({ albumId: album.id, albumSlug: album.slug, artistName: album.artist, albumName: album.album })}
                    alt={album.album}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center -z-10">
                    <Disc3 size={28} className="text-primary/40" />
                  </div>
                </div>
                <div className="text-xs font-medium truncate group-hover:text-primary transition-colors">
                  {stripYearPrefix(album.album)}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">{album.artist}</div>
                <div className="text-[10px] text-muted-foreground">{album.tracks} tracks</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
