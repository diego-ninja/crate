import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Command } from "cmdk";
import { api } from "@/lib/api";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Library,
  BarChart3,
  HeartPulse,
  Download,
  ListMusic,
  ListTodo,
  Settings,
  RefreshCw,
  Stethoscope,
  Server,
  User,
  Disc3,
  Search,
  BrainCircuit,
  Radio,
  BarChart2,
  Sparkles,
  Compass,
  Archive,
  FileInput,
  FileJson,
  Tags,
  Calendar,
  Activity,
  ScrollText,
  ShieldCheck,
  Trash2,
  HandHeart,
} from "lucide-react";

interface SearchResults {
  artists: { id?: number; entity_uid?: string; slug?: string; name: string }[];
  albums: {
    id?: number;
    entity_uid?: string;
    slug?: string;
    artist: string;
    artist_id?: number;
    artist_entity_uid?: string;
    name: string;
  }[];
}

const COMMAND_SYNC_LIBRARY = ["library.import.manage"] as const;
const COMMAND_REPAIR_RUN = ["library.repair.run"] as const;
const COMMAND_METADATA_WRITE = ["library.metadata.write"] as const;
const COMMAND_ANALYSIS_MANAGE = ["library.analysis.manage"] as const;
const COMMAND_SYNC_SHOWS = ["curation.shows.write"] as const;
const COMMAND_GENRE_CURATION = ["curation.genres.write"] as const;
const COMMAND_RELEASE_CURATION = ["curation.releases.write"] as const;
const COMMAND_FEDERATION_VIEW = ["federation.nodes.view"] as const;
const COMMAND_FEDERATION_SYNC = ["federation.catalog.sync.manage"] as const;
const COMMAND_GLOBAL_CATALOG_MANAGE = ["federation.policy.manage"] as const;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { hasAnyCapability } = useAuth();
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

  const commandActions = [
    {
      label: "Sync Library",
      capabilities: COMMAND_SYNC_LIBRARY,
      icon: RefreshCw,
      run: () => api("/api/tasks/sync-library", "POST"),
    },
    {
      label: "Sync Federated Catalogs",
      toastLabel: "Federated catalog sync",
      capabilities: COMMAND_FEDERATION_SYNC,
      icon: RefreshCw,
      run: () => api("/api/admin/federation/sync-catalog", "POST"),
    },
    {
      label: "Reconcile Global Catalog",
      toastLabel: "Global catalog reconciliation",
      capabilities: COMMAND_GLOBAL_CATALOG_MANAGE,
      icon: RefreshCw,
      run: () =>
        api("/api/admin/global-catalog/reconcile", "POST", {
          mode: "incremental",
        }),
    },
    {
      label: "Full Global Catalog Reconciliation",
      toastLabel: "Full global catalog reconciliation",
      capabilities: COMMAND_GLOBAL_CATALOG_MANAGE,
      icon: RefreshCw,
      run: () =>
        api("/api/admin/global-catalog/reconcile", "POST", {
          mode: "full",
        }),
    },
    {
      label: "Run Health Check",
      toastLabel: "Health Check",
      capabilities: COMMAND_REPAIR_RUN,
      icon: Stethoscope,
      run: () => api("/api/manage/health-check", "POST"),
    },
    {
      label: "Analyze All Tracks (BPM, Key, Energy)",
      toastLabel: "Audio Analysis",
      capabilities: COMMAND_ANALYSIS_MANAGE,
      icon: BrainCircuit,
      run: () => api("/api/manage/analyze-all", "POST"),
    },
    {
      label: "Compute Bliss Vectors",
      toastLabel: "Compute Bliss vectors",
      capabilities: COMMAND_ANALYSIS_MANAGE,
      icon: Radio,
      run: () => api("/api/manage/compute-bliss", "POST"),
    },
    {
      label: "Compute Popularity (Last.fm)",
      toastLabel: "Compute Popularity",
      capabilities: COMMAND_ANALYSIS_MANAGE,
      icon: BarChart2,
      run: () => api("/api/manage/compute-popularity", "POST"),
    },
    {
      label: "Backfill Audio Fingerprints (Chromaprint)",
      toastLabel: "Backfill audio fingerprints",
      capabilities: COMMAND_ANALYSIS_MANAGE,
      icon: BrainCircuit,
      run: () => api("/api/tasks/backfill-track-fingerprints", "POST"),
    },
    {
      label: "Enrich MusicBrainz IDs",
      toastLabel: "Enrich MBIDs",
      capabilities: COMMAND_METADATA_WRITE,
      icon: Sparkles,
      run: () => api("/api/manage/enrich-mbids", "POST"),
    },
    {
      label: "Backfill Album Release Dates",
      toastLabel: "Backfill album release dates",
      capabilities: COMMAND_METADATA_WRITE,
      icon: Calendar,
      run: () =>
        api("/api/manage/enrich-mbids", "POST", {
          release_dates_only: true,
        }),
    },
    {
      label: "Sync Missing Lyrics",
      toastLabel: "Sync Lyrics",
      capabilities: COMMAND_METADATA_WRITE,
      icon: FileJson,
      run: () => api("/api/manage/sync-lyrics", "POST", { limit: 1000 }),
    },
    {
      label: "Write Portable Metadata",
      toastLabel: "Portable Metadata",
      capabilities: COMMAND_METADATA_WRITE,
      icon: Tags,
      run: () =>
        api("/api/manage/portable-metadata", "POST", {
          write_audio_tags: true,
          write_sidecars: true,
        }),
    },
    {
      label: "Rehydrate From Portable Metadata",
      toastLabel: "Portable Metadata Rehydrate",
      capabilities: COMMAND_METADATA_WRITE,
      icon: FileInput,
      run: () => api("/api/manage/portable-metadata/rehydrate", "POST"),
    },
    {
      label: "Export Rich Metadata Index",
      toastLabel: "Rich Metadata Export",
      capabilities: COMMAND_METADATA_WRITE,
      icon: Archive,
      run: () =>
        api("/api/manage/portable-metadata/export-rich", "POST", {
          include_audio: false,
          write_rich_tags: false,
        }),
    },
    {
      label: "Backfill Artist Similarities",
      toastLabel: "Backfill Similarities",
      capabilities: COMMAND_METADATA_WRITE,
      icon: Sparkles,
      run: () => api("/api/tasks/backfill-similarities", "POST"),
    },
    {
      label: "Sync Shows (Ticketmaster)",
      toastLabel: "Sync Shows",
      capabilities: COMMAND_SYNC_SHOWS,
      icon: Sparkles,
      run: () => api("/api/tasks/sync-shows", "POST"),
    },
    {
      label: "Clean Invalid Genre Taxonomy Nodes",
      toastLabel: "Genre taxonomy cleanup",
      capabilities: COMMAND_GENRE_CURATION,
      icon: Sparkles,
      run: () => api("/api/genres/taxonomy/cleanup-invalid", "POST"),
    },
    {
      label: "Check New Releases (MusicBrainz)",
      toastLabel: "Check New Releases",
      capabilities: COMMAND_RELEASE_CURATION,
      icon: Sparkles,
      run: () => api("/api/acquisition/new-releases/check", "POST"),
    },
  ].filter((item) => hasAnyCapability(item.capabilities));

  if (!open) return null;

  return (
    <dialog
      open
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-[100] bg-black/50 flex items-start justify-center pt-[20vh]"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 border-0 bg-transparent p-0"
        onClick={() => setOpen(false)}
      />
      <div className="relative z-10 w-full max-w-lg">
        <Command
          className="bg-card border border-border rounded-md shadow-2xl overflow-hidden"
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
                  {
                    label: "Dashboard",
                    path: "/",
                    icon: LayoutDashboard,
                    capabilities: ["admin.access"],
                  },
                  {
                    label: "Browse",
                    path: "/browse",
                    icon: Library,
                    capabilities: ["library.view"],
                  },
                  {
                    label: "Insights",
                    path: "/insights",
                    icon: BarChart3,
                    capabilities: ["library.view"],
                  },
                  {
                    label: "Health",
                    path: "/health",
                    icon: HeartPulse,
                    capabilities: ["library.repair.run"],
                  },
                  {
                    label: "System Health",
                    path: "/system",
                    icon: Activity,
                    capabilities: ["ops.health.view"],
                  },
                  {
                    label: "Analysis",
                    path: "/analysis",
                    icon: BrainCircuit,
                    capabilities: ["library.analysis.manage"],
                  },
                  {
                    label: "Tasks",
                    path: "/tasks",
                    icon: ListTodo,
                    capabilities: ["ops.tasks.manage"],
                  },
                  {
                    label: "Logs",
                    path: "/logs",
                    icon: ScrollText,
                    capabilities: ["ops.logs.view"],
                  },
                  {
                    label: "Stack",
                    path: "/stack",
                    icon: Server,
                    capabilities: ["ops.runtime.manage"],
                  },
                  {
                    label: "Federation",
                    path: "/federation",
                    icon: Server,
                    capabilities: COMMAND_FEDERATION_VIEW,
                  },
                  {
                    label: "Global Catalog",
                    path: "/global-catalog",
                    icon: Library,
                    capabilities: COMMAND_FEDERATION_VIEW,
                  },
                  {
                    label: "Users",
                    path: "/users",
                    icon: User,
                    capabilities: ["users.view"],
                  },
                  {
                    label: "Roles",
                    path: "/roles",
                    icon: ShieldCheck,
                    capabilities: ["roles.view"],
                  },
                  {
                    label: "Acquisition",
                    path: "/download",
                    icon: Download,
                    capabilities: [
                      "library.import.manage",
                      "library.tidal.manage",
                    ],
                  },
                  {
                    label: "Library Trash",
                    path: "/trash",
                    icon: Trash2,
                    capabilities: ["library.track.remove"],
                  },
                  {
                    label: "Contributions",
                    path: "/contributions",
                    icon: HandHeart,
                    capabilities: ["library.import.manage"],
                  },
                  {
                    label: "Bandcamp",
                    path: "/bandcamp",
                    icon: Archive,
                    capabilities: ["library.bandcamp.manage"],
                  },
                  {
                    label: "System Playlists",
                    path: "/playlists",
                    icon: ListMusic,
                    capabilities: ["curation.playlists.write"],
                  },
                  {
                    label: "Upcoming",
                    path: "/upcoming",
                    icon: Calendar,
                    capabilities: [
                      "curation.shows.write",
                      "curation.releases.write",
                      "library.tidal.manage",
                    ],
                  },
                  {
                    label: "New Releases",
                    path: "/new-releases",
                    icon: Sparkles,
                    capabilities: [
                      "curation.releases.write",
                      "library.tidal.manage",
                    ],
                  },
                  {
                    label: "Discovery",
                    path: "/discover",
                    icon: Compass,
                    capabilities: ["library.view"],
                  },
                  {
                    label: "Settings",
                    path: "/settings",
                    icon: Settings,
                    capabilities: ["settings.manage"],
                  },
                ].flatMap((item) =>
                  hasAnyCapability(item.capabilities)
                    ? [
                        <Command.Item
                          key={item.path}
                          onSelect={() => go(item.path)}
                          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer hover:bg-accent data-[selected=true]:bg-accent"
                        >
                          <item.icon
                            size={14}
                            className="text-muted-foreground"
                          />
                          {item.label}
                        </Command.Item>,
                      ]
                    : [],
                )}
              </Command.Group>
            )}

            {!query && commandActions.length > 0 && (
              <Command.Group
                heading="Actions"
                className="text-xs text-muted-foreground px-2 py-1"
              >
                {commandActions.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Command.Item
                      key={item.label}
                      onSelect={() =>
                        action(item.run, item.toastLabel ?? item.label)
                      }
                      className="flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer hover:bg-accent data-[selected=true]:bg-accent"
                    >
                      <Icon size={14} className="text-muted-foreground" />
                      {item.label}
                    </Command.Item>
                  );
                })}
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
                    onSelect={() =>
                      go(
                        artistPagePath({
                          artistId: a.id,
                          artistSlug: a.slug,
                          artistName: a.name,
                        }),
                      )
                    }
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
                        albumPagePath({
                          albumId: a.id,
                          albumSlug: a.slug,
                          artistName: a.artist,
                          albumName: a.name,
                        }),
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
    </dialog>
  );
}
