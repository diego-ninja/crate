import { useState, useMemo } from "react";
import { useApi } from "@/hooks/use-api";
import { useNavigate } from "react-router";
import { encPath, cn, formatCompact } from "@/lib/utils";
import { Compass, ChevronDown, ChevronRight, ExternalLink, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";

interface MissingAlbum {
  title: string;
  type: string;
  year: string;
}

interface ArtistCompleteness {
  artist: string;
  has_photo: boolean;
  listeners: number;
  local_count: number;
  mb_count: number;
  pct: number;
  missing: MissingAlbum[];
}

type SortKey = "pct" | "name" | "listeners";

function pctColor(pct: number): string {
  if (pct >= 100) return "bg-green-500";
  if (pct > 75) return "bg-primary";
  if (pct > 50) return "bg-yellow-500";
  return "bg-red-500";
}

function pctTextColor(pct: number): string {
  if (pct >= 100) return "text-green-500";
  if (pct > 75) return "text-primary";
  if (pct > 50) return "text-yellow-500";
  return "text-red-500";
}

function ArtistRow({ artist }: { artist: ArtistCompleteness }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full overflow-hidden bg-secondary flex-shrink-0 flex items-center justify-center">
          <img
            src={`/api/artist/${encPath(artist.artist)}/photo`}
            alt={artist.artist}
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <User size={20} className="text-muted-foreground absolute" style={{ display: artist.has_photo ? "none" : undefined }} />
        </div>

        <div className="flex-1 min-w-0">
          <button
            onClick={() => navigate(`/artist/${encPath(artist.artist)}`)}
            className="text-sm font-medium hover:text-primary transition-colors truncate block"
          >
            {artist.artist}
          </button>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", pctColor(artist.pct))}
                style={{ width: `${Math.min(artist.pct, 100)}%` }}
              />
            </div>
            <span className={cn("text-xs font-medium tabular-nums", pctTextColor(artist.pct))}>
              {artist.local_count}/{artist.mb_count} ({Math.round(artist.pct)}%)
            </span>
          </div>
        </div>

        {artist.listeners > 0 && (
          <span className="text-[11px] text-muted-foreground tabular-nums hidden sm:block">
            {formatCompact(artist.listeners)} listeners
          </span>
        )}

        {artist.missing.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </Button>
        )}
      </div>

      {expanded && artist.missing.length > 0 && (
        <div className="mt-3 pl-15 space-y-1">
          <div className="text-xs text-muted-foreground mb-2">
            Missing albums ({artist.missing.length}):
          </div>
          {artist.missing.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground w-10">{m.year || "?"}</span>
              <span className="flex-1 truncate">{m.title}</span>
              <span className="text-muted-foreground">{m.type}</span>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="mt-2 text-xs h-7"
            onClick={() => navigate(`/download?q=${encodeURIComponent(artist.artist)}`)}
          >
            <ExternalLink size={12} className="mr-1" />
            Download Missing from Tidal
          </Button>
        </div>
      )}
    </div>
  );
}

export function Discover() {
  const { data, loading, error, refetch } = useApi<ArtistCompleteness[]>("/api/discover/completeness");
  const [showComplete, setShowComplete] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>("pct");

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = showComplete ? data : data.filter((a) => a.pct < 100);
    list = [...list].sort((a, b) => {
      if (sortBy === "pct") return a.pct - b.pct;
      if (sortBy === "name") return a.artist.localeCompare(b.artist);
      return b.listeners - a.listeners;
    });
    return list;
  }, [data, showComplete, sortBy]);

  const completeCount = data?.filter((a) => a.pct >= 100).length ?? 0;

  if (error) return <ErrorState message="Failed to load completeness data" onRetry={refetch} />;
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Compass size={24} className="text-primary" />
        <h1 className="text-2xl font-bold">Discover</h1>
      </div>

      {data && (
        <p className="text-sm text-muted-foreground mb-4">
          {data.length} artists analyzed, {completeCount} with complete discography
        </p>
      )}

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Button
          variant={showComplete ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowComplete(!showComplete)}
        >
          {showComplete ? "Hide Complete" : "Show Complete"}
        </Button>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          Sort:
          {(["pct", "name", "listeners"] as SortKey[]).map((key) => (
            <Button
              key={key}
              variant={sortBy === key ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSortBy(key)}
            >
              {key === "pct" ? "Completeness" : key === "name" ? "Name" : "Listeners"}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {filtered.map((a) => (
          <ArtistRow key={a.artist} artist={a} />
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No artists to display
          </div>
        )}
      </div>
    </div>
  );
}
