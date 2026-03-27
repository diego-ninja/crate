import { useState, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/api";
import { cn, encPath } from "@/lib/utils";
import { toast } from "sonner";
import {
  Loader2, Download, X, RefreshCw, Disc3, MapPin, Calendar,
  Ticket, ExternalLink, Sparkles, List, CalendarDays,
  ChevronLeft, ChevronRight, ChevronDown, Clock, Search, Trash2,
} from "lucide-react";
import { MapContainer, TileLayer, Marker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default marker icon
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface UpcomingItem {
  type: "release" | "show";
  date: string;
  time?: string;
  artist: string;
  title: string;
  subtitle: string;
  cover_url: string | null;
  status: string;
  is_upcoming: boolean;
  tidal_url?: string;
  release_id?: number;
  url?: string;
  venue?: string;
  city?: string;
  country?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
  lineup?: string[];
  genres?: string[];
}

type ViewMode = "list" | "calendar";
type TypeFilter = "all" | "releases" | "shows";

function itemKey(item: UpcomingItem, index: number): string {
  return `${item.type}-${item.artist}-${item.release_id ?? item.venue ?? index}-${item.date}`;
}

// ── Searchable dropdown ──

function SearchableSelect({ value, onChange, options, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  options: [string, number][];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = search
    ? options.filter(([name]) => name.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "h-8 rounded-md border border-border bg-background px-2.5 text-xs flex items-center gap-1.5 min-w-[120px] max-w-[200px]",
          value ? "text-foreground" : "text-muted-foreground"
        )}
      >
        <span className="truncate">{value || placeholder}</span>
        <ChevronDown size={12} className="flex-shrink-0 text-muted-foreground/50" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-[220px] bg-card border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="p-1.5 border-b border-border">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              autoFocus
              className="w-full h-7 px-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="max-h-[200px] overflow-y-auto p-1">
            <button
              onClick={() => { onChange(""); setOpen(false); setSearch(""); }}
              className={cn("w-full text-left px-2 py-1.5 text-xs rounded-md hover:bg-primary/10", !value && "text-primary")}
            >
              {placeholder}
            </button>
            {filtered.map(([name, count]) => (
              <button
                key={name}
                onClick={() => { onChange(name); setOpen(false); setSearch(""); }}
                className={cn(
                  "w-full text-left px-2 py-1.5 text-xs rounded-md hover:bg-primary/10 flex items-center justify-between",
                  value === name && "text-primary bg-primary/5"
                )}
              >
                <span className="truncate">{name}</span>
                <span className="text-muted-foreground/40 text-[10px] ml-2">{count}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground/40 text-center">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Upcoming() {
  const [items, setItems] = useState<UpcomingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [genreFilter, setGenreFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("list");
  const [syncing, setSyncing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [calMonth, setCalMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  async function fetchItems() {
    try {
      const data = await api<{ items: UpcomingItem[] }>("/api/upcoming");
      setItems(data.items || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchItems(); }, []);

  // Apply type + search filter first
  const typeFiltered = useMemo(() => {
    let list = items;
    if (search) list = list.filter((i) => i.artist.toLowerCase().includes(search.toLowerCase()));
    if (filter === "releases") list = list.filter((i) => i.type === "release");
    else if (filter === "shows") list = list.filter((i) => i.type === "show");
    return list;
  }, [items, search, filter]);

  // Derived filter options from type-filtered list (so genres/cities adjust per view)
  const availableGenres = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of typeFiltered) {
      for (const g of i.genres || []) counts[g] = (counts[g] || 0) + 1;
    }
    return Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 30);
  }, [typeFiltered]);

  const availableCities = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of typeFiltered) {
      if (i.city) counts[i.city] = (counts[i.city] || 0) + 1;
    }
    return Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 50);
  }, [typeFiltered]);

  // Reset genre/city filter if the selected value is no longer available
  useEffect(() => {
    if (genreFilter && !availableGenres.some(([g]) => g === genreFilter)) setGenreFilter("");
  }, [genreFilter, availableGenres]);
  useEffect(() => {
    if (cityFilter && !availableCities.some(([c]) => c === cityFilter)) setCityFilter("");
  }, [cityFilter, availableCities]);

  // Apply genre + city filters
  const filtered = useMemo(() => {
    let list = typeFiltered;
    if (genreFilter) list = list.filter((i) => (i.genres || []).some((g) => g.toLowerCase() === genreFilter.toLowerCase()));
    if (cityFilter) list = list.filter((i) => i.city?.toLowerCase() === cityFilter.toLowerCase());
    return list;
  }, [typeFiltered, genreFilter, cityFilter]);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = filtered.filter((i) => i.is_upcoming || (i.date && i.date >= today));
  const past = filtered.filter((i) => !i.is_upcoming && (!i.date || i.date < today));

  function groupByMonth(list: UpcomingItem[]): [string, UpcomingItem[]][] {
    const groups = new Map<string, UpcomingItem[]>();
    for (const item of list) {
      const month = (item.date || "").slice(0, 7) || "Unknown";
      const existing = groups.get(month) || [];
      existing.push(item);
      groups.set(month, existing);
    }
    return [...groups.entries()];
  }

  async function downloadRelease(id: number) {
    try {
      await api(`/api/acquisition/new-releases/${id}/download`, "POST");
      toast.success("Download started");
      setItems((prev) => prev.map((i) => i.release_id === id ? { ...i, status: "downloading" } : i));
    } catch { toast.error("Download failed"); }
  }

  async function dismissRelease(id: number) {
    try {
      await api(`/api/acquisition/new-releases/${id}/dismiss`, "POST");
      setItems((prev) => prev.filter((i) => i.release_id !== id));
    } catch { toast.error("Dismiss failed"); }
  }

  async function syncShows() {
    setSyncing(true);
    try {
      await api("/api/tasks/sync-shows", "POST");
      toast.success("Show sync started");
      setTimeout(() => { setSyncing(false); fetchItems(); }, 10000);
    } catch { setSyncing(false); toast.error("Failed to sync shows"); }
  }

  async function clearCaches() {
    try {
      await api("/api/tasks/clean/completed", "POST");
      toast.success("Caches cleared");
      fetchItems();
    } catch { toast.error("Failed to clear"); }
  }

  const releaseCount = items.filter((i) => i.type === "release" && i.is_upcoming).length;
  const showCount = items.filter((i) => i.type === "show").length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Calendar size={24} className="text-primary" />
          <h1 className="text-2xl font-bold">Upcoming</h1>
          {releaseCount > 0 && (
            <Badge variant="outline" className="border-cyan-500/30 text-cyan-400">
              {releaseCount} releases
            </Badge>
          )}
          {showCount > 0 && (
            <Badge variant="outline" className="border-amber-500/30 text-amber-400">
              {showCount} shows
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-card rounded-lg p-0.5 border border-border">
            <Button size="sm" variant={view === "list" ? "default" : "ghost"} className="h-7 px-2"
              onClick={() => setView("list")}>
              <List size={14} />
            </Button>
            <Button size="sm" variant={view === "calendar" ? "default" : "ghost"} className="h-7 px-2"
              onClick={() => setView("calendar")}>
              <CalendarDays size={14} />
            </Button>
          </div>
          <Button size="sm" onClick={syncShows} disabled={syncing}>
            <RefreshCw size={14} className={cn("mr-1", syncing && "animate-spin")} />
            Sync
          </Button>
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={clearCaches}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input
            type="text"
            placeholder="Filter by artist..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 pl-8 pr-3 text-sm bg-card border border-border rounded-lg w-48 focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/30"
          />
        </div>

        {(["all", "releases", "shows"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"}
            onClick={() => { setFilter(f); if (f !== "shows") { setGenreFilter(""); setCityFilter(""); } }}>
            {f === "all" && "All"}
            {f === "releases" && <><Disc3 size={12} className="mr-1" /> Releases</>}
            {f === "shows" && <><Ticket size={12} className="mr-1" /> Shows</>}
          </Button>
        ))}

        {availableGenres.length > 0 && (
          <SearchableSelect
            value={genreFilter}
            onChange={setGenreFilter}
            options={availableGenres}
            placeholder="All genres"
          />
        )}

        {availableCities.length > 0 && (
          <SearchableSelect
            value={cityFilter}
            onChange={setCityFilter}
            options={availableCities}
            placeholder="All cities"
          />
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-center py-24">
          <Calendar size={48} className="text-primary mx-auto mb-3 opacity-30" />
          <div className="text-lg font-semibold">Nothing upcoming</div>
          <div className="text-sm text-muted-foreground mt-1">
            Check for new releases or sync shows
          </div>
        </div>
      )}

      {/* List View */}
      {!loading && view === "list" && (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Sparkles size={14} /> Coming Up
              </h2>
              {groupByMonth(upcoming).map(([month, monthItems]) => (
                <MonthGroup key={month} month={month} items={monthItems}
                  onDownload={downloadRelease} onDismiss={dismissRelease}
                  expandedId={expandedId} onToggleExpand={setExpandedId} />
              ))}
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                Recently Released
              </h2>
              {groupByMonth(past).map(([month, monthItems]) => (
                <MonthGroup key={month} month={month} items={monthItems}
                  onDownload={downloadRelease} onDismiss={dismissRelease}
                  expandedId={expandedId} onToggleExpand={setExpandedId} />
              ))}
            </section>
          )}
        </div>
      )}

      {/* Calendar View */}
      {!loading && view === "calendar" && (
        <CalendarView
          items={filtered}
          month={calMonth}
          onMonthChange={(dir) => setCalMonth((m) => new Date(m.getFullYear(), m.getMonth() + dir, 1))}
          onDownload={downloadRelease}
          onDismiss={dismissRelease}
          onShowClick={(item, idx) => {
            setView("list");
            setExpandedId(itemKey(item, idx));
          }}
        />
      )}
    </div>
  );
}

// ── Month group for list view ──

function MonthGroup({ month, items, onDownload, onDismiss, expandedId, onToggleExpand }: {
  month: string;
  items: UpcomingItem[];
  onDownload: (id: number) => void;
  onDismiss: (id: number) => void;
  expandedId: string | null;
  onToggleExpand: (id: string | null) => void;
}) {
  const label = month === "Unknown" ? "Unknown Date"
    : new Date(month + "-15").toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="mb-6">
      <div className="text-xs font-medium text-muted-foreground/50 uppercase tracking-wider mb-2 border-b border-border/30 pb-1">
        {label}
      </div>
      <div className="space-y-1">
        {items.map((item, i) => {
          const key = itemKey(item, i);
          const isExpanded = expandedId === key;
          return (
            <div key={key}>
              {isExpanded && item.type === "show" ? (
                <ShowDetailPanel item={item} onClose={() => onToggleExpand(null)} />
              ) : (
                <EventCard
                  item={item}
                  onDownload={onDownload}
                  onDismiss={onDismiss}
                  onClick={item.type === "show" ? () => onToggleExpand(key) : undefined}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── EventCard ──

function EventCard({ item, onDownload, onDismiss, onClick }: {
  item: UpcomingItem;
  onDownload?: (id: number) => void;
  onDismiss?: (id: number) => void;
  onClick?: () => void;
}) {
  const isShow = item.type === "show";
  const isRelease = item.type === "release";

  const dateObj = item.date ? new Date(item.date + "T12:00:00") : null;
  const dateStr = dateObj ? dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  const timeStr = item.time ? item.time.slice(0, 5) : "";

  return (
    <div
      className={cn(
        "flex items-center gap-4 p-3 rounded-xl border transition-colors hover:bg-card/80 group",
        isShow ? "border-amber-500/10 hover:border-amber-500/20" : "border-cyan-500/10 hover:border-cyan-500/20",
        isShow && "cursor-pointer"
      )}
      onClick={onClick}
    >
      {/* Thumbnail */}
      <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-secondary">
        {isShow ? (
          <img src={`/api/artist/${encPath(item.artist)}/photo`} alt=""
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : item.cover_url ? (
          <img src={item.cover_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Disc3 size={16} className="text-muted-foreground/30" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">
            {isShow ? item.artist : item.title}
          </span>
          {isShow && item.genres?.slice(0, 2).map((g) => (
            <Badge key={g} variant="outline" className="text-[9px] px-1 py-0 hidden sm:inline-flex">{g}</Badge>
          ))}
        </div>
        <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
          {isShow ? (
            <>
              <MapPin size={10} className="text-amber-400/60 flex-shrink-0" />
              <span>{item.venue}</span>
              <span className="text-muted-foreground/40">&middot;</span>
              <span>{item.city}, {item.country}</span>
            </>
          ) : (
            <>
              <Link to={`/artist/${encPath(item.artist)}`}
                className="hover:text-foreground transition-colors">
                {item.artist}
              </Link>
              <span className="text-muted-foreground/40">&middot;</span>
              <span>{item.subtitle}</span>
            </>
          )}
        </div>
      </div>

      {/* Date */}
      <div className={cn("text-right flex-shrink-0", isShow ? "text-amber-400" : "text-cyan-400")}>
        <div className="text-xs font-semibold">{dateStr}</div>
        {timeStr && <div className="text-[10px] text-muted-foreground">{timeStr}</div>}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {isShow && item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-amber-500/10">
            <ExternalLink size={14} className="text-amber-400" />
          </a>
        )}
        {isRelease && item.status === "detected" && item.release_id && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {item.tidal_url && onDownload && (
              <button onClick={() => onDownload(item.release_id!)}
                className="p-1.5 rounded-md hover:bg-cyan-500/10">
                <Download size={14} className="text-cyan-400" />
              </button>
            )}
            {onDismiss && (
              <button onClick={() => onDismiss(item.release_id!)}
                className="p-1.5 rounded-md hover:bg-white/5">
                <X size={14} className="text-muted-foreground" />
              </button>
            )}
          </div>
        )}
        {isRelease && item.status === "downloaded" && (
          <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-[10px]">Done</Badge>
        )}
        {isRelease && item.status === "downloading" && (
          <Loader2 size={14} className="animate-spin text-cyan-400" />
        )}
      </div>
    </div>
  );
}

// ── Show Detail Panel (inline expansion) ──

function ShowDetailPanel({ item, onClose }: { item: UpcomingItem; onClose: () => void }) {
  const hasCoords = item.latitude && item.longitude;
  const dateStr = item.date ? new Date(item.date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  }) : "";
  const timeStr = item.time ? item.time.slice(0, 5) : "";
  const location = [item.city, item.country].filter(Boolean).join(", ");

  return (
    <div className="relative h-[320px] rounded-xl overflow-hidden border border-amber-500/20 mb-1">
      {/* Full-bleed map background */}
      {hasCoords ? (
        <div className="absolute inset-0">
          <MapContainer
            center={[item.latitude!, item.longitude!]}
            zoom={14}
            style={{ width: "100%", height: "100%" }}
            zoomControl={false}
            attributionControl={false}
            dragging={false}
            scrollWheelZoom={false}
          >
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            <Marker position={[item.latitude!, item.longitude!]} />
          </MapContainer>
        </div>
      ) : (
        <div className="absolute inset-0 bg-card/80" />
      )}

      {/* Close button */}
      <button onClick={onClose}
        className="absolute top-3 right-3 z-[1000] p-1.5 rounded-full bg-black/60 hover:bg-black/80 transition-colors">
        <X size={14} className="text-white" />
      </button>

      {/* Venue card overlay (top-left) */}
      {item.venue && (
        <div className="absolute top-3 left-3 z-[1000] bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2 max-w-[220px]">
          <div className="flex items-center gap-1.5">
            <MapPin size={12} className="text-amber-400 flex-shrink-0" />
            <div className="text-xs font-semibold text-white truncate">{item.venue}</div>
          </div>
          <div className="text-[10px] text-white/50 ml-[18px]">{location}</div>
        </div>
      )}

      {/* Info overlay (bottom) */}
      <div className="absolute bottom-0 left-0 right-0 z-[1000] bg-gradient-to-t from-black/90 via-black/70 to-transparent pt-16 pb-4 px-4">
        <div className="flex items-end gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-1">
              <img src={`/api/artist/${encPath(item.artist)}/photo`} alt=""
                className="w-10 h-10 rounded-full object-cover ring-2 ring-amber-500/30 flex-shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <Link to={`/artist/${encPath(item.artist)}`}
                className="text-xl font-bold text-white hover:text-amber-400 transition-colors">
              {item.artist}
            </Link>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {item.genres?.slice(0, 3).map(g => (
                <Badge key={g} variant="outline" className="text-[9px] px-1 py-0 border-white/20 text-white/70">{g}</Badge>
              ))}
            </div>

            <div className="flex items-center gap-4 mt-2 text-xs text-white/70">
              <span className="flex items-center gap-1">
                <Calendar size={12} className="text-amber-400" /> {dateStr}
              </span>
              {timeStr && (
                <span className="flex items-center gap-1">
                  <Clock size={12} className="text-amber-400" /> {timeStr}
                </span>
              )}
            </div>

            {item.lineup && item.lineup.length > 1 && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-[10px] text-white/40">Lineup:</span>
                {item.lineup.slice(0, 5).map(name => (
                  <Link key={name} to={`/artist/${encPath(name)}`}
                    className="flex items-center gap-1 text-[11px] text-white/80 hover:text-amber-400 transition-colors">
                    <img src={`/api/artist/${encPath(name)}/photo`} alt=""
                      className="w-4 h-4 rounded-full object-cover"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    {name}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer"
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-amber-500 text-black font-semibold text-sm hover:bg-amber-400 transition-colors shadow-lg">
              <Ticket size={14} /> Tickets
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Calendar View ──

function CalendarView({ items, month, onMonthChange, onDownload, onDismiss, onShowClick }: {
  items: UpcomingItem[];
  month: Date;
  onMonthChange: (dir: number) => void;
  onDownload: (id: number) => void;
  onDismiss: (id: number) => void;
  onShowClick: (item: UpcomingItem, index: number) => void;
}) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const firstDay = new Date(year, m, 1).getDay();
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const startOffset = (firstDay + 6) % 7; // Monday=0

  const now = new Date();
  const todayDay = now.getFullYear() === year && now.getMonth() === m ? now.getDate() : -1;

  // Group items by day
  const byDay = useMemo(() => {
    const map = new Map<number, UpcomingItem[]>();
    for (const item of items) {
      if (!item.date) continue;
      const d = new Date(item.date + "T12:00:00");
      if (d.getFullYear() === year && d.getMonth() === m) {
        const day = d.getDate();
        const existing = map.get(day) || [];
        existing.push(item);
        map.set(day, existing);
      }
    }
    return map;
  }, [items, year, m]);

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={() => onMonthChange(-1)}>
          <ChevronLeft size={16} />
        </Button>
        <span className="text-sm font-semibold">
          {month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
        <Button variant="ghost" size="sm" onClick={() => onMonthChange(1)}>
          <ChevronRight size={16} />
        </Button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-px mb-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="text-center text-[10px] text-muted-foreground/50 py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px">
        {Array.from({ length: startOffset }, (_, i) => (
          <div key={`empty-${i}`} className="min-h-[80px] bg-card/30 rounded-md" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const dayItems = byDay.get(day) || [];
          const isToday = day === todayDay;
          return (
            <div key={day} className={cn(
              "min-h-[80px] p-1 rounded-md border border-transparent",
              isToday && "border-primary/30 bg-primary/5",
              dayItems.length > 0 && "bg-card/50"
            )}>
              <div className="text-[10px] text-muted-foreground/50 mb-0.5">{day}</div>
              <div className="space-y-0.5">
                {dayItems.slice(0, 3).map((item, idx) => (
                  <CalendarPill key={idx} item={item} onDownload={onDownload} onDismiss={onDismiss}
                    onShowClick={() => onShowClick(item, idx)} />
                ))}
                {dayItems.length > 3 && (
                  <div className="text-[9px] text-muted-foreground/40">+{dayItems.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Calendar Pill with Popover ──

function CalendarPill({ item, onDownload, onDismiss, onShowClick }: {
  item: UpcomingItem;
  onDownload: (id: number) => void;
  onDismiss: (id: number) => void;
  onShowClick: () => void;
}) {
  const isShow = item.type === "show";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn(
          "w-full text-left text-[9px] px-1 py-0.5 rounded truncate",
          isShow
            ? "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25"
            : "bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25"
        )}>
          {item.artist}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        {isShow ? (
          <div>
            <ShowPopoverContent item={item} />
            <div className="px-3 pb-3">
              <button
                onClick={onShowClick}
                className="w-full text-center text-xs text-amber-400 hover:text-amber-300 transition-colors py-1.5 rounded-lg bg-amber-500/5 hover:bg-amber-500/10"
              >
                View full details
              </button>
            </div>
          </div>
        ) : (
          <ReleasePopoverContent item={item} onDownload={onDownload} onDismiss={onDismiss} />
        )}
      </PopoverContent>
    </Popover>
  );
}

// ── Show Popover Content ──

function ShowPopoverContent({ item }: { item: UpcomingItem }) {
  const dateObj = item.date ? new Date(item.date + "T12:00:00") : null;
  const dateStr = dateObj
    ? dateObj.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : "";
  const timeStr = item.time ? item.time.slice(0, 5) : "";
  const location = [item.city, item.country].filter(Boolean).join(", ");
  const allArtists = item.lineup && item.lineup.length > 0 ? item.lineup : [item.artist];
  const headliner = allArtists[0] || item.artist;
  const support = allArtists.slice(1);

  return (
    <div className="bg-card rounded-md overflow-hidden">
      {/* Header image */}
      <div className="relative h-[80px] bg-secondary">
        <img
          src={`/api/artist/${encPath(headliner)}/background`}
          alt=""
          className="w-full h-full object-cover opacity-60"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent" />
        <div className="absolute -bottom-3 left-3 flex -space-x-2">
          {allArtists.slice(0, 3).map((name) => (
            <Link key={name} to={`/artist/${encPath(name)}`}>
              <ArtistThumb name={name} size={28} />
            </Link>
          ))}
        </div>
      </div>

      <div className="p-3 pt-5">
        <Link to={`/artist/${encPath(headliner)}`}
          className="block font-bold text-sm text-foreground hover:text-primary transition-colors truncate mb-0.5">
          {headliner}
        </Link>

        {support.length > 0 && (
          <div className="text-[11px] text-muted-foreground mb-1 truncate">
            {support.slice(0, 3).map((name, i) => (
              <span key={name}>
                {i > 0 && <span> &middot; </span>}
                <Link to={`/artist/${encPath(name)}`} className="hover:text-foreground transition-colors">{name}</Link>
              </span>
            ))}
            {support.length > 3 && <span> +{support.length - 3} more</span>}
          </div>
        )}

        <div className="flex items-start gap-2 text-xs text-muted-foreground mb-1.5">
          <MapPin size={12} className="flex-shrink-0 mt-0.5 text-amber-400/60" />
          <div>
            <div className="text-foreground font-medium">{item.venue}</div>
            <div>{location}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-1.5">
          <span className="flex items-center gap-1"><Calendar size={12} />{dateStr}</span>
          {timeStr && <span className="flex items-center gap-1"><Clock size={12} />{timeStr}</span>}
        </div>

        {item.genres && item.genres.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {item.genres.slice(0, 4).map((g) => (
              <Badge key={g} variant="outline" className="text-[9px] px-1.5 py-0">{g}</Badge>
            ))}
          </div>
        )}

        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors text-xs font-medium">
            <Ticket size={12} /> Tickets
          </a>
        )}
      </div>
    </div>
  );
}

// ── Release Popover Content ──

function ReleasePopoverContent({ item, onDownload, onDismiss }: {
  item: UpcomingItem;
  onDownload: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const dateObj = item.date ? new Date(item.date + "T12:00:00") : null;
  const dateStr = dateObj
    ? dateObj.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "";

  return (
    <div className="bg-card rounded-md overflow-hidden">
      <div className="flex gap-3 p-3">
        {/* Album cover */}
        <div className="w-16 h-16 rounded-md overflow-hidden flex-shrink-0 bg-secondary">
          {item.cover_url ? (
            <img src={item.cover_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Disc3 size={20} className="text-muted-foreground/30" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm truncate">{item.title}</div>
          <Link to={`/artist/${encPath(item.artist)}`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {item.artist}
          </Link>
          <div className="flex items-center gap-1.5 mt-1">
            {item.subtitle && (
              <Badge variant="outline" className="text-[9px] px-1 py-0">{item.subtitle}</Badge>
            )}
            {item.tidal_url && (
              <Badge className="bg-cyan-500/15 text-cyan-400 border-cyan-500/30 text-[9px] px-1 py-0">LOSSLESS</Badge>
            )}
          </div>
        </div>
      </div>

      <div className="px-3 pb-3">
        <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
          <Calendar size={11} /> {dateStr}
        </div>

        {item.status === "detected" && item.release_id && (
          <div className="flex gap-2">
            {item.tidal_url && (
              <button onClick={() => onDownload(item.release_id!)}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors text-xs font-medium">
                <Download size={12} /> Download
              </button>
            )}
            <button onClick={() => onDismiss(item.release_id!)}
              className="px-3 py-1.5 rounded-lg bg-white/5 text-muted-foreground hover:bg-white/10 transition-colors text-xs">
              Dismiss
            </button>
          </div>
        )}
        {item.status === "downloaded" && (
          <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-[10px]">Downloaded</Badge>
        )}
        {item.status === "downloading" && (
          <div className="flex items-center gap-1.5 text-xs text-cyan-400">
            <Loader2 size={12} className="animate-spin" /> Downloading...
          </div>
        )}
      </div>
    </div>
  );
}

// ── Artist thumbnail (simple, self-contained) ──

function ArtistThumb({ name, size = 28 }: { name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const letter = name.charAt(0).toUpperCase();

  return (
    <div className="rounded-full ring-2 ring-card overflow-hidden bg-secondary flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }} title={name}>
      {!failed ? (
        <img src={`/api/artist/${encPath(name)}/photo`} alt={name}
          className="w-full h-full object-cover"
          onError={() => setFailed(true)} />
      ) : (
        <span className="text-[9px] font-bold text-foreground/60">{letter}</span>
      )}
    </div>
  );
}
