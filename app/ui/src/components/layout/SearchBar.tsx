import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { Search, Play } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
import { usePlayer } from "@/contexts/PlayerContext";

interface SearchResults {
  artists: { name: string }[];
  albums: { artist: string; name: string }[];
}

interface ResultItem {
  type: "artist" | "album";
  label: string;
  sublabel: string;
  path: string;
  artistName: string;
  albumName?: string;
}

interface SearchBarProps {
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function SearchBar({ inputRef }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const navigate = useNavigate();
  const { play } = usePlayer();
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults(null);
      setOpen(false);
      return;
    }
    const data = await api<SearchResults>(
      `/api/search?q=${encodeURIComponent(q)}`,
    );
    setResults(data);
    setOpen(true);
    setSelectedIdx(-1);
  }, []);

  useEffect(() => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => search(query), 300);
    return () => clearTimeout(timeoutRef.current);
  }, [query, search]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
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

  const artistItems: ResultItem[] = [];
  const albumItems: ResultItem[] = [];
  if (results) {
    for (const a of results.artists.slice(0, 5)) {
      artistItems.push({
        type: "artist",
        label: a.name,
        sublabel: "Artist",
        path: `/artist/${encPath(a.name)}`,
        artistName: a.name,
      });
    }
    for (const a of results.albums.slice(0, 8)) {
      albumItems.push({
        type: "album",
        label: a.name,
        sublabel: a.artist,
        path: `/album/${encPath(a.artist)}/${encPath(a.name)}`,
        artistName: a.artist,
        albumName: a.name,
      });
    }
  }

  const items = [...artistItems, ...albumItems];

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((prev) => (prev < items.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((prev) => (prev > 0 ? prev - 1 : items.length - 1));
    } else if (e.key === "Enter" && selectedIdx >= 0) {
      e.preventDefault();
      go(items[selectedIdx]!.path);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function handlePlay(e: React.MouseEvent, item: ResultItem) {
    e.stopPropagation();
    if (item.type === "album" && item.albumName) {
      play({
        id: `${item.artistName}/${item.albumName}`,
        title: item.albumName,
        artist: item.artistName,
        albumCover: `/api/cover/${encPath(item.artistName)}/${encPath(item.albumName)}`,
      });
    }
  }

  return (
    <div ref={wrapperRef} className="relative mb-6 max-w-lg z-20">
      <Search
        size={16}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search artists, albums..."
        className="pl-9 bg-card border-border"
      />
      {open && items.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
          {artistItems.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Artists ({artistItems.length})
              </div>
              {artistItems.map((item, i) => (
                <button
                  key={item.path}
                  onClick={() => go(item.path)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
                    i === selectedIdx ? "bg-secondary" : "hover:bg-secondary"
                  }`}
                >
                  <img
                    src={`/api/artist/${encPath(item.artistName)}/photo`}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover bg-secondary flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{item.label}</div>
                    <div className="text-xs text-muted-foreground">Artist</div>
                  </div>
                </button>
              ))}
            </>
          )}
          {albumItems.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Albums ({albumItems.length})
              </div>
              {albumItems.map((item, rawIdx) => {
                const idx = artistItems.length + rawIdx;
                return (
                  <button
                    key={item.path}
                    onClick={() => go(item.path)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors group ${
                      idx === selectedIdx ? "bg-secondary" : "hover:bg-secondary"
                    }`}
                  >
                    <img
                      src={`/api/cover/${encPath(item.artistName)}/${encPath(item.albumName!)}`}
                      alt=""
                      className="w-8 h-8 rounded object-cover bg-secondary flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{item.label}</div>
                      <div className="text-xs text-muted-foreground truncate">{item.sublabel}</div>
                    </div>
                    <button
                      onClick={(e) => handlePlay(e, item)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-full bg-primary/20 hover:bg-primary/30 text-primary transition-all"
                      title="Play"
                    >
                      <Play size={12} fill="currentColor" />
                    </button>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
      {open && results && items.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50">
          <div className="px-4 py-3 text-sm text-muted-foreground">
            No results
          </div>
        </div>
      )}
    </div>
  );
}
