import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { Clock, Library, Music, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

interface LocalResults {
  artists: { id?: number; slug?: string; name: string }[];
  albums: { id?: number; slug?: string; artist: string; artist_id?: number; artist_slug?: string; name: string }[];
  tracks: { title: string; artist: string; album: string; album_id?: number; album_slug?: string }[];
}

interface ResultItem {
  type: "artist" | "album" | "track";
  label: string;
  sublabel: string;
  path: string;
  imageUrl?: string;
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
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [recents, setRecents] = useState<string[]>(loadRecents);
  const navigate = useNavigate();
  const localTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const localCacheRef = useRef<Map<string, LocalResults>>(new Map());
  const wrapperRef = useRef<HTMLDivElement>(null);

  const doLocalSearch = useCallback(async (q: string) => {
    onQueryChange?.(q);
    if (q.length < 2) {
      setLocalResults(null);
      return;
    }

    const cached = localCacheRef.current.get(q.toLowerCase());
    if (cached) {
      setLocalResults(cached);
      setOpen(true);
      return;
    }

    const result = await api<LocalResults>(`/api/search?q=${encodeURIComponent(q)}`).catch(() => null);
    if (result) {
      localCacheRef.current.set(q.toLowerCase(), result);
    }
    setLocalResults(result);
    setOpen(true);
  }, [onQueryChange]);

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

  useEffect(() => {
    setSelectedIdx(-1);
  }, [localResults]);

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

  const items: ResultItem[] = [];
  if (localResults) {
    for (const artist of localResults.artists.slice(0, 4)) {
      items.push({
        type: "artist",
        label: artist.name,
        sublabel: "Artist",
        path: artistPagePath({ artistId: artist.id, artistSlug: artist.slug, artistName: artist.name }),
        imageUrl: artistPhotoApiUrl({ artistId: artist.id, artistSlug: artist.slug, artistName: artist.name }),
      });
    }
    for (const album of localResults.albums.slice(0, 4)) {
      items.push({
        type: "album",
        label: album.name,
        sublabel: album.artist,
        path: albumPagePath({ albumId: album.id, albumSlug: album.slug, artistName: album.artist, albumName: album.name }),
        imageUrl: albumCoverApiUrl({ albumId: album.id, albumSlug: album.slug, artistName: album.artist, albumName: album.name }),
      });
    }
    for (const track of (localResults.tracks ?? []).slice(0, 3)) {
      items.push({
        type: "track",
        label: track.title,
        sublabel: `${track.artist} — ${track.album}`,
        path: albumPagePath({ albumId: track.album_id, albumSlug: track.album_slug, artistName: track.artist, albumName: track.album }),
      });
    }
  }

  const showRecents = query.length === 0 && recents.length > 0;
  const navigableCount = showRecents ? recents.length : items.length;

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
        const item = items[selectedIdx];
        if (item) go(item.path);
      }
    }
  }

  function handleFocus() {
    if (query.length === 0 && recents.length > 0) {
      setRecents(loadRecents());
      setOpen(true);
      setSelectedIdx(-1);
    } else if (localResults) {
      setOpen(true);
    }
  }

  function selectRecent(q: string) {
    setQuery(q);
    setOpen(true);
  }

  const hasResults = items.length > 0;
  const showNoResults = open && query.length >= 2 && localResults && !hasResults;

  return (
    <div ref={wrapperRef} className="relative z-20">
      <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder="Search library..."
        aria-label="Search library"
        aria-autocomplete="list"
        aria-expanded={open}
        className="pl-10 h-11 text-base bg-card border-border rounded-xl"
      />

      {open && showRecents && (
        <div role="listbox" aria-label="Recent searches" className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 max-h-[70vh] overflow-y-auto">
          <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
            <Clock size={10} /> Recent
          </div>
          {recents.map((recent, i) => (
            <button
              key={`recent-${i}`}
              onClick={() => selectRecent(recent)}
              onMouseEnter={() => setSelectedIdx(i)}
              className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${i === selectedIdx ? "bg-accent" : "hover:bg-secondary"}`}
            >
              <Search size={14} className="text-muted-foreground flex-shrink-0" />
              <span className="text-sm truncate">{recent}</span>
            </button>
          ))}
        </div>
      )}

      {open && !showRecents && hasResults && (
        <div role="listbox" aria-label="Search results" className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 max-h-[70vh] overflow-y-auto">
          <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
            <Library size={10} /> In Library
          </div>
          {items.map((item, i) => (
            <button
              key={`${item.type}-${item.label}-${i}`}
              onClick={() => go(item.path)}
              onMouseEnter={() => setSelectedIdx(i)}
              className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${i === selectedIdx ? "bg-accent" : "hover:bg-secondary"}`}
            >
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt=""
                  className={`w-8 h-8 ${item.type === "artist" ? "rounded-full" : "rounded"} object-cover bg-secondary flex-shrink-0`}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
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
          ))}
        </div>
      )}

      {showNoResults && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50">
          <div className="px-4 py-3 text-sm text-muted-foreground">No results</div>
        </div>
      )}
    </div>
  );
}
