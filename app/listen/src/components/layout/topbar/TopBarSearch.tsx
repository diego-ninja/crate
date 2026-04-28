import { useCallback, useEffect, useRef, useState } from "react";
import { Disc, Loader2, Music, Search, User, X } from "lucide-react";
import { useNavigate } from "react-router";

import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

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
  const [expanded, setExpanded] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const queryActive = query.trim().length > 0;
  const searchOpen = expanded || showDropdown || queryActive;

  const focusInputSoon = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const collapseIfIdle = useCallback((nextShowDropdown = showDropdown) => {
    if (query.trim()) return;
    if (nextShowDropdown) return;
    if (containerRef.current?.contains(document.activeElement)) return;
    setExpanded(false);
    setActiveIdx(-1);
  }, [query, showDropdown]);

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

  useEffect(() => {
    if (query.trim()) {
      setExpanded(true);
    }
  }, [query]);

  useDismissibleLayer({
    active: showDropdown,
    refs: [containerRef, dropdownRef, inputRef],
    onDismiss: () => {
      setShowDropdown(false);
      collapseIfIdle(false);
    },
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
      setExpanded(false);
    },
    [navigate, play],
  );

  const selectRecent = useCallback((term: string) => {
    setExpanded(true);
    setQuery(term);
    setShowDropdown(true);
    focusInputSoon();
  }, [focusInputSoon]);

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
      setQuery("");
      setResults([]);
      setExpanded(false);
      inputRef.current?.blur();
    }
  }

  const showRecents = showDropdown && !query.trim() && recents.length > 0;
  const showResults = showDropdown && query.trim().length > 0 && (results.length > 0 || loading);

  return (
    <div
      ref={containerRef}
      className={cn(
        "group relative flex-1 shrink-0 overflow-visible md:flex-none md:origin-right",
        "transition-[width,transform] duration-500 ease-[cubic-bezier(0.22,1.18,0.36,1)] motion-reduce:transition-none",
        searchOpen
          ? "w-[min(20rem,calc(100vw-8.5rem))] sm:w-[min(24rem,calc(100vw-9.25rem))] md:w-[440px] lg:w-[500px]"
          : "w-11",
      )}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => collapseIfIdle()}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-xl transition-[background-color,border-color,box-shadow,transform] duration-500 ease-[cubic-bezier(0.22,1.18,0.36,1)] motion-reduce:transition-none",
          "focus-within:border focus-within:border-cyan-400/25 focus-within:bg-app-surface/78 focus-within:shadow-[0_0_0_1px_rgba(34,211,238,0.08),0_18px_42px_rgba(0,0,0,0.22)]",
          searchOpen
            ? "border border-white/8 bg-app-surface/68 shadow-[0_18px_42px_rgba(0,0,0,0.22)]"
            : "border-0 bg-transparent shadow-none",
          searchOpen ? "md:scale-x-[1.01]" : "md:scale-x-100",
        )}
      >
        <div className="relative flex items-center">
          <button
            type="button"
            aria-label="Search"
            aria-expanded={searchOpen}
            data-state={searchOpen ? "open" : "closed"}
            onFocus={() => setExpanded(true)}
            onClick={() => {
              setExpanded(true);
              setShowDropdown(true);
              focusInputSoon();
            }}
            className={cn(
              "absolute left-0 top-0 z-10 flex h-11 w-11 items-center justify-center rounded-xl transition-[color,transform,opacity] duration-500 ease-[cubic-bezier(0.22,1.18,0.36,1)] motion-reduce:transition-none",
              searchOpen
                ? "text-white/42"
                : "text-white/56 group-hover:text-white/82 group-hover:scale-[1.03]",
            )}
          >
            <Search size={17} />
          </button>
          {loading && searchOpen ? <Loader2 size={15} className="absolute right-4 animate-spin text-white/40" /> : null}
          {!loading && query && searchOpen ? (
            <button
              onClick={() => {
                setQuery("");
                setResults([]);
                setShowDropdown(true);
                focusInputSoon();
              }}
              className="absolute right-4 text-white/30 hover:text-white/60"
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          ) : null}
          <input
            ref={inputRef}
            type="text"
            value={query}
            tabIndex={searchOpen ? 0 : -1}
            aria-hidden={!searchOpen}
            onChange={(e) => {
              setExpanded(true);
              setQuery(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => {
              setExpanded(true);
              setShowDropdown(true);
            }}
            onBlur={() => {
              window.setTimeout(() => {
                collapseIfIdle();
              }, 0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search artists, albums, tracks..."
            className={cn(
              "h-11 w-full rounded-xl border-0 bg-transparent pl-11 text-[15px] text-white outline-none",
              "transition-[opacity,transform,box-shadow,padding] duration-500 ease-[cubic-bezier(0.22,1.18,0.36,1)] motion-reduce:transition-none",
              "placeholder:text-white/40",
              searchOpen
                ? "pointer-events-auto translate-x-0 scale-100 pr-11 opacity-100"
                : "pointer-events-none translate-x-3 scale-[0.985] pr-4 opacity-0",
            )}
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
                    <p className="truncate text-[11px] text-white/40">{item.sublabel}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-[10px] capitalize text-white/20">{item.type}</span>
              </button>
            ))}
            {query.trim() && (
              <button
                onClick={() => {
                  navigate(`/search?q=${encodeURIComponent(query.trim())}`);
                  setShowDropdown(false);
                  setQuery("");
                  setExpanded(false);
                }}
                className="w-full px-3 py-2 text-xs text-primary hover:bg-white/5 transition-colors text-center border-t border-white/5 mt-1"
              >
                See all results for "{query.trim()}"
              </button>
            )}
          </AppPopover>
        ) : null}

        {showRecents ? (
          <AppPopover ref={dropdownRef} className="absolute left-0 right-0 top-full mt-1 py-1">
            <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40">
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
    </div>
  );
}
