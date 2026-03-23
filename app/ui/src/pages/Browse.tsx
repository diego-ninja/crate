import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { encPath, formatSize, formatCompact } from "@/lib/utils";
import { LayoutGrid, List, ChevronLeft, ChevronRight, Users } from "lucide-react";

interface ArtistItem {
  name: string;
  albums: number;
  tracks: number;
  total_size_mb: number;
  has_photo: boolean;
  primary_format?: string;
  listeners?: number;
  genres?: string[];
}

interface PaginatedResponse {
  items: ArtistItem[];
  total: number;
  page: number;
  per_page: number;
}

interface FilterOption {
  name: string;
  count: number;
}

interface BrowseFilters {
  genres: FilterOption[];
  countries: FilterOption[];
  decades: string[];
  formats: FilterOption[];
}

const PER_PAGE = 60;

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "popularity", label: "Popularity" },
  { value: "albums", label: "Albums" },
  { value: "recent", label: "Recently Added" },
  { value: "size", label: "Size" },
];

export function Browse() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const genre = searchParams.get("genre") ?? "";
  const country = searchParams.get("country") ?? "";
  const decade = searchParams.get("decade") ?? "";
  const format = searchParams.get("format") ?? "";
  const sort = searchParams.get("sort") ?? "name";
  const view = (searchParams.get("view") ?? "grid") as "grid" | "list";
  const page = parseInt(searchParams.get("page") ?? "1", 10);

  const [filters, setFilters] = useState<BrowseFilters | null>(null);
  const [artists, setArtists] = useState<ArtistItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const setParam = useCallback(
    (key: string, value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== "page") next.delete("page");
        return next;
      });
    },
    [setSearchParams],
  );

  const setView = (v: "grid" | "list") => setParam("view", v === "grid" ? "" : v);
  const setPage = (p: number) => setParam("page", p > 1 ? String(p) : "");

  useEffect(() => {
    api<BrowseFilters>("/api/browse/filters").then(setFilters).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const params = new URLSearchParams();
    if (genre) params.set("genre", genre);
    if (country) params.set("country", country);
    if (decade) params.set("decade", decade);
    if (format) params.set("format", format);
    params.set("sort", sort);
    params.set("page", String(page));
    params.set("per_page", String(PER_PAGE));
    params.set("view", view);

    api<PaginatedResponse>(`/api/artists?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        setArtists(data.items);
        setTotal(data.total);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [genre, country, decade, format, sort, page, view]);

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <FilterSelect
          placeholder="Genre"
          value={genre}
          onChange={(v) => setParam("genre", v)}
          options={filters?.genres}
        />
        <FilterSelect
          placeholder="Country"
          value={country}
          onChange={(v) => setParam("country", v)}
          options={filters?.countries}
        />
        <DecadeSelect
          value={decade}
          onChange={(v) => setParam("decade", v)}
          decades={filters?.decades ?? []}
        />
        <FilterSelect
          placeholder="Format"
          value={format}
          onChange={(v) => setParam("format", v)}
          options={filters?.formats}
        />

        <Select value={sort} onValueChange={(v) => setParam("sort", v)}>
          <SelectTrigger className="w-[150px] bg-card border-border h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex border border-border rounded-md overflow-hidden ml-auto">
          <Button
            variant={view === "grid" ? "secondary" : "ghost"}
            size="icon"
            className="h-9 w-9 rounded-none"
            onClick={() => setView("grid")}
          >
            <LayoutGrid size={16} />
          </Button>
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-9 w-9 rounded-none"
            onClick={() => setView("list")}
          >
            <List size={16} />
          </Button>
        </div>
      </div>

      {/* Results count */}
      <div className="text-sm text-muted-foreground mb-3">
        {loading
          ? "Loading..."
          : `Showing ${artists.length} of ${total} artists`}
      </div>

      {/* Content */}
      {loading ? (
        view === "grid" ? (
          <GridSkeletonBlock />
        ) : (
          <ListSkeletonBlock />
        )
      ) : artists.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          No artists found
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {artists.map((a) => (
            <ArtistGridCard key={a.name} artist={a} onClick={() => navigate(`/artist/${encPath(a.name)}`)} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {artists.map((a) => (
            <ArtistListRow key={a.name} artist={a} onClick={() => navigate(`/artist/${encPath(a.name)}`)} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6 pb-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={16} />
            Prev
          </Button>
          <span className="text-sm text-muted-foreground px-3">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
            <ChevronRight size={16} />
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------- Sub-components ---------- */

function FilterSelect({
  placeholder,
  value,
  onChange,
  options,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  options?: FilterOption[];
}) {
  return (
    <Select value={value || "__all__"} onValueChange={(v) => onChange(v === "__all__" ? "" : v)}>
      <SelectTrigger className="w-[140px] bg-card border-border h-9 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">All {placeholder}s</SelectItem>
        {options?.map((o) => (
          <SelectItem key={o.name} value={o.name}>
            {o.name} ({o.count})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DecadeSelect({
  value,
  onChange,
  decades,
}: {
  value: string;
  onChange: (v: string) => void;
  decades: string[];
}) {
  return (
    <Select value={value || "__all__"} onValueChange={(v) => onChange(v === "__all__" ? "" : v)}>
      <SelectTrigger className="w-[120px] bg-card border-border h-9 text-xs">
        <SelectValue placeholder="Decade" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">All Decades</SelectItem>
        {decades.map((d) => (
          <SelectItem key={d} value={d}>
            {d}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ArtistGridCard({
  artist,
  onClick,
}: {
  artist: ArtistItem;
  onClick: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const letter = artist.name.charAt(0).toUpperCase();

  return (
    <div
      onClick={onClick}
      className="bg-card border border-border rounded-lg p-3 cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/5 hover:border-primary"
    >
      <div className="w-full aspect-square rounded-lg mb-2 overflow-hidden">
        {!imgError ? (
          <img
            src={`/api/artist/${encPath(artist.name)}/photo`}
            alt={artist.name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
            <span className="text-4xl font-bold text-primary/70">{letter}</span>
          </div>
        )}
      </div>
      <div className="font-semibold text-sm truncate">{artist.name}</div>
      <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
        <span>
          {artist.albums} album{artist.albums !== 1 ? "s" : ""}
        </span>
        {artist.primary_format && (
          <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">
            {artist.primary_format.replace(".", "").toUpperCase()}
          </Badge>
        )}
      </div>
    </div>
  );
}

function ArtistListRow({
  artist,
  onClick,
}: {
  artist: ArtistItem;
  onClick: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const letter = artist.name.charAt(0).toUpperCase();

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
    >
      <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0">
        {!imgError ? (
          <img
            src={`/api/artist/${encPath(artist.name)}/photo`}
            alt={artist.name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
            <span className="text-sm font-bold text-primary/70">{letter}</span>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{artist.name}</div>
      </div>
      <div className="text-xs text-muted-foreground whitespace-nowrap">
        {artist.albums} album{artist.albums !== 1 ? "s" : ""}
      </div>
      <div className="text-xs text-muted-foreground whitespace-nowrap w-16 text-right">
        {artist.tracks} tracks
      </div>
      <div className="text-xs text-muted-foreground whitespace-nowrap w-16 text-right">
        {formatSize(artist.total_size_mb)}
      </div>
      <div className="flex gap-1 w-40 justify-end flex-shrink-0">
        {artist.genres?.slice(0, 3).map((g) => (
          <Badge key={g} variant="outline" className="text-[10px] px-1.5 py-0">
            {g}
          </Badge>
        ))}
      </div>
      {artist.listeners != null && artist.listeners > 0 && (
        <div className="text-xs text-muted-foreground whitespace-nowrap w-16 text-right flex items-center justify-end gap-1">
          <Users size={12} />
          {formatCompact(artist.listeners)}
        </div>
      )}
    </div>
  );
}

function GridSkeletonBlock() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {Array.from({ length: 24 }, (_, i) => (
        <div key={i} className="bg-card border border-border rounded-lg p-3">
          <Skeleton className="w-full aspect-square rounded-lg mb-2" />
          <Skeleton className="h-4 w-3/4 mb-1" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function ListSkeletonBlock() {
  return (
    <div className="flex flex-col divide-y divide-border">
      {Array.from({ length: 20 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2">
          <Skeleton className="w-10 h-10 rounded-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-16 ml-auto" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
