import { useCallback, useEffect, useRef, useState } from "react";
import { Disc, Loader2, Music, Search, User, X } from "lucide-react";
import { useNavigate } from "react-router";

import { AppPopover } from "@/components/ui/AppPopover";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useDismissibleLayer } from "@/hooks/use-dismissible-layer";
import { api } from "@/lib/api";

import {
  addTopBarSearchRecent,
  flattenTopBarSearchResults,
  getTopBarSearchRecents,
  type SearchResult,
  type TopBarSearchItem,
} from "./topbar-search-model";

function SearchResultThumb({ item }: { item: TopBarSearchItem }) {
  if (item.imageUrl) {
    return (
      <img
        src={item.imageUrl}
        alt=""
        className={`h-8 w-8 shrink-0 object-cover bg-white/5 ${item.type === "artist" ? "rounded-full" : "rounded"}`}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  if (item.type === "artist") {
    return <User size={14} className="h-8 w-8 shrink-0 rounded-full bg-white/5 p-2 text-white/30" />;
  }
  if (item.type === "album") {
    return <Disc size={14} className="h-8 w-8 shrink-0 rounded bg-white/5 p-2 text-white/30" />;
  }
  return <Music size={14} className="h-8 w-8 shrink-0 rounded bg-white/5 p-2 text-white/30" />;
}

export function TopBarSearch() {
  const navigate = useNavigate();
  const { play } = usePlayerActions();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TopBarSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [recents, setRecents] = useState<string[]>(getTopBarSearchRecents);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      api<SearchResult>(`/api/search?q=${encodeURIComponent(query.trim())}&limit=10`)
        .then((data) => {
          setResults(flattenTopBarSearchResults(data));
          setActiveIdx(-1);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useDismissibleLayer({
    active: showDropdown,
    refs: [dropdownRef, inputRef],
    onDismiss: () => setShowDropdown(false),
    closeOnEscape: false,
  });

  const selectItem = useCallback(
    (item: TopBarSearchItem) => {
      addTopBarSearchRecent(item.label);
      setRecents(getTopBarSearchRecents());
      if (item.trackData) {
        play(
          { ...item.trackData, albumCover: item.imageUrl },
          { type: "queue", name: "Search" },
        );
      } else if (item.navigateTo) {
        navigate(item.navigateTo);
      }
      setShowDropdown(false);
      setQuery("");
    },
    [navigate, play],
  );

  const selectRecent = useCallback((term: string) => {
    setQuery(term);
    setShowDropdown(true);
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const items = query.trim() ? results : recents.map((label) => ({ label }));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((prev) => Math.min(prev + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      if (query.trim() && results[activeIdx]) {
        selectItem(results[activeIdx]);
      } else if (!query.trim() && recents[activeIdx]) {
        selectRecent(recents[activeIdx]);
      }
    } else if (e.key === "Escape") {
      setShowDropdown(false);
      inputRef.current?.blur();
    }
  }

  const showRecents = showDropdown && !query.trim() && recents.length > 0;
  const showResults = showDropdown && query.trim().length > 0 && (results.length > 0 || loading);

  return (
    <div className="relative flex-1 pointer-events-auto md:flex-none md:w-[420px]">
      <div className="relative flex items-center">
        <Search size={16} className="pointer-events-none absolute left-3 text-white/30" />
        {loading ? <Loader2 size={14} className="absolute right-3 animate-spin text-white/30" /> : null}
        {!loading && query ? (
          <button
            onClick={() => {
              setQuery("");
              setResults([]);
              inputRef.current?.focus();
            }}
            className="absolute right-3 text-white/30 hover:text-white/60"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        ) : null}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search artists, albums, tracks..."
          className="h-11 w-full rounded-lg bg-black/25 backdrop-blur-sm pl-9 pr-9 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:bg-black/40"
        />
      </div>

      {showResults ? (
        <AppPopover
          ref={dropdownRef}
          className="absolute left-0 right-0 top-full mt-1 max-h-80 overflow-y-auto py-1"
        >
          {results.map((item, index) => (
            <button
              key={`${item.type}-${item.label}-${index}`}
              onClick={() => selectItem(item)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                index === activeIdx ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              <SearchResultThumb item={item} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-white/80">{item.label}</p>
                {item.sublabel ? (
                  <p className="truncate text-[11px] text-white/35">{item.sublabel}</p>
                ) : null}
              </div>
              <span className="shrink-0 text-[10px] capitalize text-white/20">{item.type}</span>
            </button>
          ))}
          {query.trim() && (
            <button
              onClick={() => { navigate(`/search?q=${encodeURIComponent(query.trim())}`); setShowDropdown(false); setQuery(""); }}
              className="w-full px-3 py-2 text-xs text-primary hover:bg-white/5 transition-colors text-center border-t border-white/5 mt-1"
            >
              See all results for "{query.trim()}"
            </button>
          )}
        </AppPopover>
      ) : null}

      {showRecents ? (
        <AppPopover ref={dropdownRef} className="absolute left-0 right-0 top-full mt-1 py-1">
          <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/25">
            Recent
          </p>
          {recents.map((term, index) => (
            <button
              key={term}
              onClick={() => selectRecent(term)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                index === activeIdx ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              <Search size={12} className="shrink-0 text-white/20" />
              <span className="truncate text-[13px] text-white/60">{term}</span>
            </button>
          ))}
        </AppPopover>
      ) : null}
    </div>
  );
}
