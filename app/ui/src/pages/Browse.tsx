import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { AdminSelect, type AdminSelectOption } from "@/components/ui/AdminSelect";
import { Button } from "@crate-ui/shadcn/button";
import { Skeleton } from "@crate-ui/shadcn/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api } from "@/lib/api";
import { artistPagePath } from "@/lib/library-routes";
import { toast } from "sonner";
import {
  LayoutGrid, List, Loader2,
  Check, SquareCheck, X, RefreshCw, BrainCircuit, Trash2,
} from "lucide-react";
import { ArtistCard } from "@/components/artist/ArtistCard";
import { ArtistRow } from "@/components/artist/ArtistRow";

interface ArtistItem {
  id?: number;
  slug?: string;
  name: string;
  albums: number;
  tracks: number;
  total_size_mb: number;
  has_photo: boolean;
  primary_format?: string;
  listeners?: number;
  genres?: string[];
  has_issues?: boolean;
}

interface PaginatedResponse {
  items: ArtistItem[];
  total: number;
  page: number;
  per_page: number;
}

interface FilterOption {
  name: string;
  count?: number;
  cnt?: number;
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
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showBatchDelete, setShowBatchDelete] = useState(false);

  function toggleSelect(artistId?: number) {
    if (artistId == null) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(artistId)) next.delete(artistId);
      else next.add(artistId);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(artists.map(a => a.id).filter((id): id is number => id != null)));
  }

  function clearSelection() {
    setSelected(new Set<number>());
    setSelectMode(false);
  }

  async function batchEnrich() {
    for (const artistId of selected) {
      try {
        await api(`/api/artists/${artistId}/enrich`, "POST");
      } catch { /* continue */ }
    }
    toast.success(`Enrichment started for ${selected.size} artists`);
    clearSelection();
  }

  async function batchAnalyze() {
    for (const artistId of selected) {
      try {
        await api(`/api/artists/${artistId}/analyze`, "POST");
      } catch { /* continue */ }
    }
    toast.success(`Analysis started for ${selected.size} artists`);
    clearSelection();
  }

  async function batchDelete() {
    let queued = 0;
    let failed = 0;

    for (const artistId of selected) {
      try {
        await api<{ task_id: string }>(`/api/manage/artists/${artistId}/delete`, "POST", { mode: "full" });
        queued += 1;
      } catch {
        failed += 1;
      }
    }

    if (queued > 0) {
      toast.success(
        `Queued deletion for ${queued} artist${queued === 1 ? "" : "s"}`,
        {
          description:
            failed > 0
              ? `${failed} request${failed === 1 ? "" : "s"} failed. Check Tasks for progress.`
              : "The worker will delete them in the background. Check Tasks for progress.",
        },
      );
    } else {
      toast.error("Failed to queue artist deletion");
    }

    clearSelection();
    setShowBatchDelete(false);
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
    const params = new URLSearchParams();
    if (country) params.set("country", country);
    if (decade) params.set("decade", decade);
    if (format) params.set("format", format);
    const query = params.toString();

    api<BrowseFilters>(`/api/browse/filters${query ? `?${query}` : ""}`)
      .then((data) => {
        setFilters(data);
        if (genre && !data.genres.some((option) => option.name === genre)) {
          setParam("genre", "");
        }
      })
      .catch(() => {});
  }, [country, decade, format, genre, setParam]);

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

  const genreOptions: AdminSelectOption[] = (filters?.genres ?? []).map((option) => ({
    value: option.name,
    label: option.name,
    count: option.count ?? option.cnt ?? 0,
  }));

  const countryOptions: AdminSelectOption[] = (filters?.countries ?? []).map((option) => ({
    value: option.name,
    label: option.name,
    count: option.count ?? option.cnt ?? 0,
  }));

  const decadeOptions: AdminSelectOption[] = (filters?.decades ?? []).map((decadeValue) => ({
    value: decadeValue,
    label: decadeValue,
  }));

  const formatOptions: AdminSelectOption[] = (filters?.formats ?? []).map((option) => ({
    value: option.name,
    label: option.name,
    count: option.count ?? option.cnt ?? 0,
  }));

  const sortOptions: AdminSelectOption[] = SORT_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <AdminSelect
          placeholder="All genres"
          value={genre}
          onChange={(nextValue) => setParam("genre", nextValue)}
          options={genreOptions}
          searchable
          searchPlaceholder="Search genres..."
        />
        <AdminSelect
          placeholder="All countries"
          value={country}
          onChange={(nextValue) => setParam("country", nextValue)}
          options={countryOptions}
          searchable
          searchPlaceholder="Search countries..."
        />
        <AdminSelect
          placeholder="All decades"
          value={decade}
          onChange={(nextValue) => setParam("decade", nextValue)}
          options={decadeOptions}
        />
        <AdminSelect
          placeholder="All formats"
          value={format}
          onChange={(nextValue) => setParam("format", nextValue)}
          options={formatOptions}
          searchable
          searchPlaceholder="Search formats..."
        />

        <AdminSelect
          placeholder="Name"
          value={sort}
          onChange={(nextValue) => setParam("sort", nextValue || "name")}
          options={sortOptions}
          allowClear={false}
          triggerClassName="min-w-[120px] max-w-[150px]"
        />

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
            <ArtistCard
              key={a.name}
              artistId={a.id}
              artistSlug={a.slug}
              name={a.name}
              albums={a.albums}
              tracks={a.tracks}
              size_mb={a.total_size_mb}
              primary_format={a.primary_format ?? ""}
              hasIssues={a.has_issues}
              selectMode={selectMode}
              isSelected={a.id != null ? selected.has(a.id) : false}
              onClick={() => selectMode ? toggleSelect(a.id) : navigate(artistPagePath({ artistId: a.id, artistSlug: a.slug, artistName: a.name }))}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {artists.map((a) => (
            <ArtistRow
              key={a.name}
              name={a.name}
              artistId={a.id}
              artistSlug={a.slug}
              albums={a.albums}
              tracks={a.tracks}
              total_size_mb={a.total_size_mb}
              listeners={a.listeners}
              genres={a.genres}
              hasIssues={a.has_issues}
              selectMode={selectMode}
              isSelected={a.id != null ? selected.has(a.id) : false}
              onClick={() => selectMode ? toggleSelect(a.id) : navigate(artistPagePath({ artistId: a.id, artistSlug: a.slug, artistName: a.name }))}
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

function GridSkeletonBlock() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {Array.from({ length: 24 }, (_, i) => (
        <div key={i} className="bg-card border border-border rounded-md p-3">
          <Skeleton className="w-full aspect-square rounded-md mb-2" />
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
          <Skeleton className="w-10 h-10 rounded-md" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-16 ml-auto" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
