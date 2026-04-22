import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { Clock, Disc, Library, Loader2, Music, Search, User, X } from "lucide-react";

import { AppPopover } from "@crate-ui/primitives/AppPopover";
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
  onQueryChange?: (query: string) => void;
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

function saveRecent(query: string) {
  const recents = loadRecents().filter((recent) => recent.toLowerCase() !== query.toLowerCase());
  recents.unshift(query);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
}

function SearchResultThumb({ item }: { item: ResultItem }) {
  if (item.imageUrl) {
    return (
      <img
        src={item.imageUrl}
        alt=""
        className={`h-8 w-8 shrink-0 object-cover bg-white/5 ${item.type === "artist" ? "rounded-md" : "rounded"}`}
        onError={(event) => {
          (event.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  if (item.type === "artist") {
    return <User size={14} className="h-8 w-8 shrink-0 rounded-md bg-white/5 p-2 text-white/30" />;
  }
  if (item.type === "album") {
    return <Disc size={14} className="h-8 w-8 shrink-0 rounded bg-white/5 p-2 text-white/30" />;
  }
  return <Music size={14} className="h-8 w-8 shrink-0 rounded bg-white/5 p-2 text-white/30" />;
}

export function SearchBar({ inputRef, onQueryChange }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [localResults, setLocalResults] = useState<LocalResults | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [recents, setRecents] = useState<string[]>(loadRecents);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const localTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const localCacheRef = useRef<Map<string, LocalResults>>(new Map());
  const wrapperRef = useRef<HTMLDivElement>(null);

  const doLocalSearch = useCallback(async (value: string) => {
    onQueryChange?.(value);
    if (value.length < 2) {
      setLocalResults(null);
      setLoading(false);
      return;
    }

    const cached = localCacheRef.current.get(value.toLowerCase());
    if (cached) {
      setLocalResults(cached);
      setOpen(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    const result = await api<LocalResults>(`/api/search?q=${encodeURIComponent(value)}`).catch(() => null);
    if (result) {
      localCacheRef.current.set(value.toLowerCase(), result);
    }
    setLocalResults(result);
    setOpen(true);
    setLoading(false);
  }, [onQueryChange]);

  useEffect(() => {
    clearTimeout(localTimeoutRef.current);
    if (query.length < 2) {
      setLocalResults(null);
      setSelectedIdx(-1);
      if (query.length === 0) setLoading(false);
      if (query.length === 0) return;
    }

    localTimeoutRef.current = setTimeout(() => {
      void doLocalSearch(query);
    }, 200);

    return () => clearTimeout(localTimeoutRef.current);
  }, [query, doLocalSearch]);

  useEffect(() => {
    setSelectedIdx(-1);
  }, [localResults]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function addToRecents(value: string) {
    if (value.length < 2) return;
    saveRecent(value);
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
    for (const track of (localResults.tracks ?? []).slice(0, 4)) {
      items.push({
        type: "track",
        label: track.title,
        sublabel: `${track.artist} — ${track.album}`,
        path: albumPagePath({ albumId: track.album_id, albumSlug: track.album_slug, artistName: track.artist, albumName: track.album }),
      });
    }
  }

  const showRecents = open && query.length === 0 && recents.length > 0;
  const showResults = open && query.length > 0 && (items.length > 0 || loading);
  const showNoResults = open && query.length >= 2 && !loading && localResults && items.length === 0;
  const navigableCount = showRecents ? recents.length : items.length;

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;

    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (navigableCount === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIdx((prev) => (prev < navigableCount - 1 ? prev + 1 : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIdx((prev) => (prev > 0 ? prev - 1 : navigableCount - 1));
    } else if (event.key === "Enter" && selectedIdx >= 0) {
      event.preventDefault();
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

  function selectRecent(value: string) {
    setQuery(value);
    setOpen(true);
  }

  return (
    <div ref={wrapperRef} className="relative flex-1 md:flex-none md:w-[420px] lg:w-[500px]">
      <div className="relative md:origin-right md:transition-transform md:duration-300 md:ease-out md:focus-within:scale-x-[1.06]">
        <div className="relative flex items-center">
          <Search size={17} className="pointer-events-none absolute left-4 text-white/40" />
          {loading ? <Loader2 size={15} className="absolute right-4 animate-spin text-white/40" /> : null}
          {!loading && query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setLocalResults(null);
                inputRef?.current?.focus();
              }}
              className="absolute right-4 text-white/30 transition-colors hover:text-white/60"
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          ) : null}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            placeholder="Search library…"
            className="h-12 w-full rounded-md border border-white/8 bg-black/25 pl-11 pr-11 text-[15px] text-white outline-none transition-[background-color,border-color,box-shadow] placeholder:text-white/40 focus:border-cyan-400/25 focus:bg-black/40 focus:shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
          />
        </div>

        {showResults ? (
          <AppPopover className="absolute left-0 right-0 top-full mt-2 max-h-80 overflow-y-auto py-1">
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40">
              In Library
            </div>
            {items.map((item, index) => (
              <button
                key={`${item.type}-${item.label}-${index}`}
                type="button"
                onClick={() => go(item.path)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                  index === selectedIdx ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                <SearchResultThumb item={item} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-white/80">{item.label}</p>
                  <p className="truncate text-[11px] text-white/40">{item.sublabel}</p>
                </div>
                <span className="shrink-0 text-[10px] capitalize text-white/20">{item.type}</span>
              </button>
            ))}
          </AppPopover>
        ) : null}

        {showRecents ? (
          <AppPopover className="absolute left-0 right-0 top-full mt-2 py-1">
            <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40">
              Recent
            </p>
            {recents.map((recent, index) => (
              <button
                key={recent}
                type="button"
                onClick={() => selectRecent(recent)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                  index === selectedIdx ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                <Clock size={12} className="shrink-0 text-white/20" />
                <span className="truncate text-[13px] text-white/60">{recent}</span>
              </button>
            ))}
          </AppPopover>
        ) : null}

        {showNoResults ? (
          <AppPopover className="absolute left-0 right-0 top-full mt-2 py-6 text-center">
            <div className="flex items-center justify-center gap-2 text-sm text-white/45">
              <Library size={14} />
              No library matches
            </div>
          </AppPopover>
        ) : null}
      </div>
    </div>
  );
}
