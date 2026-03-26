import { useState, useEffect, useCallback, useRef } from "react";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api } from "@/lib/api";
import { encPath, formatSize, formatCompact } from "@/lib/utils";
import { toast } from "sonner";
import {
  LayoutGrid, List, Users, Loader2,
  Check, SquareCheck, X, RefreshCw, BrainCircuit, Trash2,
} from "lucide-react";

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
  const [filters, setFilters] = useState<BrowseFilters | null>(null);
  const [artists, setArtists] = useState<ArtistItem[]>([]);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBatchDelete, setShowBatchDelete] = useState(false);

  function toggleSelect(name: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(artists.map(a => a.name)));
  }

  function clearSelection() {
    setSelected(new Set());
    setSelectMode(false);
  }

  async function batchEnrich() {
    for (const name of selected) {
      try {
        await api(`/api/artist/${encodeURIComponent(name)}/enrich`, "POST");
      } catch { /* continue */ }
    }
    toast.success(`Enrichment started for ${selected.size} artists`);
    clearSelection();
  }

  async function batchAnalyze() {
    for (const name of selected) {
      try {
        await api(`/api/analyze/artist/${encodeURIComponent(name)}`, "POST");
      } catch { /* continue */ }
    }
    toast.success(`Analysis started for ${selected.size} artists`);
    clearSelection();
  }

  async function batchDelete() {
    for (const name of selected) {
      try {
        await api(`/api/manage/artist/${encodeURIComponent(name)}/delete`, "POST", { mode: "full" });
      } catch { /* continue */ }
    }
    toast.success(`Deleted ${selected.size} artists`);
    clearSelection();
    setShowBatchDelete(false);
    // refetch from page 1
    pageRef.current = 1;
    hasMoreRef.current = true;
    fetchPage(1, true);
  }

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

  useEffect(() => {
    api<BrowseFilters>("/api/browse/filters").then(setFilters).catch(() => {});
  }, []);

  // Reset and fetch page 1 when filters change
  useEffect(() => {
    pageRef.current = 1;
    hasMoreRef.current = true;
    setArtists([]);
    fetchPage(1, true);
  }, [genre, country, decade, format, sort, view]);

  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback((page: number, reset = false) => {
    if (reset) setLoading(true);
    else setLoadingMore(true);
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
        setArtists((prev) => reset ? data.items : [...prev, ...data.items]);
        setTotal(data.total);
        hasMoreRef.current = data.items.length >= PER_PAGE;
      })
      .catch(() => {})
      .finally(() => { setLoading(false); setLoadingMore(false); });
  }, [genre, country, decade, format, sort, view]);

  // Infinite scroll: observe sentinel element
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loading && !loadingMore && hasMoreRef.current) {
          pageRef.current += 1;
          fetchPage(pageRef.current);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, loadingMore, fetchPage]);

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
          <SelectTrigger className="w-[120px] sm:w-[150px] bg-card border-border h-9 text-xs">
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

        <Button
          size="sm"
          variant={selectMode ? "default" : "outline"}
          onClick={() => { setSelectMode(!selectMode); if (selectMode) clearSelection(); }}
        >
          {selectMode ? <Check size={13} className="mr-1" /> : <SquareCheck size={13} className="mr-1" />}
          {selectMode ? "Done" : "Select"}
        </Button>

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
            <ArtistGridCard
              key={a.name}
              artist={a}
              selectMode={selectMode}
              isSelected={selected.has(a.name)}
              onClick={() => selectMode ? toggleSelect(a.name) : navigate(`/artist/${encPath(a.name)}`)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {artists.map((a) => (
            <ArtistListRow
              key={a.name}
              artist={a}
              selectMode={selectMode}
              isSelected={selected.has(a.name)}
              onClick={() => selectMode ? toggleSelect(a.name) : navigate(`/artist/${encPath(a.name)}`)}
            />
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-10 flex items-center justify-center">
        {loadingMore && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
        {!hasMoreRef.current && artists.length > 0 && (
          <span className="text-xs text-muted-foreground">{total} artists</span>
        )}
      </div>

      {selected.size > 0 && (
        <div className="fixed bottom-14 left-0 right-0 md:left-[220px] z-40 bg-card/95 backdrop-blur-md border-t border-border px-4 py-3 flex items-center gap-3 animate-in slide-in-from-bottom">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex gap-2 flex-1">
            <Button size="sm" variant="outline" onClick={batchEnrich}>
              <RefreshCw size={13} className="mr-1" /> Enrich
            </Button>
            <Button size="sm" variant="outline" onClick={batchAnalyze}>
              <BrainCircuit size={13} className="mr-1" /> Analyze
            </Button>
            <Button size="sm" variant="outline" className="text-red-500 border-red-500/30" onClick={() => setShowBatchDelete(true)}>
              <Trash2 size={13} className="mr-1" /> Delete
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={selectAll}>Select All</Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            <X size={13} /> Cancel
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={showBatchDelete}
        onOpenChange={setShowBatchDelete}
        title="Delete artists"
        description={`This will permanently delete ${selected.size} artist(s) and all their files. This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={batchDelete}
      />
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
      <SelectTrigger className="w-[120px] sm:w-[140px] bg-card border-border h-9 text-xs">
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
      <SelectTrigger className="w-[100px] sm:w-[120px] bg-card border-border h-9 text-xs">
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
  selectMode,
  isSelected,
  onClick,
}: {
  artist: ArtistItem;
  selectMode: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const letter = artist.name.charAt(0).toUpperCase();

  return (
    <div
      onClick={onClick}
      className={`bg-card border rounded-lg p-3 cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/5 ${
        isSelected ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary"
      }`}
    >
      <div className="relative w-full aspect-square rounded-lg mb-2 overflow-hidden">
        {selectMode && (
          <div className="absolute top-2 left-2 z-10">
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              isSelected ? "bg-primary border-primary" : "border-white/50 bg-black/30"
            }`}>
              {isSelected && <Check size={12} className="text-white" />}
            </div>
          </div>
        )}
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
  selectMode,
  isSelected,
  onClick,
}: {
  artist: ArtistItem;
  selectMode: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const letter = artist.name.charAt(0).toUpperCase();

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors ${
        isSelected ? "bg-primary/10" : ""
      }`}
    >
      {selectMode && (
        <div className="flex-shrink-0">
          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            isSelected ? "bg-primary border-primary" : "border-muted-foreground/40 bg-transparent"
          }`}>
            {isSelected && <Check size={12} className="text-white" />}
          </div>
        </div>
      )}
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
        {artist.genres && artist.genres.length > 0 && (
          <div className="flex gap-1 mt-0.5 flex-wrap">
            {artist.genres.slice(0, 4).map((g) => (
              <Badge key={g} variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground">
                {g.toLowerCase()}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="text-xs text-muted-foreground whitespace-nowrap">
        {artist.albums} album{artist.albums !== 1 ? "s" : ""}
      </div>
      <div className="hidden sm:block text-xs text-muted-foreground whitespace-nowrap w-16 text-right">
        {artist.tracks} tracks
      </div>
      <div className="hidden sm:block text-xs text-muted-foreground whitespace-nowrap w-16 text-right">
        {formatSize(artist.total_size_mb)}
      </div>
      {artist.listeners != null && artist.listeners > 0 && (
        <div className="hidden md:flex text-xs text-muted-foreground whitespace-nowrap w-16 text-right items-center justify-end gap-1">
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
