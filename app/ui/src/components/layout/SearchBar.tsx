import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router";
import { Search, Music, Download, Heart, Cloud, Library, Loader2, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { albumCoverApiUrl, albumPagePath, artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";
import { toast } from "sonner";

interface LocalResults {
  artists: { id?: number; slug?: string; name: string }[];
  albums: { id?: number; slug?: string; artist: string; artist_id?: number; artist_slug?: string; name: string }[];
  tracks: { title: string; artist: string; album: string; album_id?: number; album_slug?: string }[];
}

interface TidalResults {
  albums?: { id: string; title: string; artist: string; year: string; tracks: number; cover: string | null; url: string; quality: string[] }[];
  artists?: { id: string; name: string; picture: string | null }[];
  tracks?: { id: string; title: string; artist: string; album: string; duration: number; url: string }[];
}

type Source = "library" | "tidal";

interface ResultItem {
  type: "artist" | "album" | "track";
  source: Source;
  label: string;
  sublabel: string;
  path: string;
  artistName: string;
  albumName?: string;
  imageUrl?: string;
  tidalUrl?: string;
  tidalId?: string;
}

interface SearchBarProps {
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onQueryChange?: (q: string) => void;
}

const RECENTS_KEY = "search-recents";
const MAX_RECENTS = 5;

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function saveRecent(q: string) {
  const recents = loadRecents().filter((r) => r.toLowerCase() !== q.toLowerCase());
  recents.unshift(q);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
}

export function SearchBar({ inputRef, onQueryChange }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [localResults, setLocalResults] = useState<LocalResults | null>(null);
  const [tidalResults, setTidalResults] = useState<TidalResults | null>(null);
  const [tidalLoading, setTidalLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [recents, setRecents] = useState<string[]>(loadRecents);
  const navigate = useNavigate();
  const localTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const tidalTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const localCacheRef = useRef<Map<string, LocalResults>>(new Map());
  const tidalCacheRef = useRef<Map<string, TidalResults>>(new Map());
  const wrapperRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const isBrowse = location.pathname === "/browse";

  const doLocalSearch = useCallback(async (q: string) => {
    onQueryChange?.(q);
    if (q.length < 2) {
      setLocalResults(null);
      return;
    }

    const cached = localCacheRef.current.get(q.toLowerCase());
    if (cached) {
      setLocalResults(cached);
      if (!isBrowse) setOpen(true);
      return;
    }

    const result = await api<LocalResults>(`/api/search?q=${encodeURIComponent(q)}`).catch(() => null);
    if (result) {
      localCacheRef.current.set(q.toLowerCase(), result);
    }
    setLocalResults(result);
    if (!isBrowse) setOpen(true);
  }, [onQueryChange, isBrowse]);

  const doTidalSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setTidalResults(null);
      setTidalLoading(false);
      return;
    }

    const cached = tidalCacheRef.current.get(q.toLowerCase());
    if (cached) {
      setTidalResults(cached);
      setTidalLoading(false);
      return;
    }

    setTidalLoading(true);
    const result = await api<TidalResults>(`/api/tidal/search?q=${encodeURIComponent(q)}&limit=5`).catch(() => null);
    if (result) {
      tidalCacheRef.current.set(q.toLowerCase(), result);
    }
    setTidalResults(result);
    setTidalLoading(false);
  }, []);

  // Local search with 200ms debounce
  useEffect(() => {
    clearTimeout(localTimeoutRef.current);
    if (query.length < 2) {
      setLocalResults(null);
      setSelectedIdx(-1);
      if (query.length === 0) return;
    }
    localTimeoutRef.current = setTimeout(() => doLocalSearch(query), 200);
    return () => clearTimeout(localTimeoutRef.current);
  }, [query, doLocalSearch]);

  // Tidal search with 500ms debounce
  useEffect(() => {
    clearTimeout(tidalTimeoutRef.current);
    if (query.length < 2) {
      setTidalResults(null);
      setTidalLoading(false);
      return;
    }
    setTidalLoading(true);
    tidalTimeoutRef.current = setTimeout(() => doTidalSearch(query), 500);
    return () => clearTimeout(tidalTimeoutRef.current);
  }, [query, doTidalSearch]);

  // Reset selectedIdx when results change
  useEffect(() => {
    setSelectedIdx(-1);
  }, [localResults, tidalResults]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function addToRecents(q: string) {
    if (q.length < 2) return;
    saveRecent(q);
    setRecents(loadRecents());
  }

  function go(path: string) {
    addToRecents(query);
    navigate(path);
    setQuery("");
    setOpen(false);
    setSelectedIdx(-1);
  }

  async function tidalDownload(url: string, title: string) {
    addToRecents(query);
    try {
      await api("/api/tidal/download", "POST", { url, quality: "max", source: "search" });
      toast.success(`Queued: ${title}`);
    } catch {
      toast.error("Download failed");
    }
    setOpen(false);
    setQuery("");
  }

  async function tidalWishlist(item: ResultItem) {
    try {
      await api("/api/tidal/wishlist", "POST", {
        url: item.tidalUrl,
        tidal_id: item.tidalId,
        title: item.label,
        artist: item.artistName,
        content_type: item.type,
      });
      toast.success(`Wishlisted: ${item.label}`);
    } catch {
      toast.error("Failed to add to wishlist");
    }
  }

  // Build mixed items list
  const items: ResultItem[] = [];

  // Local results
  if (localResults) {
    for (const a of localResults.artists.slice(0, 4)) {
      items.push({ type: "artist", source: "library", label: a.name, sublabel: "Artist", path: artistPagePath({ artistId: a.id, artistSlug: a.slug, artistName: a.name }), artistName: a.name, imageUrl: artistPhotoApiUrl({ artistId: a.id, artistSlug: a.slug, artistName: a.name }) });
    }
    for (const a of localResults.albums.slice(0, 4)) {
      items.push({ type: "album", source: "library", label: a.name, sublabel: a.artist, path: albumPagePath({ albumId: a.id, albumSlug: a.slug, artistName: a.artist, albumName: a.name }), artistName: a.artist, albumName: a.name, imageUrl: albumCoverApiUrl({ albumId: a.id, albumSlug: a.slug, artistName: a.artist, albumName: a.name }) });
    }
    for (const t of (localResults.tracks ?? []).slice(0, 3)) {
      items.push({
        type: "track",
        source: "library",
        label: t.title,
        sublabel: `${t.artist} — ${t.album}`,
        path: albumPagePath({ albumId: t.album_id, albumSlug: t.album_slug, artistName: t.artist, albumName: t.album }),
        artistName: t.artist,
        albumName: t.album,
      });
    }
  }

  // Tidal results (dedupe: skip if already in local)
  const localArtistNames = new Set(localResults?.artists.map((a) => a.name.toLowerCase()) ?? []);
  const localAlbumKeys = new Set(localResults?.albums.map((a) => `${a.artist}::${a.name}`.toLowerCase()) ?? []);

  if (tidalResults) {
    for (const a of (tidalResults.artists ?? []).slice(0, 3)) {
      if (localArtistNames.has(a.name.toLowerCase())) continue;
      items.push({ type: "artist", source: "tidal", label: a.name, sublabel: "Artist", path: `/download?q=${encodeURIComponent(a.name)}`, artistName: a.name, imageUrl: a.picture || undefined, tidalId: a.id });
    }
    for (const a of (tidalResults.albums ?? []).slice(0, 4)) {
      const key = `${a.artist}::${a.title}`.toLowerCase();
      if (localAlbumKeys.has(key)) continue;
      items.push({ type: "album", source: "tidal", label: a.title, sublabel: a.artist, path: "", artistName: a.artist, albumName: a.title, imageUrl: a.cover || undefined, tidalUrl: a.url, tidalId: a.id });
    }
    for (const t of (tidalResults.tracks ?? []).slice(0, 3)) {
      items.push({ type: "track", source: "tidal", label: t.title, sublabel: `${t.artist} — ${t.album}`, path: "", artistName: t.artist, albumName: t.album, tidalUrl: t.url, tidalId: t.id });
    }
  }

  const libraryItems = items.filter((i) => i.source === "library");
  const tidalItems = items.filter((i) => i.source === "tidal");

  // Total navigable items: recents (when showing) or search results
  const showRecents = query.length === 0 && recents.length > 0;
  const navigableCount = showRecents ? recents.length : items.length;

  function handleItemClick(item: ResultItem) {
    if (item.source === "library") {
      go(item.path);
    } else if (item.type === "artist") {
      go(item.path);
    } else if (item.type === "album" && item.tidalUrl) {
      // Don't navigate — show inline actions
    } else if (item.type === "track" && item.tidalUrl) {
      tidalDownload(item.tidalUrl, `${item.artistName} - ${item.label}`);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) return;

    if (e.key === "Escape") {
      setOpen(false);
      return;
    }

    if (navigableCount === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((prev) => (prev < navigableCount - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((prev) => (prev > 0 ? prev - 1 : navigableCount - 1));
    } else if (e.key === "Enter" && selectedIdx >= 0) {
      e.preventDefault();
      if (showRecents) {
        const recent = recents[selectedIdx];
        if (recent) {
          setQuery(recent);
          setOpen(true);
        }
      } else {
        const item = items[selectedIdx]!;
        if (item.source === "library") go(item.path);
        else if (item.type === "artist") go(item.path);
        else if (item.tidalUrl) tidalDownload(item.tidalUrl, `${item.artistName} - ${item.label}`);
      }
    }
  }

  function handleFocus() {
    if (query.length === 0 && recents.length > 0) {
      setRecents(loadRecents());
      setOpen(true);
      setSelectedIdx(-1);
    } else if (localResults || tidalResults) {
      setOpen(true);
    }
  }

  function selectRecent(q: string) {
    setQuery(q);
    setOpen(true);
  }

  const hasLocalResults = libraryItems.length > 0;
  const hasTidalResults = tidalItems.length > 0;
  const hasAnyContent = hasLocalResults || hasTidalResults || tidalLoading;
  const showNoResults = open && query.length >= 2 && localResults && !tidalLoading && !hasAnyContent;

  return (
    <div ref={wrapperRef} className="relative z-20">
      <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder="Search library & Tidal..."
        aria-label="Search library and Tidal"
        aria-autocomplete="list"
        aria-expanded={open}
        className="pl-10 h-11 text-base bg-card border-border rounded-xl"
      />

      {/* Recent searches */}
      {open && showRecents && (
        <div role="listbox" aria-label="Recent searches" className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 max-h-[70vh] overflow-y-auto">
          <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
            <Clock size={10} /> Recent
          </div>
          {recents.map((r, i) => (
            <button
              key={`recent-${i}`}
              onClick={() => selectRecent(r)}
              onMouseEnter={() => setSelectedIdx(i)}
              className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${i === selectedIdx ? "bg-accent" : "hover:bg-secondary"}`}
            >
              <Search size={14} className="text-muted-foreground flex-shrink-0" />
              <span className="text-sm truncate">{r}</span>
            </button>
          ))}
        </div>
      )}

      {/* Search results */}
      {open && !showRecents && hasAnyContent && (
        <div role="listbox" aria-label="Search results" className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 max-h-[70vh] overflow-y-auto">
          {/* Library results */}
          {hasLocalResults && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                <Library size={10} /> In Library
              </div>
              {libraryItems.map((item, i) => {
                const globalIdx = items.indexOf(item);
                return (
                  <button
                    key={`lib-${item.type}-${item.label}-${i}`}
                    onClick={() => handleItemClick(item)}
                    onMouseEnter={() => setSelectedIdx(globalIdx)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${globalIdx === selectedIdx ? "bg-accent" : "hover:bg-secondary"}`}
                  >
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" className={`w-8 h-8 ${item.type === "artist" ? "rounded-full" : "rounded"} object-cover bg-secondary flex-shrink-0`} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center flex-shrink-0">
                        <Music size={14} className="text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{item.label}</div>
                      <div className="text-xs text-muted-foreground truncate">{item.sublabel}</div>
                    </div>
                    <Badge className="text-[9px] px-1.5 py-0 bg-green-500/15 text-green-500 border-green-500/30">Library</Badge>
                  </button>
                );
              })}
            </>
          )}

          {/* Tidal loading spinner */}
          {tidalLoading && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                <Cloud size={10} /> On Tidal
              </div>
              <div className="px-3 py-3 flex items-center justify-center">
                <Loader2 size={16} className="animate-spin text-muted-foreground" />
              </div>
            </>
          )}

          {/* Tidal results */}
          {!tidalLoading && hasTidalResults && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                <Cloud size={10} /> On Tidal
              </div>
              {tidalItems.map((item, i) => {
                const globalIdx = items.indexOf(item);
                return (
                  <div
                    key={`tidal-${item.type}-${item.tidalId}-${i}`}
                    onMouseEnter={() => setSelectedIdx(globalIdx)}
                    className={`w-full px-3 py-2 flex items-center gap-3 transition-colors ${globalIdx === selectedIdx ? "bg-accent" : "hover:bg-secondary"}`}
                  >
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" className={`w-8 h-8 ${item.type === "artist" ? "rounded-full" : "rounded"} object-cover bg-secondary flex-shrink-0`} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center flex-shrink-0">
                        <Music size={14} className="text-muted-foreground" />
                      </div>
                    )}
                    <button className="flex-1 min-w-0 text-left" onClick={() => handleItemClick(item)}>
                      <div className="font-medium text-sm truncate">{item.label}</div>
                      <div className="text-xs text-muted-foreground truncate">{item.sublabel}</div>
                    </button>
                    <Badge className="text-[9px] px-1.5 py-0 bg-blue-500/15 text-blue-500 border-blue-500/30">Tidal</Badge>
                    {item.type === "album" && item.tidalUrl && (
                      <div className="flex gap-0.5 flex-shrink-0">
                        <button onClick={() => tidalWishlist(item)} className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-pink-500" title="Wishlist">
                          <Heart size={13} />
                        </button>
                        <button onClick={() => tidalDownload(item.tidalUrl!, `${item.artistName} - ${item.label}`)} className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-primary" title="Download">
                          <Download size={13} />
                        </button>
                      </div>
                    )}
                    {item.type === "track" && item.tidalUrl && (
                      <button onClick={() => tidalDownload(item.tidalUrl!, `${item.artistName} - ${item.label}`)} className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-primary" title="Download">
                        <Download size={13} />
                      </button>
                    )}
                    {item.type === "artist" && (
                      <button onClick={() => go(item.path)} className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Explore">
                        <Search size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* No results */}
      {showNoResults && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50">
          <div className="px-4 py-3 text-sm text-muted-foreground">No results</div>
        </div>
      )}
    </div>
  );
}
