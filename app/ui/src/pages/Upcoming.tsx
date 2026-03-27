import { useState, useEffect } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { encPath } from "@/lib/utils";
import {
  Loader2, Download, X, RefreshCw, Disc3, MapPin, Calendar,
  Music, Ticket, ExternalLink, Sparkles,
} from "lucide-react";

interface UpcomingItem {
  type: "release" | "show";
  date: string;
  artist: string;
  title: string;
  subtitle: string;
  cover_url: string | null;
  status: string;
  is_upcoming: boolean;
  // Release-specific
  tidal_url?: string;
  release_id?: number;
  // Show-specific
  url?: string;
  venue?: string;
  city?: string;
  country?: string;
}

export function Upcoming() {
  const [items, setItems] = useState<UpcomingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "releases" | "shows">("all");
  const [checking, setChecking] = useState(false);

  async function fetchItems() {
    try {
      const data = await api<{ items: UpcomingItem[] }>("/api/upcoming");
      setItems(data.items || []);
    } catch {
      /* */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchItems();
  }, []);

  const filtered =
    filter === "all"
      ? items
      : items.filter((i) =>
          filter === "releases" ? i.type === "release" : i.type === "show"
        );

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = filtered.filter(
    (i) => i.is_upcoming || (i.date && i.date >= today)
  );
  const past = filtered.filter(
    (i) => !i.is_upcoming && (!i.date || i.date < today)
  );

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
      setItems((prev) =>
        prev.map((i) =>
          i.release_id === id ? { ...i, status: "downloading" } : i
        )
      );
    } catch {
      toast.error("Download failed");
    }
  }

  async function dismissRelease(id: number) {
    try {
      await api(`/api/acquisition/new-releases/${id}/dismiss`, "POST");
      setItems((prev) => prev.filter((i) => i.release_id !== id));
    } catch {
      toast.error("Dismiss failed");
    }
  }

  async function checkNow() {
    setChecking(true);
    try {
      await api("/api/acquisition/new-releases/check", "POST");
      toast.success("Checking for new releases...");
      setTimeout(() => {
        setChecking(false);
        fetchItems();
      }, 10000);
    } catch {
      setChecking(false);
      toast.error("Failed");
    }
  }

  const releaseCount = items.filter(
    (i) => i.type === "release" && i.is_upcoming
  ).length;
  const showCount = items.filter((i) => i.type === "show").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Calendar size={24} className="text-primary" />
          <h1 className="text-2xl font-bold">Upcoming</h1>
          {releaseCount > 0 && (
            <Badge
              variant="outline"
              className="border-cyan-500/30 text-cyan-400"
            >
              {releaseCount} releases
            </Badge>
          )}
          {showCount > 0 && (
            <Badge
              variant="outline"
              className="border-amber-500/30 text-amber-400"
            >
              {showCount} shows
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={checkNow} disabled={checking}>
            {checking ? (
              <Loader2 size={14} className="animate-spin mr-1" />
            ) : (
              <RefreshCw size={14} className="mr-1" />
            )}
            Check
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {(["all", "releases", "shows"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f === "all" && "All"}
            {f === "releases" && (
              <>
                <Disc3 size={12} className="mr-1" /> Releases
              </>
            )}
            {f === "shows" && (
              <>
                <Ticket size={12} className="mr-1" /> Shows
              </>
            )}
          </Button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-center py-24">
          <Calendar
            size={48}
            className="text-primary mx-auto mb-3 opacity-30"
          />
          <div className="text-lg font-semibold">Nothing upcoming</div>
          <div className="text-sm text-muted-foreground mt-1">
            Check for new releases or browse the Shows map
          </div>
        </div>
      )}

      {!loading && (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Sparkles size={14} /> Coming Up
              </h2>
              {groupByMonth(upcoming).map(([month, monthItems]) => (
                <MonthGroup
                  key={month}
                  month={month}
                  items={monthItems}
                  onDownload={downloadRelease}
                  onDismiss={dismissRelease}
                />
              ))}
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                Recently Released
              </h2>
              {groupByMonth(past).map(([month, monthItems]) => (
                <MonthGroup
                  key={month}
                  month={month}
                  items={monthItems}
                  onDownload={downloadRelease}
                  onDismiss={dismissRelease}
                />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function MonthGroup({
  month,
  items,
  onDownload,
  onDismiss,
}: {
  month: string;
  items: UpcomingItem[];
  onDownload: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const label =
    month === "Unknown"
      ? "Unknown Date"
      : new Date(month + "-15").toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        });

  return (
    <div className="mb-6">
      <div className="text-xs font-medium text-muted-foreground/50 uppercase tracking-wider mb-2 border-b border-border/30 pb-1">
        {label}
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <ItemRow
            key={`${item.type}-${item.release_id ?? item.venue}-${i}`}
            item={item}
            onDownload={onDownload}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  onDownload,
  onDismiss,
}: {
  item: UpcomingItem;
  onDownload: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const day = item.date
    ? new Date(item.date + "T12:00:00").getDate()
    : null;
  const monthShort = item.date
    ? new Date(item.date + "T12:00:00")
        .toLocaleDateString("en-US", { month: "short" })
        .toUpperCase()
    : null;
  const isRelease = item.type === "release";
  const isShow = item.type === "show";

  return (
    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-card/80 transition-colors group">
      {/* Date */}
      <div className="w-12 text-center flex-shrink-0">
        {day !== null ? (
          <>
            <div className="text-[10px] text-muted-foreground/40">
              {monthShort}
            </div>
            <div className="text-lg font-bold text-muted-foreground/60">
              {day}
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground/20">--</div>
        )}
      </div>

      {/* Type icon */}
      <div
        className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${
          isRelease ? "bg-cyan-500/10" : "bg-amber-500/10"
        }`}
      >
        {isRelease ? (
          <Disc3 size={14} className="text-cyan-400" />
        ) : (
          <Ticket size={14} className="text-amber-400" />
        )}
      </div>

      {/* Cover (releases only) */}
      {isRelease && (
        <div className="w-10 h-10 rounded-md overflow-hidden flex-shrink-0 bg-secondary">
          {item.cover_url ? (
            <img
              src={item.cover_url}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music size={12} className="text-muted-foreground/30" />
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{item.title}</div>
        <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
          <Link
            to={`/artist/${encPath(item.artist)}`}
            className="hover:text-foreground transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {item.artist}
          </Link>
          {isRelease && item.subtitle && (
            <Badge variant="outline" className="text-[9px] px-1 py-0">
              {item.subtitle}
            </Badge>
          )}
          {isShow && (
            <>
              <MapPin size={10} className="text-muted-foreground/50" />
              <span className="text-muted-foreground/70">{item.subtitle}</span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {isRelease && item.status === "downloaded" && (
          <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-[10px]">
            Downloaded
          </Badge>
        )}
        {isRelease && item.status === "downloading" && (
          <Loader2 size={14} className="animate-spin text-cyan-400" />
        )}
        {isRelease && item.status === "detected" && item.release_id && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {item.tidal_url && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                onClick={() => onDownload(item.release_id!)}
              >
                <Download size={12} className="mr-1" /> Get
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-1.5 text-muted-foreground"
              onClick={() => onDismiss(item.release_id!)}
            >
              <X size={12} />
            </Button>
          </div>
        )}
        {isShow && item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
          >
            <ExternalLink size={14} />
          </a>
        )}
      </div>
    </div>
  );
}
