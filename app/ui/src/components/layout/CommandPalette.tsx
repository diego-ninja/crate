import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Command } from "cmdk";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Library,
  BarChart3,
  HeartPulse,
  Download,
  ListMusic,
  Settings,
  RefreshCw,
  Stethoscope,
  User,
  Disc3,
  Search,
  BrainCircuit,
  Radio,
  BarChart2,
  Sparkles,
  Compass,
  Link2,
} from "lucide-react";

interface SearchResults {
  artists: { name: string }[];
  albums: { artist: string; name: string }[];
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults | null>(
    null,
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (query.length < 2) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await api<SearchResults>(
          `/api/search?q=${encodeURIComponent(query)}`,
        );
        setSearchResults(data);
      } catch {
        /* ignore */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  function go(path: string) {
    navigate(path);
    setOpen(false);
    setQuery("");
  }

  function action(fn: () => Promise<unknown>, label: string) {
    fn()
      .then(() => toast.success(`${label} started`))
      .catch(() => toast.error(`${label} failed`));
    setOpen(false);
    setQuery("");
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-start justify-center pt-[20vh]"
      onClick={() => setOpen(false)}
    >
      <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <Command
          className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
          shouldFilter={false}
        >
          <div className="flex items-center border-b border-border px-3">
            <Search size={16} className="text-muted-foreground shrink-0" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Type a command or search..."
              className="w-full px-3 py-3 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
            <kbd className="hidden sm:inline-flex px-1.5 py-0.5 rounded bg-secondary text-[10px] font-mono border border-border text-muted-foreground">
              ESC
            </kbd>
          </div>
          <Command.List className="max-h-[300px] overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No results found
            </Command.Empty>

            {!query && (
              <Command.Group
                heading="Navigation"
                className="text-xs text-muted-foreground px-2 py-1"
              >
                {[
                  { label: "Dashboard", path: "/", icon: LayoutDashboard },
                  { label: "Browse", path: "/browse", icon: Library },
                  { label: "Insights", path: "/insights", icon: BarChart3 },
                  { label: "Health", path: "/health", icon: HeartPulse },
                  { label: "Download", path: "/download", icon: Download },
                  { label: "Playlists", path: "/playlists", icon: ListMusic },
                  { label: "Discover", path: "/discover", icon: Compass },
                  { label: "Settings", path: "/settings", icon: Settings },
                ].map((item) => (
                  <Command.Item
                    key={item.path}
                    onSelect={() => go(item.path)}
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer hover:bg-accent data-[selected=true]:bg-accent"
                  >
                    <item.icon size={14} className="text-muted-foreground" />
                    {item.label}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {!query && isAdmin && (
              <Command.Group
                heading="Actions"
                className="text-xs text-muted-foreground px-2 py-1"
              >
                <Command.Item
                  onSelect={() =>
                    action(
                      () => api("/api/tasks/sync-library", "POST"),
                      "Sync Library",
                    )
                  }
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer hover:bg-accent data-[selected=true]:bg-accent"
                >
                  <RefreshCw size={14} className="text-muted-foreground" />
                  Sync Library
                </Command.Item>
                <Command.Item
                  onSelect={() =>
                    action(
                      () => api("/api/manage/health-check", "POST"),
                      "Health Check",
                    )
                  }
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer hover:bg-accent data-[selected=true]:bg-accent"
                >
                  <Stethoscope size={14} className="text-muted-foreground" />
                  Run Health Check
                </Command.Item>
                <Command.Item
                  onSelect={() =>
                    action(
                      () => api("/api/manage/analyze-all", "POST"),
                      "Audio Analysis",
                    )
                  }
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer hover:bg-accent data-[selected=true]:bg-accent"
                >
                  <BrainCircuit size={14} className="text-muted-foreground" />
                  Analyze All Tracks (BPM, Key, Energy)
                </Command.Item>
                <Command.Item
                  onSelect={() =>
                    action(
                      () => api("/api/manage/compute-bliss", "POST"),
                      "Compute Bliss",
                    )
                  }
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer hover:bg-accent data-[selected=true]:bg-accent"
                >
                  <Radio size={14} className="text-muted-foreground" />
                  Compute Bliss Vectors (Artist Radio)
                </Command.Item>
                <Command.Item
                  onSelect={() =>
                    action(
                      () => api("/api/manage/compute-popularity", "POST"),
                      "Compute Popularity",
                    )
                  }
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer hover:bg-accent data-[selected=true]:bg-accent"
                >
                  <BarChart2 size={14} className="text-muted-foreground" />
                  Compute Popularity (Last.fm)
                </Command.Item>
                <Command.Item
                  onSelect={() =>
                    action(
                      () => api("/api/manage/enrich-mbids", "POST"),
                      "Enrich MBIDs",
                    )
                  }
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer hover:bg-accent data-[selected=true]:bg-accent"
                >
                  <Sparkles size={14} className="text-muted-foreground" />
                  Enrich MusicBrainz IDs
                </Command.Item>
                <Command.Item
                  onSelect={() =>
                    action(
                      () => api("/api/navidrome/map-ids", "POST"),
                      "Map Navidrome IDs",
                    )
                  }
                  className="flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer hover:bg-accent data-[selected=true]:bg-accent"
                >
                  <Link2 size={14} className="text-muted-foreground" />
                  Map Navidrome IDs
                </Command.Item>
              </Command.Group>
            )}

            {searchResults?.artists && searchResults.artists.length > 0 && (
              <Command.Group
                heading="Artists"
                className="text-xs text-muted-foreground px-2 py-1"
              >
                {searchResults.artists.slice(0, 5).map((a) => (
                  <Command.Item
                    key={a.name}
                    onSelect={() => go(`/artist/${encPath(a.name)}`)}
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer hover:bg-accent data-[selected=true]:bg-accent"
                  >
                    <User size={14} className="text-muted-foreground" />
                    {a.name}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {searchResults?.albums && searchResults.albums.length > 0 && (
              <Command.Group
                heading="Albums"
                className="text-xs text-muted-foreground px-2 py-1"
              >
                {searchResults.albums.slice(0, 5).map((a) => (
                  <Command.Item
                    key={`${a.artist}-${a.name}`}
                    onSelect={() =>
                      go(
                        `/album/${encPath(a.artist)}/${encPath(a.name)}`,
                      )
                    }
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer hover:bg-accent data-[selected=true]:bg-accent"
                  >
                    <Disc3 size={14} className="text-muted-foreground" />
                    {a.artist} — {a.name}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
