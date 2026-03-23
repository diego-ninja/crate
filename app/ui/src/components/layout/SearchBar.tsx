import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router";
import { Search, Music, Download, Heart, Cloud, Library } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
// Player context not needed in search bar
import { toast } from "sonner";

interface LocalResults {
  artists: { name: string }[];
  albums: { artist: string; name: string }[];
  tracks: { title: string; artist: string; album: string }[];
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

export function SearchBar({ inputRef, onQueryChange }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [localResults, setLocalResults] = useState<LocalResults | null>(null);
  const [tidalResults, setTidalResults] = useState<TidalResults | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const navigate = useNavigate();
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const isBrowse = location.pathname === "/browse";

  const doSearch = useCallback(async (q: string) => {
    onQueryChange?.(q);
    if (q.length < 2) {
      setLocalResults(null);
      setTidalResults(null);
      setOpen(false);
      return;
    }

    // Search local + Tidal in parallel
    const [local, tidal] = await Promise.all([
      api<LocalResults>(`/api/search?q=${encodeURIComponent(q)}`).catch(() => null),
      api<TidalResults>(`/api/tidal/search?q=${encodeURIComponent(q)}&limit=5`).catch(() => null),
    ]);

    setLocalResults(local);
    setTidalResults(tidal);
    if (!isBrowse) setOpen(true);
    setSelectedIdx(-1);
  }, [onQueryChange, isBrowse]);

  useEffect(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => doSearch(query), 350);
    return () => clearTimeout(timeoutRef.current);
  }, [query, doSearch]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function go(path: string) {
    navigate(path);
    setQuery("");
    setOpen(false);
    setSelectedIdx(-1);
  }

  async function tidalDownload(url: string, title: string) {
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
      items.push({ type: "artist", source: "library", label: a.name, sublabel: "Artist", path: `/artist/${encPath(a.name)}`, artistName: a.name, imageUrl: `/api/artist/${encPath(a.name)}/photo` });
    }
    for (const a of localResults.albums.slice(0, 4)) {
      items.push({ type: "album", source: "library", label: a.name, sublabel: a.artist, path: `/album/${encPath(a.artist)}/${encPath(a.name)}`, artistName: a.artist, albumName: a.name, imageUrl: `/api/cover/${encPath(a.artist)}/${encPath(a.name)}` });
    }
    for (const t of (localResults.tracks ?? []).slice(0, 3)) {
      items.push({ type: "track", source: "library", label: t.title, sublabel: `${t.artist} — ${t.album}`, path: `/album/${encPath(t.artist)}/${encPath(t.album)}`, artistName: t.artist, albumName: t.album });
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

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((prev) => (prev < items.length - 1 ? prev + 1 : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((prev) => (prev > 0 ? prev - 1 : items.length - 1)); }
    else if (e.key === "Enter" && selectedIdx >= 0) {
      e.preventDefault();
      const item = items[selectedIdx]!;
      if (item.source === "library") go(item.path);
      else if (item.type === "artist") go(item.path);
      else if (item.tidalUrl) tidalDownload(item.tidalUrl, `${item.artistName} - ${item.label}`);
    }
    else if (e.key === "Escape") setOpen(false);
  }

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

  // Group items by source for rendering
  const libraryItems = items.filter((i) => i.source === "library");
  const tidalItems = items.filter((i) => i.source === "tidal");

  return (
    <div ref={wrapperRef} className="relative mb-6 max-w-lg z-20">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => (localResults || tidalResults) && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search library & Tidal..."
        aria-label="Search library and Tidal"
        aria-autocomplete="list"
        aria-expanded={open}
        className="pl-9 bg-card border-border"
      />
      {open && items.length > 0 && (
        <div role="listbox" aria-label="Search results" className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 max-h-[70vh] overflow-y-auto">
          {/* Library results */}
          {libraryItems.length > 0 && (
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
                    className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${globalIdx === selectedIdx ? "bg-secondary" : "hover:bg-secondary"}`}
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

          {/* Tidal results */}
          {tidalItems.length > 0 && (
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
                    className={`w-full px-3 py-2 flex items-center gap-3 transition-colors ${globalIdx === selectedIdx ? "bg-secondary" : "hover:bg-secondary"}`}
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
      {open && localResults && tidalResults && items.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50">
          <div className="px-4 py-3 text-sm text-muted-foreground">No results</div>
        </div>
      )}
    </div>
  );
}
