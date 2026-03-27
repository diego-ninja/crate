import { useState, useEffect, useMemo } from "react";
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
  ChevronLeft, ChevronRight, Clock, Search,
} from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
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
  return `${item.type}-${item.release_id ?? item.venue ?? index}-${item.date}`;
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

  // Derived filter options
  const availableGenres = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of items) {
      if (i.type === "show") for (const g of i.genres || []) counts[g] = (counts[g] || 0) + 1;
    }
    return Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 20);
  }, [items]);

  const availableCities = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of items) {
      if (i.type === "show" && i.city) counts[i.city] = (counts[i.city] || 0) + 1;
    }
    return Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 20);
  }, [items]);

  // Apply filters
  const filtered = useMemo(() => {
    let list = items;
    if (search) list = list.filter((i) => i.artist.toLowerCase().includes(search.toLowerCase()));
    if (filter === "releases") list = list.filter((i) => i.type === "release");
    if (filter === "shows") list = list.filter((i) => i.type === "show");
    if (genreFilter) list = list.filter((i) => (i.genres || []).some((g) => g.toLowerCase() === genreFilter.toLowerCase()));
    if (cityFilter) list = list.filter((i) => i.city?.toLowerCase() === cityFilter.toLowerCase());
    return list;
  }, [items, search, filter, genreFilter, cityFilter]);

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
            Sync Shows
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
          <select
            value={genreFilter}
            onChange={(e) => setGenreFilter(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
          >
            <option value="">All genres</option>
            {availableGenres.map(([g, c]) => (
              <option key={g} value={g}>{g} ({c})</option>
            ))}
          </select>
        )}

        {availableCities.length > 0 && (
          <select
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
          >
            <option value="">All cities</option>
            {availableCities.map(([c, n]) => (
              <option key={c} value={c}>{c} ({n})</option>
            ))}
          </select>
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
              <EventCard
                item={item}
                onDownload={onDownload}
                onDismiss={onDismiss}
                onClick={item.type === "show" ? () => onToggleExpand(isExpanded ? null : key) : undefined}
              />
              {isExpanded && item.type === "show" && (
                <ShowDetailPanel item={item} onClose={() => onToggleExpand(null)} />
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

  return (
    <div className="border border-amber-500/20 rounded-xl overflow-hidden mb-2 bg-card/50">
      <div className="flex flex-col sm:flex-row">
        {/* Mini map */}
        {hasCoords && (
          <div className="w-full sm:w-[300px] h-[200px] flex-shrink-0">
            <MiniMap lat={item.latitude!} lng={item.longitude!} venue={item.venue || ""} />
          </div>
        )}

        {/* Details */}
        <div className="flex-1 p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <Link to={`/artist/${encPath(item.artist)}`}
                className="text-lg font-bold hover:text-primary transition-colors">
                {item.artist}
              </Link>
              {item.genres?.slice(0, 3).map(g => (
                <Badge key={g} variant="outline" className="text-[9px] px-1 py-0 ml-1">{g}</Badge>
              ))}
            </div>
            <button onClick={onClose} className="p-1 rounded-md hover:bg-white/5">
              <X size={16} className="text-muted-foreground" />
            </button>
          </div>

          {/* Venue */}
          <div className="flex items-start gap-2 text-sm text-muted-foreground mb-2">
            <MapPin size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-foreground font-medium">{item.venue}</div>
              <div>{item.city}, {item.country}</div>
            </div>
          </div>

          {/* Date + Time */}
          <div className="flex items-center gap-3 text-sm text-muted-foreground mb-2">
            <span className="flex items-center gap-1.5">
              <Calendar size={14} className="text-amber-400" />
              {item.date ? new Date(item.date + "T12:00:00").toLocaleDateString("en-US", {
                weekday: "long", month: "long", day: "numeric", year: "numeric"
              }) : ""}
            </span>
            {item.time && (
              <span className="flex items-center gap-1.5">
                <Clock size={14} className="text-amber-400" />
                {item.time.slice(0, 5)}
              </span>
            )}
          </div>

          {/* Lineup */}
          {item.lineup && item.lineup.length > 0 && (
            <div className="mb-3">
              <div className="text-xs text-muted-foreground/50 uppercase tracking-wider mb-1.5">Lineup</div>
              <div className="flex flex-wrap gap-2">
                {item.lineup.map(name => (
                  <Link key={name} to={`/artist/${encPath(name)}`}
                    className="flex items-center gap-1.5 text-xs bg-card border border-border rounded-full px-2 py-1 hover:border-primary/30 transition-colors">
                    <img src={`/api/artist/${encPath(name)}/photo`} alt=""
                      className="w-5 h-5 rounded-full object-cover"
                      onError={e => (e.target as HTMLImageElement).style.display = "none"} />
                    {name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Tickets button */}
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors text-sm font-medium">
              <Ticket size={14} /> Get Tickets
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── MiniMap (Leaflet) ──

function MiniMap({ lat, lng, venue }: { lat: number; lng: number; venue: string }) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={14}
      style={{ width: "100%", height: "100%" }}
      zoomControl={false}
      attributionControl={false}
      dragging={false}
      scrollWheelZoom={false}
    >
      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
      <Marker position={[lat, lng]}>
        <Popup>{venue}</Popup>
      </Marker>
    </MapContainer>
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
