import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArtistCard } from "@/components/artist/ArtistCard";
import { GridSkeleton } from "@/components/ui/grid-skeleton";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Search, Loader2, CheckSquare, Square, X } from "lucide-react";

interface ArtistItem {
  name: string;
  albums: number;
  tracks: number;
  total_size_mb: number;
  primary_format: string | null;
}

interface PaginatedResponse {
  items: ArtistItem[];
  total: number;
  page: number;
  per_page: number;
}

const PER_PAGE = 60;

export function Browse() {
  const [artists, setArtists] = useState<ArtistItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState("name");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Batch selection
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const fetchPage = useCallback(async (p: number, q: string, s: string, reset: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (reset) setLoading(true);
    else setLoadingMore(true);

    try {
      const data = await api<PaginatedResponse>(
        `/api/artists?page=${p}&per_page=${PER_PAGE}&q=${encodeURIComponent(q)}&sort=${s}`
      );
      if (controller.signal.aborted) return;

      setTotal(data.total);
      setArtists(prev => reset ? data.items : [...prev, ...data.items]);
      setHasMore(p * PER_PAGE < data.total);
      setPage(p);
    } catch {
      if (controller.signal.aborted) return;
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  // Reset on search/sort change
  useEffect(() => {
    setArtists([]);
    setPage(1);
    setHasMore(true);
    fetchPage(1, debouncedQuery, sort, true);
  }, [debouncedQuery, sort, fetchPage]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore) {
          fetchPage(page + 1, debouncedQuery, sort, false);
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, page, debouncedQuery, sort, fetchPage]);

  // Escape to exit select mode
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectMode(false);
        setSelected(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectMode]);

  const toggleSelect = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(artists.map((a) => a.name)));
  const deselectAll = () => setSelected(new Set());

  const handleBatchScan = async () => {
    try {
      await api("/api/tasks/scan", "POST", { artists: [...selected] });
      toast.success(`Scan started for ${selected.size} artists`);
      setSelectMode(false);
      setSelected(new Set());
    } catch {
      toast.error("Failed to start scan");
    }
  };

  const handleBatchCovers = async () => {
    try {
      await api("/api/tasks/batch-covers", "POST", { artists: [...selected] });
      toast.success(`Fetching covers for ${selected.size} artists`);
      setSelectMode(false);
      setSelected(new Set());
    } catch {
      toast.error("Failed to start cover fetch");
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search artists..."
            className="pl-9 bg-card border-border"
          />
        </div>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-[180px] bg-card border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name A-Z</SelectItem>
            <SelectItem value="albums">Most Albums</SelectItem>
            <SelectItem value="size">Largest</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={selectMode ? "secondary" : "outline"}
          size="sm"
          onClick={() => {
            setSelectMode(!selectMode);
            if (selectMode) setSelected(new Set());
          }}
        >
          {selectMode ? <X size={14} className="mr-1" /> : <CheckSquare size={14} className="mr-1" />}
          {selectMode ? "Cancel" : "Select"}
        </Button>
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {loading ? "Loading..." : `Showing ${artists.length} of ${total} artists`}
        </span>
      </div>

      {loading ? (
        <GridSkeleton count={24} />
      ) : artists.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {debouncedQuery ? "No artists match your search" : "No artists found"}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {artists.map((a) => (
            <div key={a.name} className="relative">
              {selectMode && (
                <button
                  className="absolute top-2 left-2 z-10"
                  onClick={(e) => { e.stopPropagation(); toggleSelect(a.name); }}
                >
                  {selected.has(a.name) ? (
                    <CheckSquare size={18} className="text-primary" />
                  ) : (
                    <Square size={18} className="text-muted-foreground" />
                  )}
                </button>
              )}
              <div
                className={selectMode && selected.has(a.name) ? "ring-2 ring-primary rounded-lg" : ""}
                onClick={selectMode ? (e) => { e.stopPropagation(); toggleSelect(a.name); } : undefined}
              >
                <ArtistCard
                  name={a.name}
                  albums={a.albums}
                  tracks={a.tracks}
                  size_mb={a.total_size_mb}
                  primary_format={a.primary_format ?? ""}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-1" />
      {loadingMore && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      )}

      {/* Floating batch action bar */}
      {selectMode && selected.size > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-card border border-border rounded-lg shadow-xl px-4 py-3 flex items-center gap-3 animate-in slide-in-from-bottom-4 duration-200">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button variant="outline" size="sm" onClick={selectAll}>Select All</Button>
          <Button variant="outline" size="sm" onClick={deselectAll}>Deselect</Button>
          <Button size="sm" onClick={handleBatchScan}>Scan Selected</Button>
          <Button size="sm" variant="secondary" onClick={handleBatchCovers}>Fetch Covers</Button>
        </div>
      )}
    </div>
  );
}
