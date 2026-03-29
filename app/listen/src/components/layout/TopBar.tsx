import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { Search, Loader2, User, LogOut, Settings, X, Disc, Music } from "lucide-react";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
import { toast } from "sonner";

interface SearchResult {
  artists: { name: string }[];
  albums: { artist: string; name: string }[];
  tracks: { title: string; artist: string; album: string }[];
}

const RECENTS_KEY = "listen-search-recents";
const MAX_RECENTS = 5;

function getRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
  } catch {
    return [];
  }
}

function addRecent(term: string) {
  const recents = getRecents().filter((r) => r !== term);
  recents.unshift(term);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
}

interface FlatItem {
  type: "artist" | "album" | "track";
  label: string;
  sublabel?: string;
  navigateTo?: string;
  imageUrl?: string;
}

function flattenResults(data: SearchResult): FlatItem[] {
  const items: FlatItem[] = [];
  for (const a of data.artists) {
    items.push({
      type: "artist", label: a.name,
      navigateTo: `/artist/${encPath(a.name)}`,
      imageUrl: `/api/artist/${encPath(a.name)}/photo`,
    });
  }
  for (const a of data.albums) {
    items.push({
      type: "album", label: a.name, sublabel: a.artist,
      navigateTo: `/album/${encPath(a.artist)}/${encPath(a.name)}`,
      imageUrl: `/api/cover/${encPath(a.artist)}/${encPath(a.name)}`,
    });
  }
  for (const t of data.tracks) {
    items.push({
      type: "track", label: t.title, sublabel: `${t.artist} - ${t.album}`,
      imageUrl: t.album ? `/api/cover/${encPath(t.artist)}/${encPath(t.album)}` : undefined,
    });
  }
  return items;
}

function ResultThumb({ item }: { item: FlatItem }) {
  if (item.imageUrl) {
    return (
      <img
        src={item.imageUrl}
        alt=""
        className={`w-8 h-8 object-cover shrink-0 bg-white/5 ${item.type === "artist" ? "rounded-full" : "rounded"}`}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  if (item.type === "artist") return <User size={14} className="w-8 h-8 p-2 rounded-full bg-white/5 text-white/30 shrink-0" />;
  if (item.type === "album") return <Disc size={14} className="w-8 h-8 p-2 rounded bg-white/5 text-white/30 shrink-0" />;
  return <Music size={14} className="w-8 h-8 p-2 rounded bg-white/5 text-white/30 shrink-0" />;
}

export function TopBar() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FlatItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [recents, setRecents] = useState<string[]>(getRecents);

  const [userName, setUserName] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Fetch user info
  useEffect(() => {
    api<{ name?: string; email?: string }>("/api/auth/me")
      .then((u) => setUserName(u.name || u.email || null))
      .catch(() => {});
  }, []);

  // Debounced search
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
          setResults(flattenResults(data));
          setActiveIdx(-1);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Click outside — close dropdowns
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) && !inputRef.current?.contains(e.target as Node)) {
        setShowDropdown(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectItem = useCallback(
    (item: FlatItem) => {
      if (item.navigateTo) {
        addRecent(item.label);
        setRecents(getRecents());
        navigate(item.navigateTo);
      }
      setShowDropdown(false);
      setQuery("");
    },
    [navigate],
  );

  const selectRecent = useCallback(
    (term: string) => {
      setQuery(term);
      setShowDropdown(true);
      inputRef.current?.focus();
    },
    [],
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    const items = query.trim() ? results : recents.map((r) => ({ label: r }));
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

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    navigate("/login");
  }

  const showRecents = showDropdown && !query.trim() && recents.length > 0;
  const showResults = showDropdown && query.trim().length > 0 && (results.length > 0 || loading);

  const userInitial = userName ? userName.charAt(0).toUpperCase() : null;

  return (
    <div className="flex items-center gap-4 px-4 py-3 pointer-events-none">
      {/* Spacer pushes search + avatar to the right */}
      <div className="flex-1" />

      {/* Search */}
      <div className="relative w-full max-w-md pointer-events-auto">
        <div className="relative flex items-center">
          <Search size={16} className="absolute left-3 text-white/30 pointer-events-none" />
          {loading && <Loader2 size={14} className="absolute right-3 text-white/30 animate-spin" />}
          {!loading && query && (
            <button
              onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
              className="absolute right-3 text-white/30 hover:text-white/60"
            >
              <X size={14} />
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search artists, albums, tracks..."
            className="w-full h-9 pl-9 pr-9 rounded-lg bg-white/5 border border-white/5 text-sm text-white placeholder:text-white/25 outline-none focus:border-white/15 transition-colors"
          />
        </div>

        {/* Results dropdown */}
        {showResults && (
          <div ref={dropdownRef} className="absolute top-full left-0 right-0 mt-1 bg-[#12121a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 max-h-80 overflow-y-auto py-1">
            {results.map((item, i) => (
              <button
                key={`${item.type}-${item.label}-${i}`}
                onClick={() => selectItem(item)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${i === activeIdx ? "bg-white/10" : "hover:bg-white/5"}`}
              >
                <ResultThumb item={item} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-white/80 truncate">{item.label}</p>
                  {item.sublabel && <p className="text-[11px] text-white/35 truncate">{item.sublabel}</p>}
                </div>
                <span className="text-[10px] text-white/20 capitalize shrink-0">{item.type}</span>
              </button>
            ))}
          </div>
        )}

        {/* Recent searches dropdown */}
        {showRecents && (
          <div ref={dropdownRef} className="absolute top-full left-0 right-0 mt-1 bg-[#12121a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 py-1">
            <p className="px-3 py-1.5 text-[10px] text-white/25 uppercase tracking-wider font-bold">Recent</p>
            {recents.map((term, i) => (
              <button
                key={term}
                onClick={() => selectRecent(term)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${i === activeIdx ? "bg-white/10" : "hover:bg-white/5"}`}
              >
                <Search size={12} className="text-white/20 shrink-0" />
                <span className="text-[13px] text-white/60 truncate">{term}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* User avatar */}
      <div className="relative pointer-events-auto">
        <button
          onClick={() => setShowUserMenu(!showUserMenu)}
          className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/15 transition-colors text-sm font-medium"
        >
          {userInitial || <User size={16} />}
        </button>

        {showUserMenu && (
          <div ref={userMenuRef} className="absolute top-full right-0 mt-2 w-44 bg-[#12121a]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 py-1">
            <button
              onClick={() => { setShowUserMenu(false); navigate("/library"); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:bg-white/5 hover:text-white transition-colors text-left"
            >
              <User size={14} />
              Profile
            </button>
            <button
              onClick={() => { setShowUserMenu(false); toast("Coming soon"); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-white/70 hover:bg-white/5 hover:text-white transition-colors text-left"
            >
              <Settings size={14} />
              Settings
            </button>
            <div className="my-1 border-t border-white/5" />
            <button
              onClick={() => { setShowUserMenu(false); handleLogout(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-red-400/70 hover:bg-white/5 hover:text-red-400 transition-colors text-left"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
