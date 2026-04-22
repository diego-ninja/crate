import { useState, useEffect, useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { CrateChip, CratePill } from "@crate/ui/primitives/CrateBadge";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { Popover, PopoverContent, PopoverTrigger } from "@crate/ui/shadcn/popover";
import { ShowCard } from "@/components/shows/ShowCard";
import { api } from "@/lib/api";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Loader2, Download, X, RefreshCw, Disc3, Calendar,
  Ticket, Sparkles, List, CalendarDays,
  ChevronLeft, ChevronRight, Check, Clock, Search, Trash2,
} from "lucide-react";
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
  artist_id?: number;
  artist_slug?: string;
  title: string;
  album_id?: number;
  album_slug?: string;
  subtitle: string;
  cover_url: string | null;
  status: string;
  is_upcoming: boolean;
  tidal_url?: string;
  release_id?: number;
  url?: string;
  venue?: string;
  address_line1?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
  lineup?: string[];
  lineup_artists?: UpcomingArtistRef[];
  genres?: string[];
}

interface UpcomingArtistRef {
  name: string;
  id?: number;
  slug?: string;
}

type ViewMode = "list" | "calendar";
type TypeFilter = "all" | "releases" | "shows";

function itemKey(item: UpcomingItem, index: number): string {
  return `${item.type}-${item.artist}-${item.release_id ?? item.venue ?? index}-${item.date}`;
}

function buildArtistRef(name?: string, id?: number, slug?: string): UpcomingArtistRef | null {
  if (!name) return null;
  return { name, id, slug };
}

function getPrimaryArtist(item: UpcomingItem): UpcomingArtistRef | null {
  return buildArtistRef(item.artist, item.artist_id, item.artist_slug);
}

function getArtistHref(artist: UpcomingArtistRef | null | undefined) {
  if (!artist || artist.id == null) return undefined;
  return artistPagePath({ artistId: artist.id, artistSlug: artist.slug, artistName: artist.name });
}

function ArtistTextLink({
  artist,
  className,
  children,
}: {
  artist: UpcomingArtistRef | null | undefined;
  className?: string;
  children?: ReactNode;
}) {
  const href = getArtistHref(artist);
  const content = children ?? artist?.name ?? "";
  if (href) {
    return <Link to={href} className={className}>{content}</Link>;
  }
  return <span className={className}>{content}</span>;
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
    <div className="space-y-6">
      <section className="rounded-md border border-white/10 bg-panel-surface/95 p-4 shadow-[0_28px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/12 text-primary shadow-[0_18px_40px_rgba(6,182,212,0.14)]">
                <Calendar size={22} />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">Upcoming</h1>
                <p className="text-sm text-white/55">
                  Release radar and live dates, with quick triage for what lands next in Crate.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <CrateChip active>{releaseCount} releases</CrateChip>
              <CrateChip className="border-amber-500/25 bg-amber-500/10 text-amber-200">{showCount} shows</CrateChip>
              <CrateChip icon={Clock}>{upcoming.length} upcoming</CrateChip>
              {past.length > 0 && <CrateChip>{past.length} archived</CrateChip>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] p-1">
              <CratePill active={view === "list"} onClick={() => setView("list")} icon={List}>
                List
              </CratePill>
              <CratePill active={view === "calendar"} onClick={() => setView("calendar")} icon={CalendarDays}>
                Calendar
              </CratePill>
            </div>
            <Button size="sm" onClick={syncShows} disabled={syncing}>
              <RefreshCw size={14} className={cn("mr-1", syncing && "animate-spin")} />
              Sync shows
            </Button>
            <ActionIconButton onClick={clearCaches} title="Clear caches">
              <Trash2 size={15} />
            </ActionIconButton>
          </div>
        </div>

        <div className="mt-5 rounded-md border border-white/8 bg-white/[0.03] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
              <Input
                type="text"
                placeholder="Filter by artist..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-10 rounded-md border-white/10 bg-white/[0.04] pl-9"
              />
            </div>

            {availableGenres.length > 0 && (
              <AdminSelect
                value={genreFilter}
                onChange={setGenreFilter}
                options={availableGenres.map(([name, count]) => ({ value: name, label: name, count }))}
                placeholder="All genres"
                searchable
                searchPlaceholder="Search genres..."
              />
            )}

            {availableCities.length > 0 && (
              <AdminSelect
                value={cityFilter}
                onChange={setCityFilter}
                options={availableCities.map(([name, count]) => ({ value: name, label: name, count }))}
                placeholder="All cities"
                searchable
                searchPlaceholder="Search cities..."
              />
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(["all", "releases", "shows"] as const).map((f) => (
              <CratePill
                key={f}
                active={filter === f}
                icon={f === "releases" ? Disc3 : f === "shows" ? Ticket : undefined}
                onClick={() => {
                  setFilter(f);
                  if (f !== "shows") {
                    setGenreFilter("");
                    setCityFilter("");
                  }
                }}
              >
                {f === "all" ? "All items" : f}
              </CratePill>
            ))}
          </div>
        </div>
      </section>

      {loading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="rounded-md border border-white/10 bg-panel-surface px-6 py-24 text-center shadow-[0_28px_80px_rgba(0,0,0,0.24)]">
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
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.24em] text-primary/90">
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
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.24em] text-white/45">
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
      <div className="mb-3 flex items-center gap-2 border-b border-white/8 pb-2">
        <div className="text-xs font-medium uppercase tracking-[0.22em] text-white/35">
          {label}
        </div>
        <CrateChip>{items.length} items</CrateChip>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => {
          const key = itemKey(item, i);
          const isExpanded = expandedId === key;
          return (
            <div key={key}>
              {item.type === "show" ? (
                <ShowCard
                  show={item}
                  expanded={isExpanded}
                  onToggle={() => onToggleExpand(isExpanded ? null : key)}
                />
              ) : (
                <EventCard
                  item={item}
                  onDownload={onDownload}
                  onDismiss={onDismiss}
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
  const primaryArtist = getPrimaryArtist(item);
  const dateObj = item.date ? new Date(item.date + "T12:00:00") : null;
  const dateStr = dateObj ? dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  const timeStr = item.time ? item.time.slice(0, 5) : "";

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-md border p-3.5 transition-all duration-200",
        "bg-white/[0.04] shadow-[0_18px_48px_rgba(0,0,0,0.22)] backdrop-blur-xl hover:bg-white/[0.07]",
        item.tidal_url ? "border-primary/25 shadow-[0_0_22px_rgba(6,182,212,0.15)]" : "border-white/10 hover:border-white/20",
      )}
      onClick={onClick}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 opacity-70 transition-opacity group-hover:opacity-100",
          "bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.14),transparent_48%)]"
        )}
      />
      <div className="relative flex items-center gap-4">
      {/* Thumbnail */}
      <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-md bg-secondary/60 shadow-[0_16px_36px_rgba(0,0,0,0.22)]">
        {item.cover_url ? (
          <img src={item.cover_url} alt="" className="w-full h-full object-cover" />
        ) : null}
        {item.status === "downloading" && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <Loader2 size={16} className="text-primary animate-spin" />
          </div>
        )}
        {item.status === "downloaded" && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <Check size={16} className="text-green-400" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-white">{item.title}</span>
          {item.tidal_url && <CrateChip active>Lossless</CrateChip>}
        </div>
        <div className="mt-1 flex items-center gap-1.5 truncate text-xs text-white/55">
          <ArtistTextLink
            artist={primaryArtist}
            className="hover:text-foreground transition-colors"
          >
            {item.artist}
          </ArtistTextLink>
          <span className="text-muted-foreground/40">&middot;</span>
          <span>{item.subtitle}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <CrateChip>{item.status}</CrateChip>
          {item.is_upcoming && <CrateChip active>Upcoming</CrateChip>}
          {timeStr && <CrateChip icon={Clock}>{timeStr}</CrateChip>}
        </div>
      </div>

      {/* Date */}
      <div className={cn(
        "flex-shrink-0 rounded-md border px-3 py-2 text-right shadow-[0_14px_34px_rgba(0,0,0,0.18)]",
        "border-primary/20 bg-primary/10 text-primary"
      )}>
        <div className="text-xs font-semibold">{dateStr}</div>
        {timeStr && <div className="text-[10px] text-white/45">{timeStr}</div>}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {item.status === "detected" && item.tidal_url && onDownload && item.release_id && (
          <ActionIconButton
            tone="primary"
            onClick={(e) => {
              e.stopPropagation();
              onDownload(item.release_id!);
            }}
            title="Download release"
          >
            <Download size={16} />
          </ActionIconButton>
        )}
        {onDismiss && item.release_id && item.status === "detected" && (
          <ActionIconButton
            tone="danger"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(item.release_id!);
            }}
            title="Dismiss release"
          >
            <X size={14} />
          </ActionIconButton>
        )}
      </div>
      </div>
    </div>
  );
}

// ── Show Detail Panel (inline expansion) ──

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
    <div className="rounded-md border border-white/10 bg-panel-surface p-4 shadow-[0_28px_80px_rgba(0,0,0,0.24)]">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <ActionIconButton onClick={() => onMonthChange(-1)} title="Previous month">
          <ChevronLeft size={16} />
        </ActionIconButton>
        <span className="text-sm font-semibold text-white/85">
          {month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
        <ActionIconButton onClick={() => onMonthChange(1)} title="Next month">
          <ChevronRight size={16} />
        </ActionIconButton>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-px mb-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="py-1 text-center text-[10px] uppercase tracking-[0.2em] text-white/30">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px">
        {Array.from({ length: startOffset }, (_, i) => (
          <div key={`empty-${i}`} className="min-h-[92px] rounded-md border border-white/5 bg-white/[0.02]" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const dayItems = byDay.get(day) || [];
          const isToday = day === todayDay;
          return (
            <div key={day} className={cn(
              "min-h-[92px] rounded-md border p-2 shadow-[0_12px_32px_rgba(0,0,0,0.16)]",
              isToday ? "border-primary/30 bg-primary/8" : "border-white/6 bg-white/[0.03]",
              dayItems.length > 0 && "bg-white/[0.05]"
            )}>
              <div className={cn("mb-1 text-[10px]", isToday ? "text-primary" : "text-white/35")}>{day}</div>
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
          "w-full truncate rounded-md px-2 py-1 text-left text-[10px] transition-colors",
          isShow
            ? "bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
            : "bg-primary/15 text-cyan-200 hover:bg-primary/25"
        )}>
          {item.artist}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        {isShow ? (
          <div>
            <div className="p-3">
              <ShowCard show={item} className="w-full" />
            </div>
            <div className="px-3 pb-3">
              <button
                onClick={onShowClick}
                className="w-full text-center text-xs text-amber-400 hover:text-amber-300 transition-colors py-1.5 rounded-md bg-amber-500/5 hover:bg-amber-500/10"
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
    <div className="overflow-hidden rounded-md bg-transparent">
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
          {item.album_id != null ? (
            <Link
              to={albumPagePath({ albumId: item.album_id, albumSlug: item.album_slug, artistName: item.artist, albumName: item.title })}
              className="font-bold text-sm truncate block hover:text-foreground transition-colors"
            >
              {item.title}
            </Link>
          ) : (
            <div className="font-bold text-sm truncate">{item.title}</div>
          )}
          <ArtistTextLink
            artist={getPrimaryArtist(item)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {item.artist}
          </ArtistTextLink>
          <div className="flex items-center gap-1.5 mt-1">
            {item.subtitle && (
              <CrateChip>{item.subtitle}</CrateChip>
            )}
            {item.tidal_url && (
              <CrateChip active>LOSSLESS</CrateChip>
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
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-xs font-medium">
                <Download size={12} /> Download
              </button>
            )}
            <button onClick={() => onDismiss(item.release_id!)}
              className="px-3 py-1.5 rounded-md bg-white/5 text-muted-foreground hover:bg-white/10 transition-colors text-xs">
              Dismiss
            </button>
          </div>
        )}
        {item.status === "downloaded" && (
          <CrateChip className="border-green-500/25 bg-green-500/10 text-green-300">Downloaded</CrateChip>
        )}
        {item.status === "downloading" && (
          <div className="flex items-center gap-1.5 text-xs text-primary">
            <Loader2 size={12} className="animate-spin" /> Downloading...
          </div>
        )}
      </div>
    </div>
  );
}
